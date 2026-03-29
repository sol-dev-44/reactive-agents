import { useMemo } from "react";
import { useAgentApi } from "./context.js";
import type { UseAgentResultReturn } from "./types.js";

/**
 * Hook for subscribing to a cached agent result.
 *
 * Reads from the cache via api.getCacheEntry(). Returns the cached result
 * if one exists for the given agent name and input hash.
 *
 * @param agentName - The name of the agent whose result to look up
 * @param inputHash - The hash of the input used to produce the result.
 *                    If omitted, no cache lookup is performed.
 */
export function useAgentResult<TResult = unknown>(
  agentName: string,
  inputHash?: string,
): UseAgentResultReturn<TResult> {
  const api = useAgentApi();

  return useMemo(() => {
    if (inputHash === undefined) {
      return { result: null, isCached: false };
    }

    const entry = api.getCacheEntry(agentName, inputHash);
    if (entry) {
      return {
        result: entry.result as TResult,
        isCached: true,
      };
    }

    return { result: null, isCached: false };
  }, [api, agentName, inputHash]);
}
