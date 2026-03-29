/**
 * ExecutionEngine — runs agents according to the DAG plan.
 *
 * Algorithm:
 * 1. Get execution plan from DAG builder
 * 2. Group steps by parallelGroup
 * 3. For each group: run all agents in parallel (Promise.all)
 * 4. Between groups: wait for all to complete
 * 5. For chained pipelines: pass output of previous agent as input to next
 * 6. Check cache before executing — serve from cache if valid
 *
 * Tool loop:
 * If an agent has tools, the engine loops:
 *   1. Send messages to provider
 *   2. If response has tool_calls -> execute handlers -> append results -> loop
 *   3. If response is end_turn -> done
 *   4. Max rounds safety valve
 */

import type {
  AgentConfig,
  AgentResult,
  Provider,
  TokenUsage,
  AgentMessage,
  StreamEvent,
  PipelineOptions,
  PipelineResult,
  ToolDefinition,
} from "./types.js";
import type { CacheManager } from "./cache.js";
import { normalizeTag } from "./tags.js";
import { buildExecutionPlan } from "./dag.js";
import {
  AgentNotFoundError,
  MaxToolRoundsError,
  ToolExecutionError,
  ProviderError,
} from "./errors.js";

export interface EngineConfig {
  provider: Provider;
  agents: Record<string, AgentConfig<unknown, unknown>>;
  cache: CacheManager;
  defaultModel: string;
  defaultCacheTtl: number;
  defaultMaxTokens: number;
  onExecutionStart?: (agentName: string, input: unknown) => void;
  onExecutionComplete?: (
    agentName: string,
    result: AgentResult<unknown>,
  ) => void;
  onCacheHit?: (agentName: string, cacheKey: string) => void;
  onError?: (agentName: string, error: Error) => void;
}

