import { describe, it, expect } from "vitest";
import { stableStringify, hashInput } from "../src/hash.js";

// ============================================================
// stableStringify
// ============================================================

describe("stableStringify", () => {
  it("should serialize null", () => {
    expect(stableStringify(null)).toBe("null");
  });

  it("should serialize undefined", () => {
    expect(stableStringify(undefined)).toBe("undefined");
  });

  it("should serialize a string", () => {
    expect(stableStringify("hello")).toBe('"hello"');
  });

  it("should serialize an empty string", () => {
    expect(stableStringify("")).toBe('""');
  });

  it("should serialize a number", () => {
    expect(stableStringify(42)).toBe("42");
  });

  it("should serialize zero", () => {
    expect(stableStringify(0)).toBe("0");
  });

  it("should serialize negative numbers", () => {
    expect(stableStringify(-3.14)).toBe("-3.14");
  });

  it("should serialize booleans", () => {
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(false)).toBe("false");
  });

  it("should serialize an empty array", () => {
    expect(stableStringify([])).toBe("[]");
  });

  it("should serialize an array of primitives", () => {
    expect(stableStringify([1, "a", true])).toBe('[1,"a",true]');
  });

  it("should serialize nested arrays", () => {
    expect(stableStringify([[1, 2], [3]])).toBe("[[1,2],[3]]");
  });

  it("should serialize an empty object", () => {
    expect(stableStringify({})).toBe("{}");
  });

  it("should sort object keys alphabetically", () => {
    const obj = { b: 2, a: 1, c: 3 };
    expect(stableStringify(obj)).toBe('{"a":1,"b":2,"c":3}');
  });

  it("should produce identical output regardless of key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("should serialize nested objects with sorted keys", () => {
    const obj = { b: { d: 4, c: 3 }, a: 1 };
    expect(stableStringify(obj)).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it("should handle objects containing arrays", () => {
    const obj = { items: [1, 2], name: "test" };
    expect(stableStringify(obj)).toBe('{"items":[1,2],"name":"test"}');
  });

  it("should handle arrays containing objects", () => {
    const arr = [{ b: 2, a: 1 }];
    expect(stableStringify(arr)).toBe('[{"a":1,"b":2}]');
  });

  it("should handle deeply nested structures", () => {
    const deep = { a: { b: { c: { d: "deep" } } } };
    expect(stableStringify(deep)).toBe('{"a":{"b":{"c":{"d":"deep"}}}}');
  });

  it("should handle objects with undefined values", () => {
    const obj = { a: undefined, b: 1 };
    // undefined values in objects are kept since stableStringify handles undefined
    expect(stableStringify(obj)).toBe('{"a":undefined,"b":1}');
  });

  it("should handle objects with null values", () => {
    const obj = { a: null, b: 1 };
    expect(stableStringify(obj)).toBe('{"a":null,"b":1}');
  });
});

// ============================================================
// hashInput
// ============================================================

describe("hashInput", () => {
  it("should return a hex string", async () => {
    const hash = await hashInput("agent1", "hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce consistent hashes for the same input", async () => {
    const hash1 = await hashInput("agent1", { query: "test" });
    const hash2 = await hashInput("agent1", { query: "test" });
    expect(hash1).toBe(hash2);
  });

  it("should produce the same hash regardless of object key order", async () => {
    const hash1 = await hashInput("agent1", { b: 2, a: 1 });
    const hash2 = await hashInput("agent1", { a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different agent names", async () => {
    const hash1 = await hashInput("agent1", "same input");
    const hash2 = await hashInput("agent2", "same input");
    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different inputs", async () => {
    const hash1 = await hashInput("agent1", "input A");
    const hash2 = await hashInput("agent1", "input B");
    expect(hash1).not.toBe(hash2);
  });

  it("should handle null input", async () => {
    const hash = await hashInput("agent", null);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle undefined input", async () => {
    const hash = await hashInput("agent", undefined);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should differentiate null and undefined inputs", async () => {
    const hashNull = await hashInput("agent", null);
    const hashUndef = await hashInput("agent", undefined);
    expect(hashNull).not.toBe(hashUndef);
  });

  it("should handle empty string agent name", async () => {
    const hash = await hashInput("", "input");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle complex nested input", async () => {
    const hash = await hashInput("agent", {
      users: [{ name: "Alice", age: 30 }],
      query: "find users",
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
