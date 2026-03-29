/**
 * CacheManager — In-memory cache with tag-based invalidation.
 *
 * Key generation: SHA-256 of `agentName:stableStringify(input)`
 * Lookup: O(1) Map lookup by key
 * Invalidation: Scan entries for matching tags (O(n) over cache size)
 * TTL: Checked on read (lazy expiration) + periodic GC
 */

import type { CacheEntry, Tag } from "./types.js";
import { normalizeTag, findInvalidatedEntries } from "./tags.js";
import { hashInput } from "./hash.js";

export interface CacheManagerOptions {
  /** Max number of entries. 0 = unlimited. Default: 1000 */
  maxSize?: number;
  /** Default TTL in ms. Default: 300_000 (5 min) */
  defaultTtl?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

export class CacheManager {
  private entries = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 };
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  constructor(options: CacheManagerOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.defaultTtl ?? 300_000;
  }

  async getKey(agentName: string, input: unknown): Promise<string> {
    return hashInput(agentName, input);
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Lazy TTL check
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.removeFromAccessOrder(key);
      this.stats.misses++;
      this.stats.size = this.entries.size;
      return undefined;
    }

    // Update LRU access order
    this.touchAccessOrder(key);
    this.stats.hits++;
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    // Evict LRU if at capacity
    if (this.maxSize > 0 && !this.entries.has(key) && this.entries.size >= this.maxSize) {
      this.evictLru();
    }

    this.entries.set(key, entry);
    this.touchAccessOrder(key);
    this.stats.size = this.entries.size;
  }

  /** Invalidate all entries matching any of the given tags */
  invalidate(tags: Tag[]): number {
    const normalized = tags.map(normalizeTag);
    const keysToRemove = findInvalidatedEntries(normalized, this.entries);
    for (const key of keysToRemove) {
      this.entries.delete(key);
      this.removeFromAccessOrder(key);
    }
    this.stats.size = this.entries.size;
    return keysToRemove.length;
  }

  clear(): void {
    this.entries.clear();
    this.accessOrder = [];
    this.stats.size = 0;
  }

  getEntry(key: string): CacheEntry | undefined {
    return this.get(key);
  }

  get size(): number {
    return this.entries.size;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  /** Remove expired entries */
  gc(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        this.removeFromAccessOrder(key);
        removed++;
      }
    }
    this.stats.size = this.entries.size;
    return removed;
  }

  /** Expose internal entries map for tag resolution */
  getEntries(): Map<string, CacheEntry> {
    return this.entries;
  }

  private evictLru(): void {
    if (this.accessOrder.length === 0) return;
    const oldest = this.accessOrder.shift();
    if (oldest) {
      this.entries.delete(oldest);
      this.stats.evictions++;
    }
  }

  private touchAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }
}
