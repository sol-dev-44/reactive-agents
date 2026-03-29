# ReactiveAgents

> RTK Query for AI Agents. Import, configure, run.

ReactiveAgents manages AI agents like RTK Query manages REST endpoints. Same DX: tags, invalidation, caching, hooks. TypeScript-first. Runs anywhere Node runs.

## Why?

Every team building with LLMs writes the same boilerplate: caching, retries, dependency chains, state management. ReactiveAgents handles all of it with a familiar API.

- **Tag-based invalidation** — declare what data agents produce and consume. Dependencies resolve automatically.
- **Built-in caching** — input hashing, TTL, LRU eviction. Same question = cached answer. Zero wasted tokens.
- **DAG execution** — agents run in the optimal order with maximum parallelism. No manual orchestration.
- **Type-safe** — full TypeScript generics, discriminated unions, strict mode. No `any`.
- **Zero dependencies** — `@reactive-agents/core` has zero production dependencies.

## Quick Start

```bash
npm install @reactive-agents/core @reactive-agents/anthropic
```

```typescript
import { createAgentApi } from "@reactive-agents/core";
import { createAnthropicProvider } from "@reactive-agents/anthropic";

const api = createAgentApi({
  name: "my-app",
  provider: createAnthropicProvider(),
  defaultModel: "claude-sonnet-4-20250514",
  agents: {
    researcher: {
      name: "researcher",
      systemPrompt: "You are a research assistant. Given a topic, produce detailed findings.",
      providesTags: ["Research"],
    },
    analyst: {
      name: "analyst",
      systemPrompt: "Given research findings, identify key insights and patterns.",
      providesTags: ["Analysis"],
      invalidatesTags: ["Research"], // runs after researcher
    },
  },
});

// Execute a single agent
const result = await api.execute("researcher", "AI trends 2025");
console.log(result.data);        // research output
console.log(result.fromCache);   // false (first call)

// Same input = cached
const cached = await api.execute("researcher", "AI trends 2025");
console.log(cached.fromCache);   // true
console.log(cached.usage.totalTokens); // 0

// Run a pipeline — DAG resolves order automatically
const pipeline = await api.executePipeline(
  ["researcher", "analyst"],
  "AI trends 2025"
);
console.log(pipeline.finalResult.data);
```

## Core Concepts

### Agents

An agent wraps an LLM call with a system prompt, input/output parsing, and caching config:

```typescript
const api = createAgentApi({
  name: "app",
  provider: createAnthropicProvider(),
  defaultModel: "claude-sonnet-4-20250514",
  agents: {
    summarizer: {
      name: "summarizer",
      systemPrompt: "Summarize the given text in 3 sentences.",
      maxTokens: 512,
      temperature: 0.3,
      cacheTtl: 600_000, // 10 minute cache
      retry: { maxRetries: 3, backoffMs: 1000 },
      providesTags: ["Summary"],
    },
  },
});
```

### Tags & Dependencies

Tags declare data relationships. The DAG resolver figures out execution order:

```typescript
agents: {
  researcher: {
    providesTags: ["Research"],           // "I produce research data"
  },
  analyst: {
    providesTags: ["Analysis"],
    invalidatesTags: ["Research"],         // "I need research data" → runs after researcher
  },
  reporter: {
    providesTags: ["Report"],
    invalidatesTags: ["Analysis"],         // "I need analysis data" → runs after analyst
  },
}
```

Tags support granular IDs for targeted invalidation:

```typescript
providesTags: [{ type: "Analysis", id: "sentiment" }],
invalidatesTags: [{ type: "Analysis", id: "sentiment" }], // only invalidates sentiment analysis
```

### Caching

Results are cached by input hash. Same input = same cached result:

```typescript
// First call — executes LLM
const r1 = await api.execute("researcher", "quantum computing");
// r1.fromCache === false, r1.usage.totalTokens === 1523

// Second call — served from cache
const r2 = await api.execute("researcher", "quantum computing");
// r2.fromCache === true, r2.usage.totalTokens === 0

// Manual invalidation
api.invalidateTags(["Research"]);

// Next call re-executes
const r3 = await api.execute("researcher", "quantum computing");
// r3.fromCache === false
```

### Pipelines

Execute multiple agents with automatic dependency resolution:

```typescript
const result = await api.executePipeline(
  ["researcher", "analyst", "reporter"],
  "AI trends 2025",
  {
    onStepComplete: (name, r) => {
      console.log(`${name}: ${r.usage.totalTokens} tokens`);
    },
  }
);

console.log(result.finalResult.data);       // reporter's output
console.log(result.totalUsage.totalTokens); // sum of all agents
console.log(result.totalDurationMs);        // wall clock time
```

### Parallel Execution

Agents with no tag dependencies run in parallel automatically:

