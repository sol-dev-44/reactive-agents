import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentApi } from "@reactive-agent/core";
import { AgentApiProvider, useAgentApi } from "../src/context.js";

function createMockApi(): AgentApi {
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
  } as unknown as AgentApi;
}

describe("AgentApiContext", () => {
  describe("useAgentApi", () => {
    it("throws when used outside of AgentApiProvider", () => {
      // Suppress console.error from React for the expected error
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAgentApi());
      }).toThrow(
        "useAgentApi must be used within an AgentApiProvider",
      );

      spy.mockRestore();
    });

    it("returns the AgentApi when used inside AgentApiProvider", () => {
      const mockApi = createMockApi();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AgentApiProvider value={mockApi}>{children}</AgentApiProvider>
      );

      const { result } = renderHook(() => useAgentApi(), { wrapper });

      expect(result.current).toBe(mockApi);
    });

    it("returns the same api reference on re-renders", () => {
      const mockApi = createMockApi();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AgentApiProvider value={mockApi}>{children}</AgentApiProvider>
      );

      const { result, rerender } = renderHook(() => useAgentApi(), {
        wrapper,
      });

      const firstResult = result.current;
      rerender();
      expect(result.current).toBe(firstResult);
    });
  });
});
