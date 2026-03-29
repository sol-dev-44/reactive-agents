import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentApi } from "../src/createAgentApi.js";
import type {
  Provider,
  ProviderExecuteParams,
  ProviderExecuteResult,
  StreamEvent,
  AgentApi,
  AgentConfig,
} from "../src/types.js";

// ============================================================
// Shared Mock Provider for Integration Tests
// ============================================================

function createMockProvider(): Provider & {
  executeMock: ReturnType<typeof vi.fn>;
} {
  const executeMock = vi.fn<
    (params: ProviderExecuteParams) => Promise<ProviderExecuteResult>
  >();

  return {
    name: "integration-mock",
    execute: executeMock,
    stream: async function* () {
      yield { type: "text_delta", text: "stream chunk" } as StreamEvent;
      yield { type: "complete" } as StreamEvent;
    },
    executeMock,
  };
}

// Helper to set up a sequential mock: each call returns the next response
function setupSequentialResponses(
  executeMock: ReturnType<typeof vi.fn>,
  responses: Array<{ content: string; tokens?: number }>,
) {
  for (const resp of responses) {
    const tokens = resp.tokens ?? 10;
    executeMock.mockResolvedValueOnce({
      content: resp.content,
      toolCalls: [],
      usage: {
        inputTokens: tokens,
        outputTokens: tokens,
        totalTokens: tokens * 2,
      },
      stopReason: "end_turn",
    } as ProviderExecuteResult);
  }
}

// ============================================================
// Integration Tests
// ============================================================

