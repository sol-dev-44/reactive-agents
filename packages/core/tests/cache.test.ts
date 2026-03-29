import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CacheManager } from "../src/cache.js";
import type { CacheEntry } from "../src/types.js";

function makeCacheEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    result: "test result",
    cachedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    inputHash: "test-hash",
    tags: [],
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    ...overrides,
  };
}

// ============================================================
// CacheManager
// ============================================================

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  // --------------------------------------------------------
  // Constructor / defaults
  // --------------------------------------------------------

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(cache.size).toBe(0);
    });

    it("should accept custom maxSize and defaultTtl", () => {
      const c = new CacheManager({ maxSize: 5, defaultTtl: 60_000 });
      expect(c.size).toBe(0);
    });
  });

  // --------------------------------------------------------
  // get / set basics
  // --------------------------------------------------------

  describe("get and set", () => {
    it("should store and retrieve an entry", () => {
      const entry = makeCacheEntry();
      cache.set("key1", entry);
      expect(cache.get("key1")).toEqual(entry);
    });

    it("should return undefined for a missing key", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should update size when entries are added", () => {
      cache.set("key1", makeCacheEntry());
      cache.set("key2", makeCacheEntry());
      expect(cache.size).toBe(2);
    });

    it("should overwrite an existing entry with the same key", () => {
      cache.set("key1", makeCacheEntry({ result: "first" }));
      cache.set("key1", makeCacheEntry({ result: "second" }));
      expect(cache.size).toBe(1);
      expect(cache.get("key1")?.result).toBe("second");
    });
  });

  // --------------------------------------------------------
  // TTL expiry
  // --------------------------------------------------------

  describe("TTL expiry", () => {
    it("should return undefined for an expired entry (lazy expiration)", () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        cache.set(
          "key1",
          makeCacheEntry({ cachedAt: now, expiresAt: now + 1000 }),
        );

        // Advance past expiration
        vi.advanceTimersByTime(1001);

        expect(cache.get("key1")).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should remove the expired entry from the map on get", () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        cache.set(
          "key1",
          makeCacheEntry({ cachedAt: now, expiresAt: now + 500 }),
        );
        expect(cache.size).toBe(1);

        vi.advanceTimersByTime(501);
        cache.get("key1"); // triggers lazy removal

        expect(cache.size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should return a valid entry that has not yet expired", () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        cache.set(
          "key1",
          makeCacheEntry({ cachedAt: now, expiresAt: now + 5000 }),
        );

        vi.advanceTimersByTime(4999);
        expect(cache.get("key1")).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // --------------------------------------------------------
  // LRU eviction
  // --------------------------------------------------------

  describe("LRU eviction", () => {
    it("should evict the least recently used entry when at capacity", () => {
      const smallCache = new CacheManager({ maxSize: 2 });
      smallCache.set("key1", makeCacheEntry({ result: "first" }));
      smallCache.set("key2", makeCacheEntry({ result: "second" }));
      smallCache.set("key3", makeCacheEntry({ result: "third" }));

      // key1 should have been evicted (LRU)
      expect(smallCache.get("key1")).toBeUndefined();
      expect(smallCache.get("key2")).toBeDefined();
      expect(smallCache.get("key3")).toBeDefined();
      expect(smallCache.size).toBe(2);
    });

    it("should update access order on get (touching makes it recent)", () => {
      const smallCache = new CacheManager({ maxSize: 2 });
      smallCache.set("key1", makeCacheEntry({ result: "first" }));
      smallCache.set("key2", makeCacheEntry({ result: "second" }));

      // Touch key1 — makes it most recently used
      smallCache.get("key1");

      // Now adding key3 should evict key2 (least recently used)
      smallCache.set("key3", makeCacheEntry({ result: "third" }));

      expect(smallCache.get("key1")).toBeDefined();
      expect(smallCache.get("key2")).toBeUndefined();
      expect(smallCache.get("key3")).toBeDefined();
    });

    it("should not evict when maxSize is 0 (unlimited)", () => {
      const unlimitedCache = new CacheManager({ maxSize: 0 });
      for (let i = 0; i < 100; i++) {
        unlimitedCache.set(`key${i}`, makeCacheEntry());
      }
      expect(unlimitedCache.size).toBe(100);
    });

    it("should not evict when overwriting an existing key (no new slot needed)", () => {
      const smallCache = new CacheManager({ maxSize: 2 });
      smallCache.set("key1", makeCacheEntry({ result: "v1" }));
      smallCache.set("key2", makeCacheEntry({ result: "v2" }));

      // Overwrite key1 — should NOT trigger eviction
      smallCache.set("key1", makeCacheEntry({ result: "v1-updated" }));

      expect(smallCache.size).toBe(2);
      expect(smallCache.get("key1")?.result).toBe("v1-updated");
      expect(smallCache.get("key2")).toBeDefined();
    });

    it("should track evictions in stats", () => {
      const smallCache = new CacheManager({ maxSize: 1 });
      smallCache.set("key1", makeCacheEntry());
      smallCache.set("key2", makeCacheEntry());

      expect(smallCache.getStats().evictions).toBe(1);
    });
  });

  // --------------------------------------------------------
  // Tag invalidation
  // --------------------------------------------------------

  describe("tag invalidation", () => {
    it("should invalidate entries matching a wildcard tag", () => {
      cache.set(
        "key1",
        makeCacheEntry({ tags: [{ type: "Research", id: "topic-1" }] }),
      );
      cache.set(
        "key2",
        makeCacheEntry({ tags: [{ type: "Users", id: "1" }] }),
      );

      const removed = cache.invalidate(["Research"]);
      expect(removed).toBe(1);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeDefined();
    });

    it("should invalidate entries matching a specific tag", () => {
      cache.set(
        "key1",
        makeCacheEntry({ tags: [{ type: "Research", id: "topic-1" }] }),
      );
      cache.set(
        "key2",
        makeCacheEntry({ tags: [{ type: "Research", id: "topic-2" }] }),
      );

      const removed = cache.invalidate([{ type: "Research", id: "topic-1" }]);
      expect(removed).toBe(1);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeDefined();
    });

    it("should return 0 when no entries match the tag", () => {
      cache.set(
        "key1",
        makeCacheEntry({ tags: [{ type: "Users" }] }),
      );

      const removed = cache.invalidate([{ type: "Research" }]);
      expect(removed).toBe(0);
      expect(cache.size).toBe(1);
    });

    it("should invalidate multiple entries at once", () => {
      cache.set(
        "key1",
        makeCacheEntry({ tags: [{ type: "Research" }] }),
      );
      cache.set(
        "key2",
        makeCacheEntry({ tags: [{ type: "Research" }] }),
      );
      cache.set(
        "key3",
        makeCacheEntry({ tags: [{ type: "Users" }] }),
      );

      const removed = cache.invalidate(["Research"]);
      expect(removed).toBe(2);
      expect(cache.size).toBe(1);
    });

    it("should accept string tags and TagDescription tags", () => {
      cache.set(
        "key1",
        makeCacheEntry({ tags: [{ type: "A" }] }),
      );
      cache.set(
        "key2",
        makeCacheEntry({ tags: [{ type: "B", id: "1" }] }),
      );

      const removed = cache.invalidate(["A", { type: "B", id: "1" }]);
      expect(removed).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  // --------------------------------------------------------
  // gc (garbage collection)
  // --------------------------------------------------------

  describe("gc", () => {
    it("should remove expired entries", () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        cache.set("expired1", makeCacheEntry({ expiresAt: now + 100 }));
        cache.set("expired2", makeCacheEntry({ expiresAt: now + 200 }));
        cache.set("valid", makeCacheEntry({ expiresAt: now + 10_000 }));

        vi.advanceTimersByTime(300);

        const removed = cache.gc();
        expect(removed).toBe(2);
        expect(cache.size).toBe(1);
        expect(cache.get("valid")).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should return 0 when no entries are expired", () => {
      cache.set("key1", makeCacheEntry({ expiresAt: Date.now() + 999_999 }));
      const removed = cache.gc();
      expect(removed).toBe(0);
    });

    it("should return 0 on an empty cache", () => {
      expect(cache.gc()).toBe(0);
    });
  });

  // --------------------------------------------------------
  // clear
  // --------------------------------------------------------

  describe("clear", () => {
    it("should remove all entries", () => {
      cache.set("key1", makeCacheEntry());
      cache.set("key2", makeCacheEntry());
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("should make previously stored keys return undefined", () => {
      cache.set("key1", makeCacheEntry());
      cache.clear();
      expect(cache.get("key1")).toBeUndefined();
    });
  });

  // --------------------------------------------------------
  // getEntry
  // --------------------------------------------------------

  describe("getEntry", () => {
    it("should be an alias for get", () => {
      const entry = makeCacheEntry();
      cache.set("key1", entry);
      expect(cache.getEntry("key1")).toEqual(cache.get("key1"));
    });
  });

  // --------------------------------------------------------
  // getKey
  // --------------------------------------------------------

  describe("getKey", () => {
    it("should produce a deterministic hash string", async () => {
      const key1 = await cache.getKey("agent1", { q: "test" });
      const key2 = await cache.getKey("agent1", { q: "test" });
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce different keys for different agents", async () => {
      const key1 = await cache.getKey("agent1", "input");
      const key2 = await cache.getKey("agent2", "input");
      expect(key1).not.toBe(key2);
    });
  });

  // --------------------------------------------------------
  // getStats
  // --------------------------------------------------------

  describe("getStats", () => {
    it("should track hits and misses", () => {
      cache.set("key1", makeCacheEntry());
      cache.get("key1"); // hit
      cache.get("key1"); // hit
      cache.get("missing"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("should track size", () => {
      cache.set("key1", makeCacheEntry());
      cache.set("key2", makeCacheEntry());
      expect(cache.getStats().size).toBe(2);
    });

    it("should return a copy (not the internal reference)", () => {
      const stats1 = cache.getStats();
      stats1.hits = 9999;
      const stats2 = cache.getStats();
      expect(stats2.hits).not.toBe(9999);
    });

    it("should count expired entries as misses", () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        cache.set("key1", makeCacheEntry({ expiresAt: now + 100 }));
        vi.advanceTimersByTime(200);
        cache.get("key1"); // expired, should be a miss

        expect(cache.getStats().misses).toBe(1);
        expect(cache.getStats().hits).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // --------------------------------------------------------
  // getEntries
  // --------------------------------------------------------

  describe("getEntries", () => {
    it("should return the internal entries map", () => {
      cache.set("key1", makeCacheEntry());
      const entries = cache.getEntries();
      expect(entries).toBeInstanceOf(Map);
      expect(entries.size).toBe(1);
      expect(entries.has("key1")).toBe(true);
    });
  });
});
