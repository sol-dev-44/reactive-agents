// ============================================================
// TAG SYSTEM
// ============================================================

/** A tag type is a string identifier for a category of data */
export type TagType = string;

/** A specific tag instance — type + optional id for granular invalidation */
export interface TagDescription {
  type: TagType;
  id?: string | number;
}

/** Tags can be specified as just a type string, or a full TagDescription */
export type Tag = TagType | TagDescription;

/**
 * providesTags — declares what data this agent produces.
 * Can be static array OR a function of the result (for dynamic tags).
 */
export type ProvidesTagsFn<TResult> = Tag[] | ((result: TResult) => Tag[]);

/**
 * invalidatesTags — declares what cached data this agent should invalidate when it runs.
 */
export type InvalidatesTagsFn<TInput> = Tag[] | ((input: TInput) => Tag[]);

// ============================================================
// PROVIDER INTERFACE (adapter contract)
// ============================================================

/** Message format — provider-agnostic */
export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Tool definition — provider-agnostic */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Tool call result from provider */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Tool result to send back */
export interface ToolResult {
  toolCallId: string;
  content: string;
}

/** Token usage from a single execution */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

/** Stream event for real-time output */
export interface StreamEvent {
  type: "text_delta" | "tool_use" | "complete" | "error";
  text?: string;
  toolCall?: ToolCall;
  error?: Error;
}

/** What every provider adapter must implement */
export interface Provider {
  name: string;

  /** Execute a non-streaming agent call */
  execute(params: ProviderExecuteParams): Promise<ProviderExecuteResult>;

  /** Execute a streaming agent call */
  stream(params: ProviderExecuteParams): AsyncIterable<StreamEvent>;
}

