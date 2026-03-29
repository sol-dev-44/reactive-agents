import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEngine } from "../src/engine.js";
import { CacheManager } from "../src/cache.js";
import {
  AgentNotFoundError,
  MaxToolRoundsError,
  ToolExecutionError,
  ProviderError,
} from "../src/errors.js";
import type {
  Provider,
  ProviderExecuteParams,
  ProviderExecuteResult,
  StreamEvent,
  AgentConfig,
  TokenUsage,
} from "../src/types.js";
import type { EngineConfig } from "../src/engine.js";

// ============================================================
// Mock Provider
// ============================================================

function createMockProvider(
  overrides: Partial<Provider> = {},
): Provider & { executeMock: ReturnType<typeof vi.fn> } {
  const executeMock = vi.fn<(params: ProviderExecuteParams) => Promise<ProviderExecuteResult>>();
  executeMock.mockResolvedValue({
    content: "mock response",
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    stopReason: "end_turn",
  });

  return {
    name: "mock-provider",
    execute: executeMock,
    stream: overrides.stream ?? (async function* () {
      yield { type: "text_delta", text: "hello " } as StreamEvent;
      yield { type: "text_delta", text: "world" } as StreamEvent;
      yield { type: "complete" } as StreamEvent;
    }),
    executeMock,
  };
}

function createEngineConfig(
  overrides: Partial<EngineConfig> = {},
): EngineConfig & { provider: Provider & { executeMock: ReturnType<typeof vi.fn> } } {
  const provider = createMockProvider(overrides.provider as Partial<Provider> | undefined);
  return {
    provider,
    agents: overrides.agents ?? {},
    cache: overrides.cache ?? new CacheManager({ defaultTtl: 300_000 }),
    defaultModel: overrides.defaultModel ?? "test-model",
    defaultCacheTtl: overrides.defaultCacheTtl ?? 300_000,
    defaultMaxTokens: overrides.defaultMaxTokens ?? 4096,
    ...overrides,
    // Ensure provider is ours
  } as EngineConfig & { provider: Provider & { executeMock: ReturnType<typeof vi.fn> } };
}

function makeAgent(
  overrides: Partial<AgentConfig<unknown, unknown>> = {},
): AgentConfig<unknown, unknown> {
  return {
    name: overrides.name ?? "testAgent",
    systemPrompt: "You are a test agent.",
    ...overrides,
  };
}

// ============================================================
// ExecutionEngine
// ============================================================

