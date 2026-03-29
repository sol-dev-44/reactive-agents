import type Anthropic from "@anthropic-ai/sdk";
import type { StreamEvent, ToolCall } from "@reactive-agents/core";

/**
 * Convert an Anthropic MessageStream (AsyncIterable<RawMessageStreamEvent>)
 * into an AsyncGenerator of provider-agnostic StreamEvents.
 *
 * Handles:
 * - content_block_start with tool_use blocks -> StreamEvent { type: "tool_use" }
 * - content_block_delta with text_delta -> StreamEvent { type: "text_delta" }
 * - message_stop -> StreamEvent { type: "complete" }
 * - errors -> StreamEvent { type: "error" }
 */
export async function* mapStreamEvents(
  stream: AsyncIterable<Anthropic.RawMessageStreamEvent>,
): AsyncGenerator<StreamEvent> {
  /**
   * Track tool_use blocks as they are built up across
   * content_block_start + content_block_delta events.
   */
  const pendingToolCalls = new Map<
    number,
    { id: string; name: string; jsonChunks: string[] }
  >();

  try {
    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            pendingToolCalls.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              jsonChunks: [],
            });
          }
          break;
        }

        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            const pending = pendingToolCalls.get(event.index);
            if (pending) {
              pending.jsonChunks.push(event.delta.partial_json);
            }
          }
          break;
        }

        case "content_block_stop": {
          const pending = pendingToolCalls.get(event.index);
          if (pending) {
            const input = pending.jsonChunks.length > 0
              ? (JSON.parse(pending.jsonChunks.join("")) as Record<string, unknown>)
              : {};
            const toolCall: ToolCall = {
              id: pending.id,
              name: pending.name,
              input,
            };
            yield { type: "tool_use", toolCall };
            pendingToolCalls.delete(event.index);
          }
          break;
        }

        case "message_stop": {
          yield { type: "complete" };
          break;
        }

        // message_start and message_delta are informational; we don't need to
        // emit them as StreamEvents.
        default:
          break;
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
