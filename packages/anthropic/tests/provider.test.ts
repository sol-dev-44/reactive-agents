import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderExecuteParams, StreamEvent } from "@reactive-agent/core";

// ============================================================
// Mock the Anthropic SDK — must be before the provider import
// ============================================================

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  }));
  return { default: MockAnthropic };
});

// Import *after* the mock is set up
import { createAnthropicProvider } from "../src/provider.js";

// ============================================================
// Helpers
// ============================================================

function makeExecuteParams(
  overrides: Partial<ProviderExecuteParams> = {},
): ProviderExecuteParams {
  return {
    model: "claude-sonnet-4-20250514",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

function makeAnthropicResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello! How can I help?" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe("createAnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a provider with name 'anthropic'", () => {
    const provider = createAnthropicProvider();
    expect(provider.name).toBe("anthropic");
  });

  it("should have execute and stream methods", () => {
    const provider = createAnthropicProvider();
    expect(typeof provider.execute).toBe("function");
    expect(typeof provider.stream).toBe("function");
  });
});

// ============================================================
// execute()
// ============================================================

describe("provider.execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call client.messages.create with correct parameters", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(
      makeExecuteParams({
        systemPrompt: "You are helpful",
        maxTokens: 1000,
        temperature: 0.7,
      }),
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).toMatchObject({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: "You are helpful",
      temperature: 0.7,
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("should extract text content from the response", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    expect(result.content).toBe("Hello! How can I help?");
  });

  it("should concatenate multiple text blocks", async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse({
        content: [
          { type: "text", text: "Part one. " },
          { type: "text", text: "Part two." },
        ],
      }),
    );

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    expect(result.content).toBe("Part one. Part two.");
  });

  it("should extract tool calls from the response", async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse({
        content: [
          { type: "text", text: "Let me check the weather." },
          {
            type: "tool_use",
            id: "tool_abc123",
            name: "get_weather",
            input: { location: "San Francisco" },
          },
        ],
        stop_reason: "tool_use",
      }),
    );

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: "tool_abc123",
      name: "get_weather",
      input: { location: "San Francisco" },
    });
    expect(result.stopReason).toBe("tool_use");
  });

  it("should report token usage", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.usage.totalTokens).toBe(30);
  });

  it("should include estimated cost for known models", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    // claude-sonnet-4-20250514: $3/1M input, $15/1M output
    // 10 input * 3/1M + 20 output * 15/1M = 0.00003 + 0.0003 = 0.00033
    expect(result.usage.estimatedCostUsd).toBeCloseTo(0.00033, 6);
  });

  it("should have undefined estimatedCostUsd for unknown models", async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse({ model: "unknown-model" }),
    );

    const provider = createAnthropicProvider();
    const result = await provider.execute(
      makeExecuteParams({ model: "unknown-model" }),
    );

    expect(result.usage.estimatedCostUsd).toBeUndefined();
  });

  it("should map stop_reason correctly", async () => {
    for (const reason of [
      "end_turn",
      "tool_use",
      "max_tokens",
      "stop_sequence",
    ] as const) {
      mockCreate.mockResolvedValue(
        makeAnthropicResponse({ stop_reason: reason }),
      );

      const provider = createAnthropicProvider();
      const result = await provider.execute(makeExecuteParams());

      expect(result.stopReason).toBe(reason);
    }
  });

  it("should default stop_reason to 'end_turn' for null", async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse({ stop_reason: null }),
    );

    const provider = createAnthropicProvider();
    const result = await provider.execute(makeExecuteParams());

    expect(result.stopReason).toBe("end_turn");
  });

  it("should filter out system messages before sending", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(
      makeExecuteParams({
        messages: [
          { role: "system", content: "System prompt in messages" },
          { role: "user", content: "Hello" },
        ],
      }),
    );

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const messages = callArgs["messages"] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!["role"]).toBe("user");
  });

  it("should pass tools when provided", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(
      makeExecuteParams({
        tools: [
          {
            name: "search",
            description: "Search the web",
            inputSchema: {
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        ],
      }),
    );

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const tools = callArgs["tools"] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!["name"]).toBe("search");
    expect(tools[0]!["input_schema"]).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
    });
  });

  it("should not include tools key when tools array is empty", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(makeExecuteParams({ tools: [] }));

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("tools");
  });

  it("should not include system key when systemPrompt is undefined", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(makeExecuteParams({ systemPrompt: undefined }));

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("system");
  });

  it("should use default max_tokens of 4096 when not specified", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(makeExecuteParams());

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["max_tokens"]).toBe(4096);
  });

  it("should pass stop_sequences when provided", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const provider = createAnthropicProvider();
    await provider.execute(
      makeExecuteParams({ stopSequences: ["STOP", "END"] }),
    );

    const callArgs = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["stop_sequences"]).toEqual(["STOP", "END"]);
  });

  it("should wrap SDK errors into AnthropicProviderError", async () => {
    const sdkError = Object.assign(new Error("Rate limit"), {
      status: 429,
      headers: {},
      error: {},
    });
    mockCreate.mockRejectedValue(sdkError);

    const provider = createAnthropicProvider();

    await expect(provider.execute(makeExecuteParams())).rejects.toThrow(
      "Anthropic rate limit exceeded",
    );
  });
});

