/**
 * Tag Resolution Algorithm
 *
 * Tags are the core dependency mechanism. They work like RTK Query:
 *
 * 1. Agent A provides tags: [{ type: "Research", id: "topic-1" }]
 * 2. Agent B invalidates tags: [{ type: "Research" }]
 *    -> When B runs, A's cache is invalidated (A must re-run if called again)
 *
 * Matching rules:
 * - { type: "X" } invalidates ALL entries with type "X" (wildcard)
 * - { type: "X", id: "1" } invalidates ONLY entries with type "X" AND id "1"
 */

import type { Tag, TagDescription, CacheEntry } from "./types.js";

/** Normalize a Tag (string | TagDescription) into TagDescription */
export function normalizeTag(tag: Tag): TagDescription {
  if (typeof tag === "string") return { type: tag };
  return tag;
}

/** Check if an invalidation tag matches a provided tag */
export function tagMatches(
  invalidates: TagDescription,
  provides: TagDescription,
): boolean {
  if (invalidates.type !== provides.type) return false;
  // If invalidation has no id, it's a wildcard — matches all ids
  if (invalidates.id === undefined) return true;
  return invalidates.id === provides.id;
}

/** Find all cache entries that should be invalidated by a set of tags */
export function findInvalidatedEntries(
  invalidationTags: TagDescription[],
  cacheEntries: Map<string, CacheEntry>,
): string[] {
  const keysToInvalidate: string[] = [];

  for (const [key, entry] of cacheEntries) {
    for (const invTag of invalidationTags) {
      const shouldInvalidate = entry.tags.some((provTag) =>
        tagMatches(invTag, provTag),
      );
      if (shouldInvalidate) {
        keysToInvalidate.push(key);
        break;
      }
    }
  }

  return keysToInvalidate;
}
