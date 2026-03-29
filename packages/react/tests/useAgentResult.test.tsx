import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentApi, CacheEntry } from "@reactive-agent/core";
import { AgentApiProvider } from "../src/context.js";
import { useAgentResult } from "../src/useAgentResult.js";

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

function createWrapper(api: AgentApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <AgentApiProvider value={api}>{children}</AgentApiProvider>;
  };
}

function createMockCacheEntry<T>(result: T): CacheEntry<T> {
  return {
    result,
    cachedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    inputHash: "abc123",
    tags: [],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  };
}

describe("useAgentResult", () => {
  it("returns isCached: false when no inputHash is provided", () => {
    const mockApi = createMockApi();

    const { result } = renderHook(() => useAgentResult("test-agent"), {
      wrapper: createWrapper(mockApi),
    });

    expect(result.current.result).toBeNull();
    expect(result.current.isCached).toBe(false);
    expect(mockApi.getCacheEntry).not.toHaveBeenCalled();
  });

  it("returns cached result when cache entry exists", () => {
    const cachedData = { summary: "cached summary" };
    const cacheEntry = createMockCacheEntry(cachedData);

    const mockApi = createMockApi({
      getCacheEntry: vi.fn().mockReturnValue(cacheEntry),
    });

    const { result } = renderHook(
      () => useAgentResult<{ summary: string }>("test-agent", "hash-abc"),
      { wrapper: createWrapper(mockApi) },
    );

    expect(result.current.result).toEqual(cachedData);
    expect(result.current.isCached).toBe(true);
    expect(mockApi.getCacheEntry).toHaveBeenCalledWith(
      "test-agent",
      "hash-abc",
    );
  });

  it("returns isCached: false when cache entry does not exist", () => {
    const mockApi = createMockApi({
      getCacheEntry: vi.fn().mockReturnValue(undefined),
    });

    const { result } = renderHook(
      () => useAgentResult("test-agent", "nonexistent-hash"),
      { wrapper: createWrapper(mockApi) },
    );

    expect(result.current.result).toBeNull();
    expect(result.current.isCached).toBe(false);
    expect(mockApi.getCacheEntry).toHaveBeenCalledWith(
      "test-agent",
      "nonexistent-hash",
    );
  });

  it("re-evaluates when inputHash changes", () => {
    const getCacheEntryFn = vi
      .fn()
      .mockReturnValueOnce(createMockCacheEntry("first"))
      .mockReturnValueOnce(undefined);

    const mockApi = createMockApi({ getCacheEntry: getCacheEntryFn });

    const { result, rerender } = renderHook(
      ({ hash }: { hash: string }) => useAgentResult("test-agent", hash),
      {
        wrapper: createWrapper(mockApi),
        initialProps: { hash: "hash-1" },
      },
    );

    expect(result.current.isCached).toBe(true);
    expect(result.current.result).toBe("first");

    // Change the hash
    rerender({ hash: "hash-2" });

    expect(result.current.isCached).toBe(false);
    expect(result.current.result).toBeNull();
    expect(getCacheEntryFn).toHaveBeenCalledTimes(2);
    expect(getCacheEntryFn).toHaveBeenCalledWith("test-agent", "hash-2");
  });

  it("re-evaluates when agentName changes", () => {
    const getCacheEntryFn = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(createMockCacheEntry("found"));

    const mockApi = createMockApi({ getCacheEntry: getCacheEntryFn });

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useAgentResult(name, "same-hash"),
      {
        wrapper: createWrapper(mockApi),
        initialProps: { name: "agent-a" },
      },
    );

    expect(result.current.isCached).toBe(false);

    rerender({ name: "agent-b" });

    expect(result.current.isCached).toBe(true);
    expect(result.current.result).toBe("found");
    expect(getCacheEntryFn).toHaveBeenCalledWith("agent-b", "same-hash");
  });
});
