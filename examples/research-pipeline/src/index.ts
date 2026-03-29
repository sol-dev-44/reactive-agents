import { createAgentApi } from "@reactive-agents/core";
import { createAnthropicProvider } from "@reactive-agents/anthropic";

const topic = process.argv[2] ?? "AI agent frameworks in 2025";

const api = createAgentApi({
  name: "research-pipeline",
  provider: createAnthropicProvider(),
  defaultModel: "claude-sonnet-4-20250514",
  tagTypes: ["Research", "Analysis", "Report"],
  onExecutionStart: (name) => console.log(`  [${name}] executing...`),
  onCacheHit: (name) => console.log(`  [${name}] cache hit`),
  agents: {
    researcher: {
      name: "researcher",
      systemPrompt:
        "You are a senior research assistant. Given a topic, produce comprehensive research findings with sources, data points, and key facts. Be thorough but concise.",
      providesTags: ["Research"],
      maxTokens: 2048,
    },
    analyst: {
      name: "analyst",
      systemPrompt:
        "You are a data analyst. Given research findings, identify the top 3-5 key insights, emerging patterns, and actionable takeaways. Structure your analysis clearly.",
      providesTags: ["Analysis"],
      invalidatesTags: ["Research"],
      maxTokens: 2048,
    },
    reporter: {
      name: "reporter",
      systemPrompt:
        "You are an executive report writer. Given analysis, produce a clear, compelling 3-paragraph executive summary suitable for a busy CEO. No jargon.",
      providesTags: ["Report"],
      invalidatesTags: ["Analysis"],
      maxTokens: 1024,
    },
  },
});

async function main() {
  console.log("\nReactiveAgents Research Pipeline Demo");
  console.log("=".repeat(40));
  console.log(`\nTopic: "${topic}"\n`);

  const result = await api.executePipeline(
    ["researcher", "analyst", "reporter"],
    topic,
    {
      onStepComplete: (name, r) => {
        console.log(
          `  > ${name} done (${r.usage.totalTokens} tokens, ${r.durationMs}ms)`,
        );
      },
    },
  );

  console.log("\n--- Executive Summary ---\n");
  console.log(result.finalResult.data);
  console.log("\n" + "=".repeat(40));
  console.log(
    `Total: ${result.totalUsage.totalTokens} tokens | ${result.totalDurationMs}ms`,
  );

  // Demonstrate caching
  console.log("\nRunning again (should hit cache)...");
  const cached = await api.executePipeline(
    ["researcher", "analyst", "reporter"],
    topic,
  );
  console.log(
    `  Cached: ${Object.values(cached.results).every((r) => r.fromCache)}`,
  );
  console.log(`  Tokens: ${cached.totalUsage.totalTokens} (should be 0)`);
}

main().catch(console.error);
