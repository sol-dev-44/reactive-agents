import { useState, useCallback, useRef } from "react";
import type { AgentResult, StreamEvent } from "@reactive-agents/core";
import { useAgentApi } from "./context.js";
import type { UseAgentOptions, UseAgentReturn } from "./types.js";

/**
 * Hook for executing an agent by name.
 *
 * Provides execute(), loading/error/streaming state, and the result.
 * Supports both standard (request/response) and streaming modes.
 *
 * @param agentName - The name of the agent to execute
 * @param options   - Optional configuration (e.g. { stream: true })
 */
export function useAgent<TResult = string>(
  agentName: string,
  options: UseAgentOptions = {},
): UseAgentReturn<TResult> {
  const api = useAgentApi();

  const [data, setData] = useState<TResult | null>(null);
  const [result, setResult] = useState<AgentResult<TResult> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track whether the component is still mounted to avoid state updates after unmount
  const mountedRef = useRef(true);

  // Use a ref to track if we should abort (for future cancellation support)
  const abortRef = useRef(false);

  const execute = useCallback(
    async (input: unknown): Promise<void> => {
      // Reset state for new execution
      setError(null);
      setIsLoading(true);
      setStreamingText("");
      setIsStreaming(false);
      abortRef.current = false;

      try {
        if (options.stream) {
          // Streaming mode
          setIsStreaming(true);
          let accumulated = "";

          const stream = api.stream(agentName, input);
          for await (const event of stream) {
            if (abortRef.current) break;

            if (event.type === "text_delta" && event.text) {
              accumulated += event.text;
              setStreamingText(accumulated);
            } else if (event.type === "error" && event.error) {
              throw event.error;
            }
          }

          // After streaming completes, set the final data
          setData(accumulated as unknown as TResult);
          setIsStreaming(false);
        } else {
          // Standard execute mode
          const agentResult = await api.execute<TResult>(agentName, input);
          if (!abortRef.current) {
            setResult(agentResult);
            setData(agentResult.data);
          }
        }
      } catch (err) {
        if (!abortRef.current) {
          const error =
            err instanceof Error ? err : new Error(String(err));
          setError(error);
        }
      } finally {
        if (!abortRef.current) {
          setIsLoading(false);
          setIsStreaming(false);
        }
      }
    },
    [api, agentName, options.stream],
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setData(null);
    setResult(null);
    setIsLoading(false);
    setStreamingText("");
    setIsStreaming(false);
    setError(null);
  }, []);

  return {
    execute,
    data,
    result,
    isLoading,
    streamingText,
    isStreaming,
    error,
    reset,
  };
}
