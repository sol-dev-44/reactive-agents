# Research Pipeline Example

A CLI demo that runs 3 agents in a pipeline:

1. **Researcher** — Given a topic, produces detailed research findings
2. **Analyst** — Given research, identifies patterns and key insights
3. **Reporter** — Given analysis, writes a concise executive summary

## Usage

```bash
# From the repo root
pnpm install
pnpm build

# Run the demo
cd examples/research-pipeline
ANTHROPIC_API_KEY=sk-ant-... pnpm start "AI agent frameworks in 2025"
```

The second run demonstrates caching — all 3 agents are served from cache with 0 tokens used.
