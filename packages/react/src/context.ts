import { createContext, useContext } from "react";
import type { AgentApi } from "@reactive-agents/core";

/**
 * React context for providing an AgentApi instance to the component tree.
 */
export const AgentApiContext = createContext<AgentApi | null>(null);

/**
 * Provider component for AgentApi.
 * Wrap your app (or a subtree) to make the AgentApi available to hooks.
 */
export const AgentApiProvider = AgentApiContext.Provider;

/**
 * Hook to access the AgentApi from context.
 * Must be used inside an AgentApiProvider.
 *
 * @throws Error if called outside of an AgentApiProvider
 */
export function useAgentApi(): AgentApi {
  const api = useContext(AgentApiContext);
  if (api === null) {
    throw new Error(
      "useAgentApi must be used within an AgentApiProvider. " +
        "Wrap your component tree with <AgentApiProvider value={api}>.",
    );
  }
  return api;
}
