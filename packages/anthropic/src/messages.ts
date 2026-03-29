import type Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, ToolDefinition } from "@reactive-agent/core";

/**
 * Anthropic MessageParam — the format the SDK expects for messages.
 */
export type AnthropicMessageParam = Anthropic.MessageParam;

/**
 * Anthropic Tool — the format the SDK expects for tool definitions.
 */
export type AnthropicTool = Anthropic.Tool;

/**
 * Convert provider-agnostic AgentMessages into Anthropic MessageParam[].
 *
 * System messages are filtered out because Anthropic handles the system prompt
 * as a separate top-level parameter in the API call, not as a message.
 */
export function formatMessages(
  messages: readonly AgentMessage[],
): AnthropicMessageParam[] {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg): AnthropicMessageParam => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
}

/**
 * Convert provider-agnostic ToolDefinitions into Anthropic Tool[].
 *
 * Maps the generic `inputSchema` to Anthropic's `input_schema` format,
 * which requires `type: "object"` at the top level.
 */
export function formatTools(
  tools: readonly ToolDefinition[],
): AnthropicTool[] {
  return tools.map((tool): AnthropicTool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      ...tool.inputSchema,
    },
  }));
}
