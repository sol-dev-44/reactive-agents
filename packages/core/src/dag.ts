/**
 * DAG Builder — Topological Sort from Tag Relationships
 *
 * Given a set of agents and their tag declarations:
 * 1. Build an adjacency list: if agent B invalidates a tag that agent A provides,
 *    then A -> B (A must run before B).
 * 2. Topological sort using Kahn's algorithm (BFS-based, gives parallel groups for free).
 * 3. Return ExecutionPlan with parallel groups.
 *
 * This is the "smart" part — developers declare tags, we figure out the order.
 */

import type {
  AgentConfig,
  ExecutionPlan,
  ExecutionStep,
  TagDescription,
} from "./types.js";
import { normalizeTag, tagMatches } from "./tags.js";
import { CircularDependencyError, AgentNotFoundError } from "./errors.js";

export function buildExecutionPlan(
  agentNames: string[],
  agentConfigs: Record<string, AgentConfig<unknown, unknown>>,
): ExecutionPlan {
  // Validate all agents exist
  for (const name of agentNames) {
    if (!agentConfigs[name]) {
      throw new AgentNotFoundError(name);
    }
  }

  // Step 1: Collect each agent's provided and invalidated tags
  const agentProvides = new Map<string, TagDescription[]>();
  const agentInvalidates = new Map<string, TagDescription[]>();

  for (const name of agentNames) {
    const config = agentConfigs[name]!;

    // For static tag arrays, resolve now. Functions can't be resolved until runtime.
    const provides = Array.isArray(config.providesTags)
      ? config.providesTags.map(normalizeTag)
      : [];
    const invalidates = Array.isArray(config.invalidatesTags)
      ? config.invalidatesTags.map(normalizeTag)
      : [];

    agentProvides.set(name, provides);
    agentInvalidates.set(name, invalidates);
  }

  // Step 2: Build adjacency list (dependency edges)
  // If B invalidates a tag that A provides -> A must run before B -> edge A -> B
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const name of agentNames) {
    adjacency.set(name, new Set());
    inDegree.set(name, 0);
  }

  for (const b of agentNames) {
    const bInvalidates = agentInvalidates.get(b) ?? [];
    for (const a of agentNames) {
      if (a === b) continue;
      const aProvides = agentProvides.get(a) ?? [];

      const bDependsOnA = bInvalidates.some((invTag) =>
        aProvides.some((provTag) => tagMatches(invTag, provTag)),
      );

      if (bDependsOnA) {
        adjacency.get(a)!.add(b);
        inDegree.set(b, (inDegree.get(b) ?? 0) + 1);
      }
    }
  }

  // Step 3: Kahn's algorithm — BFS topological sort with level tracking
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const steps: ExecutionStep[] = [];
  let parallelGroup = 0;

  while (queue.length > 0) {
    const currentLevel = [...queue];
    queue.length = 0;

    for (const name of currentLevel) {
      // Collect actual dependencies for this agent (nodes that have edge TO this node)
      const agentDeps: string[] = [];
      for (const [source, targets] of adjacency) {
        if (targets.has(name)) {
          agentDeps.push(source);
        }
      }

      steps.push({
        agentName: name,
        dependsOn: agentDeps,
        parallelGroup,
      });

      // Decrease in-degree for dependents
      for (const dependent of adjacency.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    parallelGroup++;
  }

  // Cycle detection
  if (steps.length !== agentNames.length) {
    const processed = new Set(steps.map((s) => s.agentName));
    const missing = agentNames.filter((n) => !processed.has(n));
    throw new CircularDependencyError(missing);
  }

  return { steps, totalGroups: parallelGroup };
}
