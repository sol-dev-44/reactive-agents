import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AgentApi, AgentResult, StreamEvent } from "@reactive-agent/core";
import { AgentApiProvider } from "../src/context.js";
import { useAgent } from "../src/useAgent.js";

function createMockApi(overrides: Partial<AgentApi> = {}): AgentApi {
  return {
    execute: vi.fn(),
    stream: vi.fn(),
    executePipeline: vi.fn(),
    getExecutionPlan: vi.fn(),
    invalidateTags: vi.fn(),
    clearCache: vi.fn(),
    getCacheEntry: vi.fn(),
    getUsage: vi.fn(),
    resetUsage: vi.fn(),
    ...overrides,
  } as unknown as AgentApi;
}

function createMockResult<T = string>(
  data: T,
  agentName = "test-agent",
): AgentResult<T> {
  return {
    data,
    raw: typeof data === "string" ? data : JSON.stringify(data),
    fromCache: false,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    durationMs: 100,
    agentName,
    timestamp: Date.now(),
    tags: [],
  };
}

function createWrapper(api: AgentApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <AgentApiProvider value={api}>{children}</AgentApiProvider>;
  };
}

describe("useAgent", () => {
  let mockApi: AgentApi;

  beforeEach(() => {
    mockApi = createMockApi();
  });

  describe("initial state", () => {
    it("returns correct initial state", () => {
      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      expect(result.current.data).toBeNull();
      expect(result.current.result).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.streamingText).toBe("");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.execute).toBe("function");
      expect(typeof result.current.reset).toBe("function");
    });
  });

  describe("execute (non-streaming)", () => {
    it("sets isLoading to true while executing", async () => {
      let resolveExecute: (value: AgentResult<string>) => void;
      const executePromise = new Promise<AgentResult<string>>((resolve) => {
        resolveExecute = resolve;
      });

      mockApi = createMockApi({
        execute: vi.fn().mockReturnValue(executePromise),
      });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      // Start execution (don't await)
      let executeFinished = false;
      act(() => {
        result.current.execute("hello").then(() => {
          executeFinished = true;
        });
      });

      // Should be loading
      expect(result.current.isLoading).toBe(true);

      // Resolve
      await act(async () => {
        resolveExecute!(createMockResult("world"));
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it("sets data and result on successful execution", async () => {
      const mockResult = createMockResult("hello world");
      mockApi = createMockApi({
        execute: vi.fn().mockResolvedValue(mockResult),
      });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.data).toBe("hello world");
      expect(result.current.result).toBe(mockResult);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("calls api.execute with the correct agent name and input", async () => {
      const executeFn = vi.fn().mockResolvedValue(createMockResult("ok"));
      mockApi = createMockApi({ execute: executeFn });

      const { result } = renderHook(() => useAgent("my-agent"), {
        wrapper: createWrapper(mockApi),
      });

      await act(async () => {
        await result.current.execute({ prompt: "do something" });
      });

      expect(executeFn).toHaveBeenCalledWith("my-agent", {
        prompt: "do something",
      });
    });

    it("sets error on failed execution", async () => {
      const testError = new Error("Agent execution failed");
      mockApi = createMockApi({
        execute: vi.fn().mockRejectedValue(testError),
      });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.error).toBe(testError);
      expect(result.current.data).toBeNull();
      expect(result.current.result).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("wraps non-Error thrown values in an Error", async () => {
      mockApi = createMockApi({
        execute: vi.fn().mockRejectedValue("string error"),
      });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("string error");
    });

    it("clears previous error on new execution", async () => {
      const executeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("first error"))
        .mockResolvedValueOnce(createMockResult("success"));

      mockApi = createMockApi({ execute: executeFn });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      // First call fails
      await act(async () => {
        await result.current.execute("input");
      });
      expect(result.current.error).toBeTruthy();

      // Second call succeeds — error should be cleared
      await act(async () => {
        await result.current.execute("input");
      });
      expect(result.current.error).toBeNull();
      expect(result.current.data).toBe("success");
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", async () => {
      mockApi = createMockApi({
        execute: vi.fn().mockResolvedValue(createMockResult("data")),
      });

      const { result } = renderHook(() => useAgent("test-agent"), {
        wrapper: createWrapper(mockApi),
      });

      // Execute to populate state
      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.data).toBe("data");

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBeNull();
      expect(result.current.result).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.streamingText).toBe("");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe("streaming mode", () => {
    it("accumulates text from stream events", async () => {
      async function* mockStream(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", text: "Hello" };
        yield { type: "text_delta", text: " world" };
        yield { type: "complete" };
      }

      mockApi = createMockApi({
        stream: vi.fn().mockReturnValue(mockStream()),
      });

      const { result } = renderHook(
        () => useAgent("test-agent", { stream: true }),
        { wrapper: createWrapper(mockApi) },
      );

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.streamingText).toBe("Hello world");
      expect(result.current.data).toBe("Hello world");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it("calls api.stream with the correct agent name and input", async () => {
      async function* mockStream(): AsyncIterable<StreamEvent> {
        yield { type: "complete" };
      }

      const streamFn = vi.fn().mockReturnValue(mockStream());
      mockApi = createMockApi({ stream: streamFn });

      const { result } = renderHook(
        () => useAgent("my-agent", { stream: true }),
        { wrapper: createWrapper(mockApi) },
      );

      await act(async () => {
        await result.current.execute("stream input");
      });

      expect(streamFn).toHaveBeenCalledWith("my-agent", "stream input");
    });

    it("sets error when stream emits an error event", async () => {
      const streamError = new Error("Stream failed");

      async function* mockStream(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", text: "partial" };
        yield { type: "error", error: streamError };
      }

      mockApi = createMockApi({
        stream: vi.fn().mockReturnValue(mockStream()),
      });

      const { result } = renderHook(
        () => useAgent("test-agent", { stream: true }),
        { wrapper: createWrapper(mockApi) },
      );

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.error).toBe(streamError);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });

    it("handles empty stream gracefully", async () => {
      async function* mockStream(): AsyncIterable<StreamEvent> {
        yield { type: "complete" };
      }

      mockApi = createMockApi({
        stream: vi.fn().mockReturnValue(mockStream()),
      });

      const { result } = renderHook(
        () => useAgent("test-agent", { stream: true }),
        { wrapper: createWrapper(mockApi) },
      );

      await act(async () => {
        await result.current.execute("input");
      });

      expect(result.current.streamingText).toBe("");
      expect(result.current.data).toBe("");
      expect(result.current.isLoading).toBe(false);
    });
  });
});