```typescript
agents: {
  sentimentAnalyzer: {
    providesTags: [{ type: "Analysis", id: "sentiment" }],
  },
  topicExtractor: {
    providesTags: [{ type: "Analysis", id: "topics" }],
  },
  entityRecognizer: {
    providesTags: [{ type: "Analysis", id: "entities" }],
  },
}

// All three run in parallel — no dependencies between them
const plan = api.getExecutionPlan([
  "sentimentAnalyzer", "topicExtractor", "entityRecognizer"
]);
console.log(plan.totalGroups); // 1 — all in one parallel group
```

### Tools

Give agents the ability to call tools:

```typescript
agents: {
  webResearcher: {
    name: "webResearcher",
    systemPrompt: "Research using the provided tools.",
    tools: {
      web_search: {
        definition: {
          name: "web_search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        handler: async (input) => {
          const results = await fetch(`https://api.search.com?q=${input.query}`);
          return JSON.stringify(await results.json());
        },
      },
    },
    maxToolRounds: 5,
  },
}
```

### Streaming

```typescript
// Direct streaming
for await (const event of api.stream("reporter", analysisData)) {
  if (event.type === "text_delta") {
    process.stdout.write(event.text ?? "");
  }
}
```

## React Hooks

```bash
npm install @reactive-agents/react
```

```tsx
import { AgentApiProvider, useAgent, useAgentResult } from "@reactive-agents/react";

// Wrap your app
function App() {
  return (
    <AgentApiProvider value={api}>
      <Dashboard />
    </AgentApiProvider>
  );
}

// Use in components
function ResearchPanel({ topic }: { topic: string }) {
  const { execute, data, isLoading, error } = useAgent<string>("researcher");

  return (
    <div>
      <button onClick={() => execute(topic)} disabled={isLoading}>
        {isLoading ? "Researching..." : "Research"}
      </button>
      {error && <p className="error">{error.message}</p>}
      {data && <p>{data}</p>}
    </div>
  );
}

// Streaming mode
function StreamingReport({ input }: { input: string }) {
  const { execute, streamingText, isStreaming, data } = useAgent("reporter", {
    stream: true,
  });

  return (
    <div>
      <button onClick={() => execute(input)}>Generate</button>
      {isStreaming && <p>{streamingText}</p>}
      {data && <p>{data}</p>}
    </div>
  );
}
```

## API Reference

### `createAgentApi(config)`

Creates an agent API instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | required | API instance name |
| `provider` | `Provider` | required | LLM provider adapter |
| `defaultModel` | `string` | required | Default model for all agents |
| `agents` | `Record<string, AgentConfig>` | required | Agent definitions |
| `tagTypes` | `string[]` | `[]` | Registered tag types |
| `defaultCacheTtl` | `number` | `300000` | Default cache TTL (ms) |
| `defaultMaxTokens` | `number` | `4096` | Default max tokens |

### `api.execute(agentName, input)`

Execute a single agent. Returns `Promise<AgentResult<TResult>>`.

### `api.executePipeline(agentNames, input, options?)`

Execute a pipeline of agents with automatic DAG resolution. Returns `Promise<PipelineResult>`.

### `api.stream(agentName, input)`

Stream agent output. Returns `AsyncIterable<StreamEvent>`.

### `api.getExecutionPlan(agentNames)`

Get the execution plan without running it. Returns `ExecutionPlan`.

### `api.invalidateTags(tags)`

Manually invalidate cache entries matching the given tags.

### `api.clearCache()`

Clear all cached results.

### `api.getUsage()` / `api.resetUsage()`

Get or reset cumulative token usage across all executions.

## Error Handling

All errors extend `ReactiveAgentsError` with a `code` property:

| Error | Code | Description |
|-------|------|-------------|
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | Agent name not in config |
| `CircularDependencyError` | `CIRCULAR_DEPENDENCY` | Cycle detected in tag dependencies |
| `ToolExecutionError` | `TOOL_EXECUTION_FAILED` | Tool handler threw |
| `ProviderError` | `PROVIDER_ERROR` | LLM provider returned error |
| `MaxToolRoundsError` | `MAX_TOOL_ROUNDS` | Agent exceeded tool call limit |
| `TimeoutError` | `TIMEOUT` | Agent execution timed out |

```typescript
import { ReactiveAgentsError } from "@reactive-agents/core";

try {
  await api.execute("researcher", "quantum computing");
} catch (error) {
  if (error instanceof ReactiveAgentsError) {
    console.error(`[${error.code}] ${error.message}`);
  }
}
```

## Packages

| Package | Description | Dependencies |
|---------|-------------|--------------|
| `@reactive-agents/core` | Engine, cache, DAG, tags | Zero |
| `@reactive-agents/anthropic` | Claude adapter | `@anthropic-ai/sdk` |
| `@reactive-agents/react` | React hooks | `react` |

## Examples

- [Research Pipeline](./examples/research-pipeline) — 3-agent pipeline demo

## Roadmap

- OpenAI adapter
- Redis cache adapter
- React Suspense support
- Polling intervals
- Subscription ref counting

## License

MIT
