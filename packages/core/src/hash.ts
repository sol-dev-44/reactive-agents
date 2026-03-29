/**
 * Deterministic hash of agent inputs for cache keying.
 *
 * Strategy:
 * 1. JSON.stringify with sorted keys (deterministic serialization)
 * 2. Hash with Web Crypto API (SHA-256, available in Node 22+ and Bun)
 * 3. Cache key = `${agentName}:${hash}`
 *
 * We cache based on INPUT identity: same question -> serve cached answer.
 */

export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
  );
  return "{" + pairs.join(",") + "}";
}

export async function hashInput(
  agentName: string,
  input: unknown,
): Promise<string> {
  const serialized = `${agentName}:${stableStringify(input)}`;
  const encoded = new TextEncoder().encode(serialized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
