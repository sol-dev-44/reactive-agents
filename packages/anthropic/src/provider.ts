import Anthropic from "@anthropic-ai/sdk";
import type {
  Provider,
  ProviderExecuteParams,
  ProviderExecuteResult,
  StreamEvent,
  TokenUsage,
  ToolCall,
} from "@reactive-agent/core";
import { formatMessages, formatTools } from "./messages.js";
import { mapStreamEvents } from "./streaming.js";
import { wrapError } from "./errors.js";

// ============================================================
// Configuration
// ============================================================

/** Configuration for the Anthropic provider. */
export interface AnthropicProviderConfig {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

/** Default model when none is specified per-agent. */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// ============================================================
// Model pricing (USD per token)
// ============================================================

interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-20250514": {
    inputPerToken: 3 / 1_000_000,    // $3 per 1M input tokens
    outputPerToken: 15 / 1_000_000,   // $15 per 1M output tokens
  },
  "claude-3-5-haiku-20241022": {
    inputPerToken: 1 / 1_000_000,    // $1 per 1M input tokens
    outputPerToken: 5 / 1_000_000,    // $5 per 1M output tokens
  },
  "claude-opus-4-20250514": {
    inputPerToken: 15 / 1_000_000,   // $15 per 1M input tokens
    outputPerToken: 75 / 1_000_000,   // $75 per 1M output tokens
  },
};

/**
 * Estimate cost in USD for a given model and token usage.
 */
function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return undefined;
  return (
    inputTokens * pricing.inputPerToken +
    outputTokens * pricing.outputPerToken
  );
}

// ============================================================
// Stop reason mapping
// ============================================================

function mapStopReason(
  stopReason: string | null,
): ProviderExecuteResult["stopReason"] {
  switch (stopReason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

// ============================================================
// Provider factory
// ============================================================

/**
 * Create an Anthropic provider that satisfies the Provider interface.
 *
 * @example
 * ```ts
 * import { createAnthropicProvider } from "@reactive-agent/anthropic";
 *
 * const provider = createAnthropicProvider({ apiKey: "sk-ant-..." });
 * // or let it read ANTHROPIC_API_KEY from env:
 * const provider = createAnthropicProvider();
 * ```
 */
export function createAnthropicProvider(
  config?: AnthropicProviderConfig,
): Provider {
  const client = new Anthropic({
    apiKey: config?.apiKey,
  });

  const provider: Provider = {
    name: "anthropic",

    async execute(
      params: ProviderExecuteParams,
    ): Promise<ProviderExecuteResult> {
      const model = params.model || DEFAULT_MODEL;

      try {
        const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
          model,
          max_tokens: params.maxTokens ?? 4096,
          messages: formatMessages(params.messages),
          ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
          ...(params.tools && params.tools.length > 0
            ? { tools: formatTools(params.tools) }
            : {}),
          ...(params.temperature !== undefined
            ? { temperature: params.temperature }
            : {}),
          ...(params.stopSequences && params.stopSequences.length > 0
            ? { stop_sequences: params.stopSequences }
            : {}),
        };

        const response = await client.messages.create(requestParams);

        // Extract text content and tool calls from content blocks
        let textContent = "";
        const toolCalls: ToolCall[] = [];

        for (const block of response.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;

        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
        };

        return {
          content: textContent,
          toolCalls,
          usage,
          stopReason: mapStopReason(response.stop_reason),
        };
      } catch (error) {
        throw wrapError(error);
      }
    },

    async *stream(
      params: ProviderExecuteParams,
    ): AsyncIterable<StreamEvent> {
      const model = params.model || DEFAULT_MODEL;

      try {
        const requestParams: Anthropic.MessageStreamParams = {
          model,
          max_tokens: params.maxTokens ?? 4096,
          messages: formatMessages(params.messages),
          ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
          ...(params.tools && params.tools.length > 0
            ? { tools: formatTools(params.tools) }
            : {}),
          ...(params.temperature !== undefined
            ? { temperature: params.temperature }
            : {}),
          ...(params.stopSequences && params.stopSequences.length > 0
            ? { stop_sequences: params.stopSequences }
            : {}),
        };

        const messageStream = client.messages.stream(requestParams);

        yield* mapStreamEvents(messageStream);
      } catch (error) {
        yield {
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
  };

  return provider;
}
