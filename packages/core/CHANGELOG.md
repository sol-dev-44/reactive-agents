# @reactive-agent/core

## 0.1.0 — Initial release

- Tag-based DAG orchestration (Kahn's algorithm, cycle detection)
- LRU cache with TTL and tag-based invalidation
- `execute()` — single agent execution with cache, retry, tool loops
- `stream()` — single agent streaming
- `executePipeline()` — DAG-resolved multi-agent pipeline execution
- `streamPipeline()` — streaming pipeline with concurrent wave execution
- Provider-agnostic interface (swap Anthropic for OpenAI without touching core)
- Error hierarchy with typed codes
- Retry with exponential backoff + jitter
