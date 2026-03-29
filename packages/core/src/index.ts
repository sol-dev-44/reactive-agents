// Main entry point
export { createAgentApi } from "./createAgentApi.js";

// Types — re-export everything
export type {
  AgentConfig,
  AgentApiConfig,
  AgentApi,
  AgentResult,
  AgentMessage,
  CacheEntry,
  ExecutionPlan,
  ExecutionStep,
  PipelineOptions,
  PipelineResult,
  Provider,
  ProviderExecuteParams,
  ProviderExecuteResult,
  StreamEvent,
  Tag,
  TagDescription,
  TagType,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ToolHandler,
  ToolResult,
  ProvidesTagsFn,
  InvalidatesTagsFn,
} from "./types.js";

// Utilities (useful for testing / advanced usage)
export { CacheManager } from "./cache.js";
export type { CacheManagerOptions, CacheStats } from "./cache.js";
export { buildExecutionPlan } from "./dag.js";
export { hashInput, stableStringify } from "./hash.js";
export { normalizeTag, tagMatches, findInvalidatedEntries } from "./tags.js";

// Errors
export {
  ReactiveAgentsError,
  AgentNotFoundError,
  CircularDependencyError,
  ToolExecutionError,
  ProviderError,
  MaxToolRoundsError,
  CacheError,
  TimeoutError,
} from "./errors.js";
