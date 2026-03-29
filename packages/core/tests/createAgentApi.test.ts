import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentApi } from "../src/createAgentApi.js";
import type {
  Provider,
  ProviderExecuteParams,
  ProviderExecuteResult,
  StreamEvent,
  AgentApiConfig,
  AgentApi,
} from "../src/types.js";
import { AgentNotFoundError } from "../src/errors.js";

// ============================================================
// Mock Provider
// ============================================================

function createMockProvider(): Provider & {
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn<
    (params: ProviderExecuteParams) => Promise<ProviderExecuteResult>
  >();
  executeMock.mockResolvedValue({
    content: "api mock response",
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    stopReason: "end_turn",
  });

  return {
    name: "mock-provider",
    execute: executeMock,
    stream: async function* () {
      yield { type: "text_delta", text: "streamed" } as StreamEvent;
      yield { type: "complete" } as StreamEvent;
    },
    executeMock,
  };
}

// ============================================================
// createAgentApi
// ============================================================

describe("createAgentApi", () => {
  let provider: ReturnType<typeof createMockProvider>;
  let api: AgentApi;

  beforeEach(() => {
    provider = createMockProvider();
    api = createAgentApi({
      name: "test-api",
      provider,
      defaultModel: "test-model",
      agents: {
        greeter: {
          name: "greeter",
          systemPrompt: "You greet people.",
        },
        farewell: {
          name: "farewell",
          systemPrompt: "You say goodbye.",
          providesTags: ["Farewell"],
        },
      },
    });
  });

  // --------------------------------------------------------
  // API shape
  // --------------------------------------------------------

  describe("API shape", () => {
    it("should return an object with execute", () => {
      expect(typeof api.execute).toBe("function");
    });

    it("should return an object with stream", () => {
      expect(typeof api.stream).toBe("function");
    });

    it("should return an object with executePipeline", () => {
      expect(typeof api.executePipeline).toBe("function");
    });

    it("should return an object with getExecutionPlan", () => {
      expect(typeof api.getExecutionPlan).toBe("function");
    });

    it("should return an object with invalidateTags", () => {
      expect(typeof api.invalidateTags).toBe("function");
    });

    it("should return an object with clearCache", () => {
      expect(typeof api.clearCache).toBe("function");
    });

    it("should return an object with getCacheEntry", () => {
      expect(typeof api.getCacheEntry).toBe("function");
    });

    it("should return an object with getUsage", () => {
      expect(typeof api.getUsage).toBe("function");
    });

    it("should return an object with resetUsage", () => {
      expect(typeof api.resetUsage).toBe("function");
    });
  });

  // --------------------------------------------------------
  // Delegation to engine
  // --------------------------------------------------------

  describe("execute", () => {
    it("should delegate to the engine and return a result", async () => {
      const result = await api.execute("greeter", "Hello!");
      expect(result.data).toBe("api mock response");
      expect(result.agentName).toBe("greeter");
      expect(result.fromCache).toBe(false);
    });

    it("should throw AgentNotFoundError for an unknown agent", async () => {
      await expect(api.execute("nonexistent", "test")).rejects.toThrow(
        AgentNotFoundError,
      );
    });
  });

  describe("stream", () => {
    it("should delegate to the engine and yield events", async () => {
      const events: StreamEvent[] = [];
      for await (const event of api.stream("greeter", "Hi")) {
        events.push(event);
      }
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("text_delta");
      expect(events[1]!.type).toBe("complete");
    });
  });

  describe("getExecutionPlan", () => {
    it("should return an execution plan for given agents", () => {
      const plan = api.getExecutionPlan(["greeter", "farewell"]);
      expect(plan.steps).toHaveLength(2);
      expect(plan.totalGroups).toBeGreaterThanOrEqual(1);
    });

    it("should throw AgentNotFoundError for unknown agent in plan", () => {
      expect(() => api.getExecutionPlan(["unknown"])).toThrow(
        AgentNotFoundError,
      );
    });
  });

  describe("invalidateTags", () => {
    it("should invalidate cache entries with matching tags", async () => {
      // Execute to populate cache
      await api.execute("farewell", "bye");
      expect((await api.execute("farewell", "bye")).fromCache).toBe(true);

      // Invalidate the Farewell tag
      api.invalidateTags(["Farewell"]);

      // Should no longer be cached
      const result = await api.execute("farewell", "bye");
      expect(result.fromCache).toBe(false);
    });
  });

  describe("clearCache", () => {
    it("should remove all cached entries", async () => {
      await api.execute("greeter", "hello");
      expect((await api.execute("greeter", "hello")).fromCache).toBe(true);

      api.clearCache();

      const result = await api.execute("greeter", "hello");
      expect(result.fromCache).toBe(false);
    });
  });

  describe("getCacheEntry", () => {
    it("should return undefined for unknown cache key", () => {
      const entry = api.getCacheEntry("greeter", "nonexistent-hash");
      expect(entry).toBeUndefined();
    });
  });

  describe("getUsage and resetUsage", () => {
    it("should return cumulative usage after executions", async () => {
      await api.execute("greeter", "hello");
      const usage = api.getUsage();
      expect(usage.totalTokens).toBe(30);
    });

    it("should reset usage counters", async () => {
      await api.execute("greeter", "hello");
      api.resetUsage();
      const usage = api.getUsage();
      expect(usage.totalTokens).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Config defaults
  // --------------------------------------------------------

  describe("config defaults", () => {
    it("should use default cache TTL of 300_000 when not specified", async () => {
      // Execute and verify caching works (implies TTL > 0)
      await api.execute("greeter", "test");
      const result2 = await api.execute("greeter", "test");
      expect(result2.fromCache).toBe(true);
    });

    it("should pass onExecutionStart callback through", async () => {
      const onStart = vi.fn();
      const apiWithCallbacks = createAgentApi({
        name: "cb-api",
        provider,
        defaultModel: "test-model",
        agents: {
          agent: { name: "agent", systemPrompt: "test" },
        },
        onExecutionStart: onStart,
      });

      await apiWithCallbacks.execute("agent", "hello");
      expect(onStart).toHaveBeenCalledWith("agent", "hello");
    });

    it("should pass onError callback through", async () => {
      const onError = vi.fn();
      provider.executeMock.mockRejectedValue(new Error("fail"));
      const apiWithError = createAgentApi({
        name: "err-api",
        provider,
        defaultModel: "test-model",
        agents: {
          agent: {
            name: "agent",
            systemPrompt: "test",
            retry: { maxRetries: 0, backoffMs: 1 },
          },
        },
        onError,
      });

      await expect(apiWithError.execute("agent", "test")).rejects.toThrow();
      expect(onError).toHaveBeenCalled();
    });
  });
});