describe("ExecutionEngine", () => {
  let engine: ExecutionEngine;
  let config: ReturnType<typeof createEngineConfig>;

  beforeEach(() => {
    config = createEngineConfig({
      agents: {
        testAgent: makeAgent({ name: "testAgent" }),
      },
    });
    engine = new ExecutionEngine(config);
  });

  // --------------------------------------------------------
  // execute — basic
  // --------------------------------------------------------

  describe("execute", () => {
    it("should execute an agent and return a result", async () => {
      const result = await engine.execute("testAgent", "hello");

      expect(result.data).toBe("mock response");
      expect(result.raw).toBe("mock response");
      expect(result.fromCache).toBe(false);
      expect(result.agentName).toBe("testAgent");
      expect(result.usage.totalTokens).toBe(30);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should throw AgentNotFoundError for unknown agent", async () => {
      await expect(engine.execute("unknown", "input")).rejects.toThrow(
        AgentNotFoundError,
      );
    });

    it("should pass the correct model to the provider", async () => {
      config.agents.customModel = makeAgent({
        name: "customModel",
        model: "custom-model-v2",
      });
      engine = new ExecutionEngine(config);

      await engine.execute("customModel", "test");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: "custom-model-v2" }),
      );
    });

    it("should use defaultModel when agent has no model override", async () => {
      await engine.execute("testAgent", "test");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: "test-model" }),
      );
    });

    it("should use buildMessages when defined on the agent", async () => {
      config.agents.custom = makeAgent({
        name: "custom",
        buildMessages: (input) => [
          { role: "user", content: `Custom: ${String(input)}` },
        ],
      });
      engine = new ExecutionEngine(config);

      await engine.execute("custom", "hello");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Custom: hello" }],
        }),
      );
    });

    it("should JSON.stringify non-string input when buildMessages is not defined", async () => {
      await engine.execute("testAgent", { key: "value" });
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: '{"key":"value"}' }],
        }),
      );
    });

    it("should pass string input directly as user message content", async () => {
      await engine.execute("testAgent", "plain string");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "plain string" }],
        }),
      );
    });

    it("should use parseResult to transform the raw output", async () => {
      config.agents.parser = makeAgent({
        name: "parser",
        parseResult: (raw) => JSON.parse(raw),
      });
      engine = new ExecutionEngine(config);
      config.provider.executeMock.mockResolvedValueOnce({
        content: '{"parsed":true}',
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        stopReason: "end_turn",
      });

      const result = await engine.execute("parser", "test");
      expect(result.data).toEqual({ parsed: true });
    });

    it("should pass systemPrompt to the provider", async () => {
      config.agents.withPrompt = makeAgent({
        name: "withPrompt",
        systemPrompt: "Be helpful.",
      });
      engine = new ExecutionEngine(config);

      await engine.execute("withPrompt", "test");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "Be helpful." }),
      );
    });

    it("should pass temperature to the provider", async () => {
      config.agents.withTemp = makeAgent({
        name: "withTemp",
        temperature: 0.7,
      });
      engine = new ExecutionEngine(config);

      await engine.execute("withTemp", "test");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 }),
      );
    });
  });

  // --------------------------------------------------------
  // Cache hits
  // --------------------------------------------------------

  describe("cache hits", () => {
    it("should return cached result on second call with same input", async () => {
      const result1 = await engine.execute("testAgent", "cached input");
      expect(result1.fromCache).toBe(false);

      const result2 = await engine.execute("testAgent", "cached input");
      expect(result2.fromCache).toBe(true);
      expect(result2.data).toBe("mock response");
      expect(result2.usage.totalTokens).toBe(0);
    });

    it("should not use cache when input differs", async () => {
      await engine.execute("testAgent", "input A");
      await engine.execute("testAgent", "input B");

      expect(config.provider.executeMock).toHaveBeenCalledTimes(2);
    });

    it("should call onCacheHit callback on cache hits", async () => {
      const onCacheHit = vi.fn();
      config.onCacheHit = onCacheHit;
      engine = new ExecutionEngine(config);

      await engine.execute("testAgent", "test");
      expect(onCacheHit).not.toHaveBeenCalled();

      await engine.execute("testAgent", "test");
      expect(onCacheHit).toHaveBeenCalledWith("testAgent", expect.any(String));
    });

    it("should not cache when cacheTtl is 0", async () => {
      config.agents.noCache = makeAgent({ name: "noCache", cacheTtl: 0 });
      engine = new ExecutionEngine(config);

      await engine.execute("noCache", "test");
      await engine.execute("noCache", "test");

      expect(config.provider.executeMock).toHaveBeenCalledTimes(2);
    });

    it("should resolve tags from providesTags and store them in cache", async () => {
      config.agents.tagged = makeAgent({
        name: "tagged",
        providesTags: [{ type: "Research", id: "1" }],
      });
      engine = new ExecutionEngine(config);

      const result = await engine.execute("tagged", "test");
      expect(result.tags).toEqual([{ type: "Research", id: "1" }]);
    });

    it("should resolve function-based providesTags at runtime", async () => {
      config.agents.dynTag = makeAgent({
        name: "dynTag",
        providesTags: (result: unknown) => [{ type: "Result", id: String(result) }],
      });
      engine = new ExecutionEngine(config);

      const result = await engine.execute("dynTag", "test");
      expect(result.tags).toEqual([{ type: "Result", id: "mock response" }]);
    });
  });

  // --------------------------------------------------------
  // Tool loop
  // --------------------------------------------------------

  describe("tool loop", () => {
    it("should execute tool handlers when provider returns tool_use", async () => {
      const handler = vi.fn().mockResolvedValue("tool result text");
      config.agents.toolAgent = makeAgent({
        name: "toolAgent",
        tools: {
          myTool: {
            definition: {
              name: "myTool",
              description: "A test tool",
              inputSchema: { type: "object" },
            },
            handler,
          },
        },
      });
      engine = new ExecutionEngine(config);

      // First call: tool_use, second call: end_turn
      config.provider.executeMock
        .mockResolvedValueOnce({
          content: "Let me call a tool",
          toolCalls: [{ id: "tc1", name: "myTool", input: { key: "val" } }],
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          content: "Final answer with tool result",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          stopReason: "end_turn",
        });

      const result = await engine.execute("toolAgent", "test");
      expect(handler).toHaveBeenCalledWith({ key: "val" });
      expect(result.data).toBe("Final answer with tool result");
      expect(result.usage.totalTokens).toBe(30); // 10 + 20
    });

    it("should throw ToolExecutionError when handler throws", async () => {
      config.agents.failTool = makeAgent({
        name: "failTool",
        tools: {
          badTool: {
            definition: {
              name: "badTool",
              description: "A tool that fails",
              inputSchema: {},
            },
            handler: () => {
              throw new Error("tool broke");
            },
          },
        },
      });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockResolvedValueOnce({
        content: "Using tool",
        toolCalls: [{ id: "tc1", name: "badTool", input: {} }],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "tool_use",
      });

      await expect(engine.execute("failTool", "test")).rejects.toThrow(
        ToolExecutionError,
      );
    });

    it("should throw ToolExecutionError when tool name has no registered handler", async () => {
      config.agents.noHandler = makeAgent({
        name: "noHandler",
        tools: {},
      });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockResolvedValueOnce({
        content: "Calling unknown tool",
        toolCalls: [{ id: "tc1", name: "unknownTool", input: {} }],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "tool_use",
      });

      await expect(engine.execute("noHandler", "test")).rejects.toThrow(
        ToolExecutionError,
      );
    });

    it("should throw MaxToolRoundsError when tool loop exceeds maxToolRounds", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      config.agents.looper = makeAgent({
        name: "looper",
        maxToolRounds: 2,
        tools: {
          myTool: {
            definition: { name: "myTool", description: "test", inputSchema: {} },
            handler,
          },
        },
      });
      engine = new ExecutionEngine(config);

      // Every call returns tool_use — never finishes
      config.provider.executeMock.mockResolvedValue({
        content: "calling tool",
        toolCalls: [{ id: "tc1", name: "myTool", input: {} }],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "tool_use",
      });

      await expect(engine.execute("looper", "test")).rejects.toThrow(
        MaxToolRoundsError,
      );
    });

    it("should pass tool definitions to the provider", async () => {
      const toolDef = {
        name: "searchTool",
        description: "Searches the web",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      };
      config.agents.withTools = makeAgent({
        name: "withTools",
        tools: {
          searchTool: {
            definition: toolDef,
            handler: () => "result",
          },
        },
      });
      engine = new ExecutionEngine(config);

      await engine.execute("withTools", "test");
      expect(config.provider.executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [toolDef],
        }),
      );
    });
  });

  // --------------------------------------------------------
  // Retry
  // --------------------------------------------------------

  describe("retry", () => {
    it("should retry on provider failure and succeed", async () => {
      config.agents.retryAgent = makeAgent({
        name: "retryAgent",
        retry: { maxRetries: 2, backoffMs: 1 },
      });
      engine = new ExecutionEngine(config);

      config.provider.executeMock
        .mockRejectedValueOnce(new Error("transient error"))
        .mockResolvedValueOnce({
          content: "success after retry",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          stopReason: "end_turn",
        });

      const result = await engine.execute("retryAgent", "test");
      expect(result.data).toBe("success after retry");
      expect(config.provider.executeMock).toHaveBeenCalledTimes(2);
    });

    it("should throw ProviderError after exhausting all retries", async () => {
      config.agents.failAgent = makeAgent({
        name: "failAgent",
        retry: { maxRetries: 1, backoffMs: 1 },
      });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockRejectedValue(new Error("permanent error"));

      await expect(engine.execute("failAgent", "test")).rejects.toThrow(
        ProviderError,
      );
      // 1 initial + 1 retry = 2 calls
      expect(config.provider.executeMock).toHaveBeenCalledTimes(2);
    });

    it("should use default retries (2) when retry config is not specified", async () => {
      // Default: maxRetries = 2
      config.provider.executeMock.mockRejectedValue(new Error("fail"));

      await expect(engine.execute("testAgent", "test")).rejects.toThrow(
        ProviderError,
      );
      // 1 initial + 2 retries = 3 calls
      expect(config.provider.executeMock).toHaveBeenCalledTimes(3);
    });
  });

  // --------------------------------------------------------
  // Callbacks
  // --------------------------------------------------------

  describe("callbacks", () => {
    it("should call onExecutionStart before executing", async () => {
      const onStart = vi.fn();
      config.onExecutionStart = onStart;
      engine = new ExecutionEngine(config);

      await engine.execute("testAgent", "hello");
      expect(onStart).toHaveBeenCalledWith("testAgent", "hello");
    });

    it("should call onExecutionComplete after executing", async () => {
      const onComplete = vi.fn();
      config.onExecutionComplete = onComplete;
      engine = new ExecutionEngine(config);

      await engine.execute("testAgent", "hello");
      expect(onComplete).toHaveBeenCalledWith(
        "testAgent",
        expect.objectContaining({ agentName: "testAgent", data: "mock response" }),
      );
    });

    it("should call onError when execution fails", async () => {
      const onError = vi.fn();
      config.onError = onError;
      config.agents.failAgent = makeAgent({
        name: "failAgent",
        retry: { maxRetries: 0, backoffMs: 1 },
      });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockRejectedValue(new Error("boom"));

      await expect(engine.execute("failAgent", "test")).rejects.toThrow();
      expect(onError).toHaveBeenCalledWith("failAgent", expect.any(ProviderError));
    });
  });

  // --------------------------------------------------------
  // Tag invalidation on execute
  // --------------------------------------------------------

  describe("tag invalidation", () => {
    it("should invalidate cache entries matching agent's invalidatesTags", async () => {
      // First, cache something with a Research tag
      config.agents.researcher = makeAgent({
        name: "researcher",
        providesTags: [{ type: "Research" }],
      });
      config.agents.writer = makeAgent({
        name: "writer",
        invalidatesTags: ["Research"],
      });
      engine = new ExecutionEngine(config);

      // Run researcher — result gets cached with Research tag
      await engine.execute("researcher", "test");

      // Run writer — should invalidate Research cache entries
      await engine.execute("writer", "write something");

      // Run researcher again — should NOT be cached (was invalidated)
      const result = await engine.execute("researcher", "test");
      expect(result.fromCache).toBe(false);
      // 3 provider calls total: researcher, writer, researcher again
      expect(config.provider.executeMock).toHaveBeenCalledTimes(3);
    });
  });

  // --------------------------------------------------------
  // Pipeline
  // --------------------------------------------------------

  describe("executePipeline", () => {
    it("should execute agents in order and chain outputs", async () => {
      config.agents.step1 = makeAgent({ name: "step1" });
      config.agents.step2 = makeAgent({ name: "step2" });
      engine = new ExecutionEngine(config);

      config.provider.executeMock
        .mockResolvedValueOnce({
          content: "step1 output",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          content: "step2 output",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          stopReason: "end_turn",
        });

      const pipelineResult = await engine.executePipeline(
        ["step1", "step2"],
        "initial input",
      );

      expect(pipelineResult.results.step1).toBeDefined();
      expect(pipelineResult.results.step2).toBeDefined();
      expect(pipelineResult.finalResult.data).toBe("step2 output");
      expect(pipelineResult.totalUsage.totalTokens).toBe(30);
      expect(pipelineResult.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should pass initialInput to first agent and chain outputs by default", async () => {
      // Use tag dependencies to force sequential execution (a -> b)
      config.agents.a = makeAgent({ name: "a", providesTags: ["StepA"] });
      config.agents.b = makeAgent({ name: "b", invalidatesTags: ["StepA"] });
      engine = new ExecutionEngine(config);

      config.provider.executeMock
        .mockResolvedValueOnce({
          content: "a-output",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          content: "b-output",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          stopReason: "end_turn",
        });

      await engine.executePipeline(["a", "b"], "start");

      // First call gets "start"
      expect(config.provider.executeMock.mock.calls[0]![0].messages).toEqual([
        { role: "user", content: "start" },
      ]);
      // Second call gets "a-output" (chained)
      expect(config.provider.executeMock.mock.calls[1]![0].messages).toEqual([
        { role: "user", content: "a-output" },
      ]);
    });

    it("should use initialInput for all agents when chainOutputs is false", async () => {
      config.agents.a = makeAgent({ name: "a" });
      config.agents.b = makeAgent({ name: "b" });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockResolvedValue({
        content: "output",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "end_turn",
      });

      await engine.executePipeline(["a", "b"], "same-for-all", {
        chainOutputs: false,
      });

      // Both calls get the same initial input
      for (const call of config.provider.executeMock.mock.calls) {
        expect(call[0].messages).toEqual([
          { role: "user", content: "same-for-all" },
        ]);
      }
    });

    it("should respect inputOverrides per agent", async () => {
      config.agents.a = makeAgent({ name: "a" });
      config.agents.b = makeAgent({ name: "b" });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockResolvedValue({
        content: "output",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "end_turn",
      });

      await engine.executePipeline(["a", "b"], "initial", {
        inputOverrides: { b: "overridden input for b" },
      });

      // b should get the override, not the chained output
      expect(config.provider.executeMock.mock.calls[1]![0].messages).toEqual([
        { role: "user", content: "overridden input for b" },
      ]);
    });

    it("should call onStepComplete for each completed step", async () => {
      config.agents.a = makeAgent({ name: "a" });
      config.agents.b = makeAgent({ name: "b" });
      engine = new ExecutionEngine(config);

      config.provider.executeMock.mockResolvedValue({
        content: "out",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "end_turn",
      });

      const onStep = vi.fn();
      await engine.executePipeline(["a", "b"], "input", {
        onStepComplete: onStep,
      });

      expect(onStep).toHaveBeenCalledTimes(2);
      expect(onStep).toHaveBeenCalledWith("a", expect.objectContaining({ agentName: "a" }));
      expect(onStep).toHaveBeenCalledWith("b", expect.objectContaining({ agentName: "b" }));
    });
  });

  // --------------------------------------------------------
  // Streaming
  // --------------------------------------------------------

  describe("stream", () => {
    it("should yield stream events from the provider", async () => {
      const events: StreamEvent[] = [];
      for await (const event of engine.stream("testAgent", "hello")) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text_delta", text: "hello " });
      expect(events[1]).toEqual({ type: "text_delta", text: "world" });
      expect(events[2]).toEqual({ type: "complete" });
    });

    it("should throw AgentNotFoundError for unknown agent in stream", async () => {
      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of engine.stream("unknown", "input")) {
          // drain
        }
      }).rejects.toThrow(AgentNotFoundError);
    });
  });

  // --------------------------------------------------------
  // Usage tracking
  // --------------------------------------------------------

  describe("usage tracking", () => {
    it("should accumulate usage across executions", async () => {
      await engine.execute("testAgent", "input1");
      await engine.execute("testAgent", "input2");

      const usage = engine.getUsage();
      expect(usage.inputTokens).toBe(20); // 10 + 10
      expect(usage.outputTokens).toBe(40); // 20 + 20
      expect(usage.totalTokens).toBe(60); // 30 + 30
    });

    it("should not count cached results in cumulative usage", async () => {
      await engine.execute("testAgent", "same input");
      await engine.execute("testAgent", "same input"); // cached

      const usage = engine.getUsage();
      expect(usage.totalTokens).toBe(30); // only first call counted
    });

    it("should reset usage counters", async () => {
      await engine.execute("testAgent", "input");
      engine.resetUsage();

      const usage = engine.getUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    it("should return a copy of usage (not the internal reference)", () => {
      const usage1 = engine.getUsage();
      usage1.totalTokens = 999;
      const usage2 = engine.getUsage();
      expect(usage2.totalTokens).not.toBe(999);
    });
  });
});