export interface ProviderExecuteParams {
  model: string;
  systemPrompt?: string;
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface ProviderExecuteResult {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

// ============================================================
// TOOL HANDLER (user-defined tools agents can call)
// ============================================================

export type ToolHandler = (
  input: Record<string, unknown>,
) => Promise<string> | string;

// ============================================================
// AGENT CONFIG — how you define a single agent
// ============================================================

export interface AgentConfig<TInput = unknown, TResult = string> {
  /** Unique name for this agent */
  name: string;

  /** System prompt — the agent's instructions */
  systemPrompt: string;

  /**
   * Transform input into the user message(s) sent to the LLM.
   * If omitted, input is JSON.stringify'd as a single user message.
   */
  buildMessages?: (input: TInput) => AgentMessage[];

  /**
   * Parse the raw LLM string output into TResult.
   * If omitted, raw string is returned as TResult (TResult must be string).
   */
  parseResult?: (raw: string) => TResult;

  /** Model override (defaults to api-level config) */
  model?: string;

  /** Max tokens for this agent's response */
  maxTokens?: number;

  /** Temperature override */
  temperature?: number;

  /** Tags this agent provides — for cache identification */
  providesTags?: ProvidesTagsFn<TResult>;

  /** Tags this agent invalidates — triggers re-execution of dependents */
  invalidatesTags?: InvalidatesTagsFn<TInput>;

  /** Tools this agent can call */
  tools?: Record<
    string,
    {
      definition: ToolDefinition;
      handler: ToolHandler;
    }
  >;

  /** Cache TTL in milliseconds. 0 = no cache. Default: 5 minutes */
  cacheTtl?: number;

  /** Max tool-call rounds before forcing stop (prevent infinite loops) */
  maxToolRounds?: number;

  /** Retry config */
  retry?: {
    maxRetries: number;
    backoffMs?: number;
  };
}

// ============================================================
// AGENT API CONFIG — how you configure createAgentApi()
// ============================================================

export interface AgentApiConfig {
  /** Name for this API instance (used in logs, cache namespacing) */
  name: string;

  /** The LLM provider to use */
  provider: Provider;

  /** Default model for all agents (can be overridden per-agent) */
  defaultModel: string;

  /** Define all agents */
  agents: Record<string, AgentConfig<unknown, unknown>>;

  /** Tag types this API manages (for type safety / validation) */
  tagTypes?: TagType[];

  /** Global cache TTL default (ms). Default: 300_000 (5 min) */
  defaultCacheTtl?: number;

  /** Global max tokens default */
  defaultMaxTokens?: number;

  /** Event callbacks */
  onExecutionStart?: (agentName: string, input: unknown) => void;
  onExecutionComplete?: (
    agentName: string,
    result: AgentResult<unknown>,
  ) => void;
  onCacheHit?: (agentName: string, cacheKey: string) => void;
  onError?: (agentName: string, error: Error) => void;
}

// ============================================================
// CACHE ENTRY
// ============================================================

export interface CacheEntry<TResult = unknown> {
  /** The cached result */
  result: TResult;

  /** When this was cached (unix ms) */
  cachedAt: number;

  /** When this expires (unix ms) */
  expiresAt: number;

  /** The input hash that produced this result */
  inputHash: string;

  /** Tags this entry provides */
  tags: TagDescription[];

  /** Token usage from the execution that produced this */
  usage: TokenUsage;
}

// ============================================================
// EXECUTION PLAN — the DAG execution order
// ============================================================

export interface ExecutionStep {
  /** Agent name */
  agentName: string;

  /** Agents that must complete before this one can run */
  dependsOn: string[];

  /** Whether this can run in parallel with other steps at the same level */
  parallelGroup: number;
}

export interface ExecutionPlan {
  /** Ordered steps — grouped by parallelGroup for concurrent execution */
  steps: ExecutionStep[];

  /** Total number of parallel groups (execution waves) */
  totalGroups: number;
}

// ============================================================
// AGENT RESULT — what an agent returns
// ============================================================

export interface AgentResult<TResult = string> {
  /** The parsed result */
  data: TResult;

  /** Raw string output from the LLM */
  raw: string;

  /** Whether this came from cache */
  fromCache: boolean;

  /** Token usage (zero if from cache) */
  usage: TokenUsage;

  /** Execution time in ms */
  durationMs: number;

  /** Agent name that produced this */
  agentName: string;

  /** Timestamp */
  timestamp: number;

  /** Tags this result provides */
  tags: TagDescription[];
}

// ============================================================
// AGENT API — the returned API object from createAgentApi()
// ============================================================

export interface AgentApi {
  /** Execute a single agent by name */
  execute<TResult = string>(
    agentName: string,
    input: unknown,
  ): Promise<AgentResult<TResult>>;

  /** Execute a single agent with streaming */
  stream(agentName: string, input: unknown): AsyncIterable<StreamEvent>;

  /** Execute a pipeline — resolves the DAG and runs all agents in order */
  executePipeline(
    agentNames: string[],
    initialInput: unknown,
    options?: PipelineOptions,
  ): Promise<PipelineResult>;

  /** Get the execution plan without running it */
  getExecutionPlan(agentNames: string[]): ExecutionPlan;

  /** Manually invalidate tags — forces re-execution on next call */
  invalidateTags(tags: Tag[]): void;

  /** Clear all cache entries */
  clearCache(): void;

  /** Get a specific cache entry */
  getCacheEntry(
    agentName: string,
    inputHash: string,
  ): CacheEntry | undefined;

  /** Get cumulative token usage across all executions */
  getUsage(): TokenUsage;

  /** Reset usage counters */
  resetUsage(): void;
}

export interface PipelineOptions {
  /** Pass output of each agent as input to the next. Default: true */
  chainOutputs?: boolean;

  /** Override inputs for specific agents (by name) */
  inputOverrides?: Record<string, unknown>;

  /** Callback for each completed step */
  onStepComplete?: (step: string, result: AgentResult<unknown>) => void;
}

export interface PipelineResult {
  /** Results keyed by agent name */
  results: Record<string, AgentResult<unknown>>;

  /** The final agent's result */
  finalResult: AgentResult<unknown>;

  /** Total execution time */
  totalDurationMs: number;

  /** Cumulative token usage */
  totalUsage: TokenUsage;
}
