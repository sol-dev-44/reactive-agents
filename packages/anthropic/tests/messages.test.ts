import { describe, it, expect } from "vitest";
import type { AgentMessage, ToolDefinition } from "@reactive-agent/core";
import { formatMessages, formatTools } from "../src/messages.js";

// ============================================================
// formatMessages
// ============================================================

describe("formatMessages", () => {
  it("should convert user messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hello" },
    ];

    const result = formatMessages(messages);

    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("should convert assistant messages", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: "Hi there" },
    ];

    const result = formatMessages(messages);

    expect(result).toEqual([{ role: "assistant", content: "Hi there" }]);
  });

  it("should filter out system messages", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ];

    const result = formatMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("should preserve message order (excluding system)", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "First user message" },
      { role: "assistant", content: "First reply" },
      { role: "user", content: "Second user message" },
    ];

    const result = formatMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "First user message" },
      { role: "assistant", content: "First reply" },
      { role: "user", content: "Second user message" },
    ]);
  });

  it("should return empty array for empty input", () => {
    const result = formatMessages([]);
    expect(result).toEqual([]);
  });

  it("should return empty array when only system messages exist", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "System prompt" },
    ];

    const result = formatMessages(messages);

    expect(result).toEqual([]);
  });

  it("should handle multiple system messages scattered in the list", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "System 1" },
      { role: "user", content: "Hello" },
      { role: "system", content: "System 2" },
      { role: "assistant", content: "Hi" },
    ];

    const result = formatMessages(messages);

    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  });
});

// ============================================================
// formatTools
// ============================================================

describe("formatTools", () => {
  it("should convert a basic tool definition", () => {
    const tools: ToolDefinition[] = [
      {
        name: "get_weather",
        description: "Get the weather for a location",
        inputSchema: {
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    ];

    const result = formatTools(tools);

    expect(result).toEqual([
      {
        name: "get_weather",
        description: "Get the weather for a location",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    ]);
  });

  it("should always set type: 'object' in input_schema", () => {
    const tools: ToolDefinition[] = [
      {
        name: "no_params",
        description: "A tool with no parameters",
        inputSchema: {},
      },
    ];

    const result = formatTools(tools);

    expect(result[0]!.input_schema.type).toBe("object");
  });

  it("should convert multiple tools", () => {
    const tools: ToolDefinition[] = [
      {
        name: "tool_a",
        description: "Tool A",
        inputSchema: { properties: { x: { type: "number" } } },
      },
      {
        name: "tool_b",
        description: "Tool B",
        inputSchema: { properties: { y: { type: "string" } } },
      },
    ];

    const result = formatTools(tools);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("tool_a");
    expect(result[1]!.name).toBe("tool_b");
  });

  it("should return empty array for empty input", () => {
    const result = formatTools([]);
    expect(result).toEqual([]);
  });

  it("should preserve all properties from inputSchema", () => {
    const tools: ToolDefinition[] = [
      {
        name: "complex_tool",
        description: "Tool with complex schema",
        inputSchema: {
          properties: {
            name: { type: "string", minLength: 1 },
            count: { type: "number", minimum: 0 },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    ];

    const result = formatTools(tools);

    expect(result[0]!.input_schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        count: { type: "number", minimum: 0 },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });
});