export class ExecutionEngine {
  private cumulativeUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };

  constructor(private config: EngineConfig) {}

  async execute<TResult = string>(
    agentName: string,
    input: unknown,
  ): Promise<AgentResult<TResult>> {
    const agentConfig = this.config.agents[agentName];
    if (!agentConfig) throw new AgentNotFoundError(agentName);

    const startTime = Date.now();

    // Check cache
    const cacheKey = await this.config.cache.getKey(agentName, input);
    const cached = this.config.cache.get(cacheKey);
    if (cached) {
      this.config.onCacheHit?.(agentName, cacheKey);
      return {
        data: cached.result as TResult,
        raw: String(cached.result),
        fromCache: true,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - startTime,
        agentName,
        timestamp: Date.now(),
        tags: cached.tags,
      };
    }

    this.config.onExecutionStart?.(agentName, input);

    try {
      // Build messages
      const messages: AgentMessage[] = agentConfig.buildMessages
        ? agentConfig.buildMessages(input)
        : [
            {
              role: "user",
              content:
                typeof input === "string" ? input : JSON.stringify(input),
            },
          ];

      // Prepare tools
      const tools: ToolDefinition[] | undefined = agentConfig.tools
        ? Object.values(agentConfig.tools).map((t) => t.definition)
        : undefined;

      // Execute with tool loop
      const allMessages = [...messages];
      const totalUsage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      let finalContent = "";
      const maxRounds = agentConfig.maxToolRounds ?? 10;

      for (let round = 0; round < maxRounds; round++) {
        const result = await this.executeWithRetry(
          agentName,
          agentConfig,
          allMessages,
          tools,
        );

        totalUsage.inputTokens += result.usage.inputTokens;
        totalUsage.outputTokens += result.usage.outputTokens;
        totalUsage.totalTokens += result.usage.totalTokens;

        if (result.stopReason === "tool_use" && result.toolCalls.length > 0) {
          // Execute tool handlers
          allMessages.push({ role: "assistant", content: result.content });

          for (const toolCall of result.toolCalls) {
            const handler = agentConfig.tools?.[toolCall.name]?.handler;
            if (!handler) {
              throw new ToolExecutionError(
                toolCall.name,
                new Error(`No handler registered for tool "${toolCall.name}"`),
              );
            }
            try {
              const toolResult = await handler(toolCall.input);
              allMessages.push({
                role: "user",
                content: `Tool result for ${toolCall.name}: ${toolResult}`,
              });
            } catch (err) {
              throw new ToolExecutionError(toolCall.name, err);
            }
          }

          // If this was the last round, throw
          if (round === maxRounds - 1) {
            throw new MaxToolRoundsError(agentName, maxRounds);
          }
          continue;
        }

        // Done — end_turn or max_tokens
        finalContent = result.content;
        break;
      }

      // Parse result
      const parsed = agentConfig.parseResult
        ? agentConfig.parseResult(finalContent)
        : finalContent;

      // Resolve tags
      const tags =
        typeof agentConfig.providesTags === "function"
          ? agentConfig.providesTags(parsed).map(normalizeTag)
          : (agentConfig.providesTags ?? []).map(normalizeTag);

      // Cache the result
      const ttl = agentConfig.cacheTtl ?? this.config.defaultCacheTtl;
      if (ttl > 0) {
        this.config.cache.set(cacheKey, {
          result: parsed,
          cachedAt: Date.now(),
          expiresAt: Date.now() + ttl,
          inputHash: cacheKey,
          tags,
          usage: totalUsage,
        });
      }

      // Invalidate downstream caches
      if (agentConfig.invalidatesTags) {
        const invTags =
          typeof agentConfig.invalidatesTags === "function"
            ? agentConfig.invalidatesTags(input)
            : agentConfig.invalidatesTags;
        this.config.cache.invalidate(invTags);
      }

      // Track cumulative usage
      this.cumulativeUsage.inputTokens += totalUsage.inputTokens;
      this.cumulativeUsage.outputTokens += totalUsage.outputTokens;
      this.cumulativeUsage.totalTokens += totalUsage.totalTokens;

      const agentResult: AgentResult<TResult> = {
        data: parsed as TResult,
        raw: finalContent,
        fromCache: false,
        usage: totalUsage,
        durationMs: Date.now() - startTime,
        agentName,
        timestamp: Date.now(),
        tags,
      };

      this.config.onExecutionComplete?.(agentName, agentResult);
      return agentResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError?.(agentName, err);
      throw error;
    }
  }

  private async executeWithRetry(
    agentName: string,
    agentConfig: AgentConfig<unknown, unknown>,
    messages: AgentMessage[],
    tools?: ToolDefinition[],
  ) {
    const maxRetries = agentConfig.retry?.maxRetries ?? 2;
    const baseBackoff = agentConfig.retry?.backoffMs ?? 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.config.provider.execute({
          model: agentConfig.model ?? this.config.defaultModel,
          systemPrompt: agentConfig.systemPrompt,
          messages,
          tools,
          maxTokens: agentConfig.maxTokens ?? this.config.defaultMaxTokens,
          temperature: agentConfig.temperature,
        });
      } catch (error) {
        if (attempt === maxRetries) {
          throw new ProviderError(this.config.provider.name, error);
        }
        // Exponential backoff with jitter
        const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15x
        const delay = baseBackoff * Math.pow(2, attempt) * jitter;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    // Unreachable — the loop above always returns or throws
    throw new ProviderError(this.config.provider.name, new Error("Unreachable"));
  }

  async *stream(
    agentName: string,
    input: unknown,
  ): AsyncIterable<StreamEvent> {
    const agentConfig = this.config.agents[agentName];
    if (!agentConfig) throw new AgentNotFoundError(agentName);

    const messages: AgentMessage[] = agentConfig.buildMessages
      ? agentConfig.buildMessages(input)
      : [
          {
            role: "user",
            content:
              typeof input === "string" ? input : JSON.stringify(input),
          },
        ];

    yield* this.config.provider.stream({
      model: agentConfig.model ?? this.config.defaultModel,
      systemPrompt: agentConfig.systemPrompt,
      messages,
      maxTokens: agentConfig.maxTokens ?? this.config.defaultMaxTokens,
      temperature: agentConfig.temperature,
    });
  }

  async executePipeline(
    agentNames: string[],
    initialInput: unknown,
    options: PipelineOptions = {},
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const plan = buildExecutionPlan(agentNames, this.config.agents);
    const results: Record<string, AgentResult<unknown>> = {};
    const chainOutputs = options.chainOutputs ?? true;

    // Group steps by parallelGroup
    const groups = new Map<number, string[]>();
    for (const step of plan.steps) {
      const group = groups.get(step.parallelGroup) ?? [];
      group.push(step.agentName);
      groups.set(step.parallelGroup, group);
    }

    let lastOutput: unknown = initialInput;

    for (let g = 0; g < plan.totalGroups; g++) {
      const groupAgents = groups.get(g) ?? [];

      const groupResults = await Promise.all(
        groupAgents.map(async (name) => {
          const input =
            options.inputOverrides?.[name] ??
            (chainOutputs ? lastOutput : initialInput);
          const result = await this.execute(name, input);
          options.onStepComplete?.(name, result);
          return { name, result };
        }),
      );

      for (const { name, result } of groupResults) {
        results[name] = result;
        lastOutput = result.data;
      }
    }

    const lastAgentName = agentNames[agentNames.length - 1];
    if (!lastAgentName || !results[lastAgentName]) {
      throw new Error("Pipeline produced no results");
    }

    const totalUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    for (const r of Object.values(results)) {
      totalUsage.inputTokens += r.usage.inputTokens;
      totalUsage.outputTokens += r.usage.outputTokens;
      totalUsage.totalTokens += r.usage.totalTokens;
    }

    return {
      results,
      finalResult: results[lastAgentName],
      totalDurationMs: Date.now() - startTime,
      totalUsage,
    };
  }

  getUsage(): TokenUsage {
    return { ...this.cumulativeUsage };
  }

  resetUsage(): void {
    this.cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }
}