// ============================================================
// stream()
// ============================================================

describe("provider.stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should yield text_delta events from the stream", async () => {
    // Create an async iterable that simulates Anthropic stream events
    async function* fakeStream() {
      yield {
        type: "content_block_start" as const,
        index: 0,
        content_block: { type: "text" as const, text: "", citations: null },
      };
      yield {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "text_delta" as const, text: "Hello" },
      };
      yield {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "text_delta" as const, text: " world" },
      };
      yield {
        type: "content_block_stop" as const,
        index: 0,
      };
      yield { type: "message_stop" as const };
    }

    mockStream.mockReturnValue(fakeStream());

    const provider = createAnthropicProvider();
    const events: StreamEvent[] = [];

    for await (const event of provider.stream(makeExecuteParams())) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0]!.text).toBe("Hello");
    expect(textEvents[1]!.text).toBe(" world");
  });

  it("should yield tool_use events from the stream", async () => {
    async function* fakeStream() {
      yield {
        type: "content_block_start" as const,
        index: 0,
        content_block: {
          type: "tool_use" as const,
          id: "tool_123",
          name: "get_weather",
          input: {},
        },
      };
      yield {
        type: "content_block_delta" as const,
        index: 0,
        delta: {
          type: "input_json_delta" as const,
          partial_json: '{"location":',
        },
      };
      yield {
        type: "content_block_delta" as const,
        index: 0,
        delta: {
          type: "input_json_delta" as const,
          partial_json: '"SF"}',
        },
      };
      yield {
        type: "content_block_stop" as const,
        index: 0,
      };
      yield { type: "message_stop" as const };
    }

    mockStream.mockReturnValue(fakeStream());

    const provider = createAnthropicProvider();
    const events: StreamEvent[] = [];

    for await (const event of provider.stream(makeExecuteParams())) {
      events.push(event);
    }

    const toolEvents = events.filter((e) => e.type === "tool_use");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]!.toolCall).toEqual({
      id: "tool_123",
      name: "get_weather",
      input: { location: "SF" },
    });
  });

  it("should yield a complete event at the end", async () => {
    async function* fakeStream() {
      yield {
        type: "content_block_start" as const,
        index: 0,
        content_block: { type: "text" as const, text: "", citations: null },
      };
      yield {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "text_delta" as const, text: "Done" },
      };
      yield {
        type: "content_block_stop" as const,
        index: 0,
      };
      yield { type: "message_stop" as const };
    }

    mockStream.mockReturnValue(fakeStream());

    const provider = createAnthropicProvider();
    const events: StreamEvent[] = [];

    for await (const event of provider.stream(makeExecuteParams())) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent!.type).toBe("complete");
  });

  it("should yield an error event when the stream throws", async () => {
    async function* fakeStream(): AsyncGenerator<never> {
      throw new Error("Connection lost");
    }

    mockStream.mockReturnValue(fakeStream());

    const provider = createAnthropicProvider();
    const events: StreamEvent[] = [];

    for await (const event of provider.stream(makeExecuteParams())) {
      events.push(event);
    }

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.error!.message).toBe("Connection lost");
  });

  it("should yield an error event when mockStream itself throws", async () => {
    mockStream.mockImplementation(() => {
      throw new Error("SDK initialization failed");
    });

    const provider = createAnthropicProvider();
    const events: StreamEvent[] = [];

    for await (const event of provider.stream(makeExecuteParams())) {
      events.push(event);
    }

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.error!.message).toBe("SDK initialization failed");
  });
});
