import type { AgentResult, StreamEvent } from "@reactive-agent/core";

/**
 * Options for the useAgent hook.
 */
export interface UseAgentOptions {
  /** Enable streaming mode. When true, execute() uses api.stream() instead of api.execute(). */
  stream?: boolean;
}

/**
 * Return type of the useAgent hook.
 */
export interface UseAgentReturn<TResult = string> {
  /** Execute the agent with the given input. */
  execute: (input: unknown) => Promise<void>;

  /** The parsed result data (from AgentResult.data), or null if not yet executed. */
  data: TResult | null;

  /** The full AgentResult, or null if not yet executed. */
  result: AgentResult<TResult> | null;

  /** Whether the agent is currently executing. */
  isLoading: boolean;

  /** Accumulated streaming text (only populated in streaming mode). */
  streamingText: string;

  /** Whether streaming is currently in progress. */
  isStreaming: boolean;

  /** Error from the last execution, or null. */
  error: Error | null;

  /** Reset the hook state to its initial values. */
  reset: () => void;
}

/**
 * Return type of the useAgentResult hook.
 */
export interface UseAgentResultReturn<TResult = unknown> {
  /** The cached result, or null if no cache entry exists. */
  result: TResult | null;

  /** Whether a valid cache entry was found. */
  isCached: boolean;
}
