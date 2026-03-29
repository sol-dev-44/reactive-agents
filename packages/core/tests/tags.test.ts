import { describe, it, expect } from "vitest";
import { normalizeTag, tagMatches, findInvalidatedEntries } from "../src/tags.js";
import type { TagDescription, CacheEntry } from "../src/types.js";

// ============================================================
// normalizeTag
// ============================================================

describe("normalizeTag", () => {
  it("should convert a string tag to a TagDescription", () => {
    expect(normalizeTag("Research")).toEqual({ type: "Research" });
  });

  it("should return a TagDescription as-is when it has type only", () => {
    const tag: TagDescription = { type: "Users" };
    expect(normalizeTag(tag)).toEqual({ type: "Users" });
  });

  it("should return a TagDescription as-is when it has type and string id", () => {
    const tag: TagDescription = { type: "Users", id: "user-1" };
    expect(normalizeTag(tag)).toEqual({ type: "Users", id: "user-1" });
  });

  it("should return a TagDescription as-is when it has type and numeric id", () => {
    const tag: TagDescription = { type: "Posts", id: 42 };
    expect(normalizeTag(tag)).toEqual({ type: "Posts", id: 42 });
  });

  it("should handle an empty string tag type", () => {
    expect(normalizeTag("")).toEqual({ type: "" });
  });
});

// ============================================================
// tagMatches
// ============================================================

describe("tagMatches", () => {
  it("should match when types are the same and invalidation has no id (wildcard)", () => {
    expect(tagMatches({ type: "Research" }, { type: "Research" })).toBe(true);
  });

  it("should match when types are the same and invalidation has no id, provides has id", () => {
    expect(tagMatches({ type: "Research" }, { type: "Research", id: "topic-1" })).toBe(true);
  });

  it("should match when types and ids are exactly equal (string ids)", () => {
    expect(
      tagMatches({ type: "Research", id: "topic-1" }, { type: "Research", id: "topic-1" }),
    ).toBe(true);
  });

  it("should match when types and ids are exactly equal (numeric ids)", () => {
    expect(tagMatches({ type: "Users", id: 42 }, { type: "Users", id: 42 })).toBe(true);
  });

  it("should NOT match when types differ", () => {
    expect(tagMatches({ type: "Research" }, { type: "Users" })).toBe(false);
  });

  it("should NOT match when types match but ids differ", () => {
    expect(
      tagMatches({ type: "Research", id: "topic-1" }, { type: "Research", id: "topic-2" }),
    ).toBe(false);
  });

  it("should NOT match when invalidation has id but provides does not", () => {
    expect(tagMatches({ type: "Research", id: "topic-1" }, { type: "Research" })).toBe(false);
  });

  it("should NOT match when types differ even if ids match", () => {
    expect(
      tagMatches({ type: "Research", id: "1" }, { type: "Users", id: "1" }),
    ).toBe(false);
  });

  it("should handle id of 0", () => {
    expect(tagMatches({ type: "Items", id: 0 }, { type: "Items", id: 0 })).toBe(true);
  });

  it("should not match numeric 0 with string '0'", () => {
    // strict equality: 0 !== "0"
    expect(tagMatches({ type: "Items", id: 0 }, { type: "Items", id: "0" })).toBe(false);
  });
});

// ============================================================
// findInvalidatedEntries
// ============================================================

function makeCacheEntry(tags: TagDescription[]): CacheEntry {
  return {
    result: "mocked result",
    cachedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    inputHash: "test-hash",
    tags,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  };
}

describe("findInvalidatedEntries", () => {
  it("should return keys of entries matching a wildcard tag", () => {
    const entries = new Map<string, CacheEntry>([
      ["key1", makeCacheEntry([{ type: "Research", id: "topic-1" }])],
      ["key2", makeCacheEntry([{ type: "Users", id: "1" }])],
      ["key3", makeCacheEntry([{ type: "Research", id: "topic-2" }])],
    ]);

    const result = findInvalidatedEntries([{ type: "Research" }], entries);
    expect(result).toContain("key1");
    expect(result).toContain("key3");
    expect(result).not.toContain("key2");
  });

  it("should return keys of entries matching a specific tag", () => {
    const entries = new Map<string, CacheEntry>([
      ["key1", makeCacheEntry([{ type: "Research", id: "topic-1" }])],
      ["key2", makeCacheEntry([{ type: "Research", id: "topic-2" }])],
    ]);

    const result = findInvalidatedEntries(
      [{ type: "Research", id: "topic-1" }],
      entries,
    );
    expect(result).toEqual(["key1"]);
  });

  it("should return empty array when no entries match", () => {
    const entries = new Map<string, CacheEntry>([
      ["key1", makeCacheEntry([{ type: "Users", id: "1" }])],
    ]);

    const result = findInvalidatedEntries([{ type: "Research" }], entries);
    expect(result).toEqual([]);
  });

  it("should return empty array when cache is empty", () => {
    const entries = new Map<string, CacheEntry>();
    const result = findInvalidatedEntries([{ type: "Research" }], entries);
    expect(result).toEqual([]);
  });

  it("should return empty array when invalidation tags list is empty", () => {
    const entries = new Map<string, CacheEntry>([
      ["key1", makeCacheEntry([{ type: "Research" }])],
    ]);

    const result = findInvalidatedEntries([], entries);
    expect(result).toEqual([]);
  });

  it("should handle entries with multiple tags", () => {
    const entries = new Map<string, CacheEntry>([
      [
        "key1",
        makeCacheEntry([
          { type: "Research", id: "topic-1" },
          { type: "Summary" },
        ]),
      ],
    ]);

    const result = findInvalidatedEntries([{ type: "Summary" }], entries);
    expect(result).toEqual(["key1"]);
  });

  it("should not duplicate keys when multiple invalidation tags match the same entry", () => {
    const entries = new Map<string, CacheEntry>([
      [
        "key1",
        makeCacheEntry([
          { type: "Research", id: "topic-1" },
          { type: "Summary" },
        ]),
      ],
    ]);

    const result = findInvalidatedEntries(
      [{ type: "Research" }, { type: "Summary" }],
      entries,
    );
    // Should only appear once thanks to the break in the inner loop
    expect(result).toEqual(["key1"]);
  });

  it("should handle multiple invalidation tags matching different entries", () => {
    const entries = new Map<string, CacheEntry>([
      ["key1", makeCacheEntry([{ type: "Research" }])],
      ["key2", makeCacheEntry([{ type: "Users" }])],
      ["key3", makeCacheEntry([{ type: "Posts" }])],
    ]);

    const result = findInvalidatedEntries(
      [{ type: "Research" }, { type: "Users" }],
      entries,
    );
    expect(result).toContain("key1");
    expect(result).toContain("key2");
    expect(result).not.toContain("key3");
  });
});
