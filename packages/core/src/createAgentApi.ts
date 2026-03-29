/**
 * createAgentApi() — The main entry point.
 *
 * Takes an AgentApiConfig, returns an AgentApi.
 * Thin wrapper that wires up CacheManager + ExecutionEngine.
 */

import type { AgentApiConfig, AgentApi, Tag } from "./types.js";
import { CacheManager } from "./cache.js";
import { ExecutionEngine } from "./engine.js";
import { buildExecutionPlan } from "./dag.js";

export function createAgentApi(config: AgentApiConfig): AgentApi {
  const cache = new CacheManager({
    defaultTtl: config.defaultCacheTtl ?? 300_000,
  });

  const engine = new ExecutionEngine({
    provider: config.provider,
    agents: config.agents,
    cache,
    defaultModel: config.defaultModel,
    defaultCacheTtl: config.defaultCacheTtl ?? 300_000,
    defaultMaxTokens: config.defaultMaxTokens ?? 4096,
    onExecutionStart: config.onExecutionStart,
    onExecutionComplete: config.onExecutionComplete,
    onCacheHit: config.onCacheHit,
    onError: config.onError,
  });

  return {
    execute: <TResult = string>(agentName: string, input: unknown) =>
      engine.execute<TResult>(agentName, input),
    stream: (agentName: string, input: unknown) =>
      engine.stream(agentName, input),
    executePipeline: (agentNames, initialInput, options) =>
      engine.executePipeline(agentNames, initialInput, options),
    getExecutionPlan: (agentNames) =>
      buildExecutionPlan(agentNames, config.agents),
    invalidateTags: (tags: Tag[]) => cache.invalidate(tags),
    clearCache: () => cache.clear(),
    getCacheEntry: (_agentName: string, inputHash: string) =>
      cache.getEntry(inputHash),
    getUsage: () => engine.getUsage(),
    resetUsage: () => engine.resetUsage(),
  };
}