describe("Integration: 3-agent pipeline with mock provider", () => {
  let provider: ReturnType<typeof createMockProvider>;
  let api: AgentApi;

  beforeEach(() => {
    provider = createMockProvider();
  });

  // --------------------------------------------------------
  // 3-Agent Pipeline: Researcher -> Writer -> Editor
  // --------------------------------------------------------

  describe("Researcher -> Writer -> Editor pipeline", () => {
    beforeEach(() => {
      api = createAgentApi({
        name: "content-pipeline",
        provider,
        defaultModel: "test-model",
        agents: {
          researcher: {
            name: "researcher",
            systemPrompt: "You research topics and return facts.",
            providesTags: [{ type: "Research" }],
          },
          writer: {
            name: "writer",
            systemPrompt: "You write articles from research.",
            invalidatesTags: ["Research"],
            providesTags: [{ type: "Draft" }],
          },
          editor: {
            name: "editor",
            systemPrompt: "You edit and polish drafts.",
            invalidatesTags: ["Draft"],
            providesTags: [{ type: "FinalArticle" }],
          },
        },
      });
    });

    it("should execute a 3-agent pipeline in the correct order", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "Research facts about AI" },
        { content: "Article draft based on AI research" },
        { content: "Polished article about AI" },
      ]);

      const result = await api.executePipeline(
        ["researcher", "writer", "editor"],
        "Tell me about AI",
      );

      expect(result.finalResult.data).toBe("Polished article about AI");
      expect(result.results.researcher).toBeDefined();
      expect(result.results.writer).toBeDefined();
      expect(result.results.editor).toBeDefined();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should chain outputs so each agent gets the previous output", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "research output" },
        { content: "draft output" },
        { content: "final output" },
      ]);

      await api.executePipeline(
        ["researcher", "writer", "editor"],
        "initial topic",
      );

      // Researcher gets original input
      expect(provider.executeMock.mock.calls[0]![0].messages[0].content).toBe(
        "initial topic",
      );
      // Writer gets researcher's output
      expect(provider.executeMock.mock.calls[1]![0].messages[0].content).toBe(
        "research output",
      );
      // Editor gets writer's output
      expect(provider.executeMock.mock.calls[2]![0].messages[0].content).toBe(
        "draft output",
      );
    });

    it("should accumulate token usage across all pipeline steps", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "r", tokens: 10 },
        { content: "w", tokens: 20 },
        { content: "e", tokens: 30 },
      ]);

      const result = await api.executePipeline(
        ["researcher", "writer", "editor"],
        "topic",
      );

      expect(result.totalUsage.inputTokens).toBe(60); // 10+20+30
      expect(result.totalUsage.outputTokens).toBe(60);
      expect(result.totalUsage.totalTokens).toBe(120);
    });

    it("should report results keyed by agent name", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "r" },
        { content: "w" },
        { content: "e" },
      ]);

      const result = await api.executePipeline(
        ["researcher", "writer", "editor"],
        "topic",
      );

      expect(Object.keys(result.results)).toEqual(
        expect.arrayContaining(["researcher", "writer", "editor"]),
      );
      expect(result.results.researcher!.agentName).toBe("researcher");
      expect(result.results.writer!.agentName).toBe("writer");
      expect(result.results.editor!.agentName).toBe("editor");
    });
  });

  // --------------------------------------------------------
  // Cache invalidation across agents
  // --------------------------------------------------------

  describe("cache invalidation across agents", () => {
    beforeEach(() => {
      api = createAgentApi({
        name: "cache-test-api",
        provider,
        defaultModel: "test-model",
        agents: {
          fetcher: {
            name: "fetcher",
            systemPrompt: "Fetch data.",
            providesTags: [{ type: "Data", id: "main" }],
          },
          updater: {
            name: "updater",
            systemPrompt: "Update data.",
            invalidatesTags: [{ type: "Data" }],
          },
          reader: {
            name: "reader",
            systemPrompt: "Read data.",
            providesTags: [{ type: "Data", id: "secondary" }],
          },
        },
      });
    });

    it("should cache individual agent results", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "fetched data" },
      ]);

      const r1 = await api.execute("fetcher", "get data");
      expect(r1.fromCache).toBe(false);

      const r2 = await api.execute("fetcher", "get data");
      expect(r2.fromCache).toBe(true);
      expect(r2.data).toBe("fetched data");

      // Provider was only called once
      expect(provider.executeMock).toHaveBeenCalledTimes(1);
    });

    it("should invalidate fetcher cache when updater runs (wildcard tag)", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "original data" },
        { content: "update done" },
        { content: "refreshed data" },
      ]);

      // Cache fetcher result
      await api.execute("fetcher", "get data");

      // Run updater — invalidates Data tag (wildcard)
      await api.execute("updater", "update it");

      // Fetcher should no longer be cached
      const result = await api.execute("fetcher", "get data");
      expect(result.fromCache).toBe(false);
      expect(result.data).toBe("refreshed data");
    });

    it("should invalidate multiple agents sharing the same tag type", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "fetcher result" },
        { content: "reader result" },
        { content: "update result" },
        { content: "fetcher re-run" },
        { content: "reader re-run" },
      ]);

      // Populate both caches
      await api.execute("fetcher", "f-input");
      await api.execute("reader", "r-input");

      // Updater invalidates Data wildcard — should clear both
      await api.execute("updater", "go");

      const fetcherResult = await api.execute("fetcher", "f-input");
      expect(fetcherResult.fromCache).toBe(false);

      const readerResult = await api.execute("reader", "r-input");
      expect(readerResult.fromCache).toBe(false);
    });

    it("should invalidate via specific tag id only matching entries", async () => {
      const specificApi = createAgentApi({
        name: "specific-api",
        provider,
        defaultModel: "test-model",
        agents: {
          fetcher: {
            name: "fetcher",
            systemPrompt: "Fetch",
            providesTags: [{ type: "Item", id: "1" }],
          },
          other: {
            name: "other",
            systemPrompt: "Other",
            providesTags: [{ type: "Item", id: "2" }],
          },
        },
      });

      setupSequentialResponses(provider.executeMock, [
        { content: "item-1" },
        { content: "item-2" },
      ]);

      await specificApi.execute("fetcher", "get 1");
      await specificApi.execute("other", "get 2");

      // Invalidate only Item id=1
      specificApi.invalidateTags([{ type: "Item", id: "1" }]);

      // fetcher should be invalidated, other should still be cached
      setupSequentialResponses(provider.executeMock, [{ content: "item-1-new" }]);

      const fetcherResult = await specificApi.execute("fetcher", "get 1");
      expect(fetcherResult.fromCache).toBe(false);

      const otherResult = await specificApi.execute("other", "get 2");
      expect(otherResult.fromCache).toBe(true);
    });

    it("should support manual cache clear", async () => {
      setupSequentialResponses(provider.executeMock, [
        { content: "data" },
        { content: "data again" },
      ]);

      await api.execute("fetcher", "test");
      api.clearCache();

      const result = await api.execute("fetcher", "test");
      expect(result.fromCache).toBe(false);
    });
  });

  // --------------------------------------------------------
  // Parallel execution
  // --------------------------------------------------------

  describe("parallel execution", () => {
    it("should run independent agents in parallel within a pipeline", async () => {
      const parallelApi = createAgentApi({
        name: "parallel-api",
        provider,
        defaultModel: "test-model",
        agents: {
          a: { name: "a", systemPrompt: "Agent A" },
          b: { name: "b", systemPrompt: "Agent B" },
          c: { name: "c", systemPrompt: "Agent C" },
        },
      });

      // All three are independent — should be in the same parallel group
      const plan = parallelApi.getExecutionPlan(["a", "b", "c"]);
      expect(plan.totalGroups).toBe(1);

      // All in group 0
      for (const step of plan.steps) {
        expect(step.parallelGroup).toBe(0);
      }
    });

    it("should execute parallel agents and aggregate results", async () => {
      const parallelApi = createAgentApi({
        name: "parallel-api",
        provider,
        defaultModel: "test-model",
        agents: {
          a: { name: "a", systemPrompt: "Agent A" },
          b: { name: "b", systemPrompt: "Agent B" },
        },
      });

      // Both respond at same time
      provider.executeMock.mockResolvedValue({
        content: "parallel result",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "end_turn",
      });

      const result = await parallelApi.executePipeline(["a", "b"], "input");
      expect(result.results.a).toBeDefined();
      expect(result.results.b).toBeDefined();
    });

    it("should correctly order dependent agents in parallel pipeline", async () => {
      const depApi = createAgentApi({
        name: "dep-api",
        provider,
        defaultModel: "test-model",
        agents: {
          source: {
            name: "source",
            systemPrompt: "Source",
            providesTags: ["Data"],
          },
          consumer: {
            name: "consumer",
            systemPrompt: "Consumer",
            invalidatesTags: ["Data"],
          },
        },
      });

      const plan = depApi.getExecutionPlan(["source", "consumer"]);
      expect(plan.totalGroups).toBe(2);

      const sourceStep = plan.steps.find((s) => s.agentName === "source")!;
      const consumerStep = plan.steps.find((s) => s.agentName === "consumer")!;
      expect(sourceStep.parallelGroup).toBeLessThan(consumerStep.parallelGroup);
    });
  });

  // --------------------------------------------------------
  // End-to-end with tools
  // --------------------------------------------------------

  describe("end-to-end with tools", () => {
    it("should handle a pipeline where one agent uses tools", async () => {
      const searchHandler = vi.fn().mockResolvedValue("Search result: AI is cool");

      const toolApi = createAgentApi({
        name: "tool-api",
        provider,
        defaultModel: "test-model",
        agents: {
          researcher: {
            name: "researcher",
            systemPrompt: "Research using tools.",
            providesTags: ["Research"],
            tools: {
              search: {
                definition: {
                  name: "search",
                  description: "Search the web",
                  inputSchema: { type: "object", properties: { query: { type: "string" } } },
                },
                handler: searchHandler,
              },
            },
          },
          summarizer: {
            name: "summarizer",
            systemPrompt: "Summarize research.",
            invalidatesTags: ["Research"],
          },
        },
      });

      // Researcher: first call returns tool_use, second returns final
      provider.executeMock
        .mockResolvedValueOnce({
          content: "I need to search",
          toolCalls: [{ id: "tc1", name: "search", input: { query: "AI" } }],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          content: "Research complete: AI is fascinating",
          toolCalls: [],
          usage: { inputTokens: 15, outputTokens: 15, totalTokens: 30 },
          stopReason: "end_turn",
        })
        // Summarizer: direct response
        .mockResolvedValueOnce({
          content: "Summary: AI is fascinating and cool",
          toolCalls: [],
          usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
          stopReason: "end_turn",
        });

      const result = await toolApi.executePipeline(
        ["researcher", "summarizer"],
        "Tell me about AI",
      );

      expect(searchHandler).toHaveBeenCalledWith({ query: "AI" });
      expect(result.results.researcher!.data).toBe(
        "Research complete: AI is fascinating",
      );
      expect(result.finalResult.data).toBe(
        "Summary: AI is fascinating and cool",
      );
    });
  });

  // --------------------------------------------------------
  // Usage tracking end-to-end
  // --------------------------------------------------------

  describe("usage tracking end-to-end", () => {
    it("should track cumulative usage across multiple execute calls", async () => {
      const usageApi = createAgentApi({
        name: "usage-api",
        provider,
        defaultModel: "test-model",
        agents: {
          agent: { name: "agent", systemPrompt: "test" },
        },
      });

      provider.executeMock.mockResolvedValue({
        content: "result",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
        stopReason: "end_turn",
      });

      await usageApi.execute("agent", "input1");
      await usageApi.execute("agent", "input2");

      const usage = usageApi.getUsage();
      expect(usage.inputTokens).toBe(200);
      expect(usage.outputTokens).toBe(400);
      expect(usage.totalTokens).toBe(600);
    });

    it("should not count cached results in usage", async () => {
      const usageApi = createAgentApi({
        name: "usage-api",
        provider,
        defaultModel: "test-model",
        agents: {
          agent: { name: "agent", systemPrompt: "test" },
        },
      });

      provider.executeMock.mockResolvedValue({
        content: "result",
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
        stopReason: "end_turn",
      });

      await usageApi.execute("agent", "same");
      await usageApi.execute("agent", "same"); // cached

      const usage = usageApi.getUsage();
      expect(usage.totalTokens).toBe(100); // only one real call
    });

    it("should reset usage independently of cache", async () => {
      const usageApi = createAgentApi({
        name: "usage-api",
        provider,
        defaultModel: "test-model",
        agents: {
          agent: { name: "agent", systemPrompt: "test" },
        },
      });

      provider.executeMock.mockResolvedValue({
        content: "result",
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
        stopReason: "end_turn",
      });

      await usageApi.execute("agent", "input");
      usageApi.resetUsage();

      const usage = usageApi.getUsage();
      expect(usage.totalTokens).toBe(0);

      // Cache should still work even after resetting usage
      const cached = await usageApi.execute("agent", "input");
      expect(cached.fromCache).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Pipeline with onStepComplete
  // --------------------------------------------------------

  describe("pipeline callbacks", () => {
    it("should fire onStepComplete for each agent in the pipeline", async () => {
      // Use tag dependencies to force sequential execution: a -> b -> c
      const pipeApi = createAgentApi({
        name: "pipe-api",
        provider,
        defaultModel: "test-model",
        agents: {
          a: { name: "a", systemPrompt: "A", providesTags: ["StepA"] },
          b: {
            name: "b",
            systemPrompt: "B",
            invalidatesTags: ["StepA"],
            providesTags: ["StepB"],
          },
          c: { name: "c", systemPrompt: "C", invalidatesTags: ["StepB"] },
        },
      });

      provider.executeMock.mockResolvedValue({
        content: "output",
        toolCalls: [],
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        stopReason: "end_turn",
      });

      const steps: string[] = [];
      await pipeApi.executePipeline(["a", "b", "c"], "start", {
        onStepComplete: (name) => steps.push(name),
      });

      expect(steps).toEqual(["a", "b", "c"]);
    });
  });

  // --------------------------------------------------------
  // Execution plan validation
  // --------------------------------------------------------

  describe("execution plan validation", () => {
    it("should produce a valid plan for the 3-agent content pipeline", () => {
      const contentApi = createAgentApi({
        name: "content-api",
        provider,
        defaultModel: "test-model",
        agents: {
          researcher: {
            name: "researcher",
            systemPrompt: "Research",
            providesTags: ["Research"],
          },
          writer: {
            name: "writer",
            systemPrompt: "Write",
            invalidatesTags: ["Research"],
            providesTags: ["Draft"],
          },
          editor: {
            name: "editor",
            systemPrompt: "Edit",
            invalidatesTags: ["Draft"],
          },
        },
      });

      const plan = contentApi.getExecutionPlan([
        "researcher",
        "writer",
        "editor",
      ]);

      expect(plan.totalGroups).toBe(3);
      expect(plan.steps).toHaveLength(3);

      const r = plan.steps.find((s) => s.agentName === "researcher")!;
      const w = plan.steps.find((s) => s.agentName === "writer")!;
      const e = plan.steps.find((s) => s.agentName === "editor")!;

      expect(r.parallelGroup).toBe(0);
      expect(w.parallelGroup).toBe(1);
      expect(e.parallelGroup).toBe(2);

      expect(r.dependsOn).toEqual([]);
      expect(w.dependsOn).toContain("researcher");
      expect(e.dependsOn).toContain("writer");
    });
  });
});
