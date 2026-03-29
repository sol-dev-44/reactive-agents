export class ReactiveAgentsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ReactiveAgentsError";
  }
}

export class AgentNotFoundError extends ReactiveAgentsError {
  constructor(agentName: string) {
    super(`Agent "${agentName}" not found in config`, "AGENT_NOT_FOUND");
    this.name = "AgentNotFoundError";
  }
}

export class CircularDependencyError extends ReactiveAgentsError {
  constructor(public readonly agents: string[]) {
    super(
      `Circular dependency detected involving agents: ${agents.join(", ")}`,
      "CIRCULAR_DEPENDENCY",
    );
    this.name = "CircularDependencyError";
  }
}

export class ToolExecutionError extends ReactiveAgentsError {
  constructor(toolName: string, cause: unknown) {
    super(
      `Tool "${toolName}" execution failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      "TOOL_EXECUTION_FAILED",
    );
    this.name = "ToolExecutionError";
  }
}

export class ProviderError extends ReactiveAgentsError {
  constructor(providerName: string, cause: unknown) {
    super(
      `Provider "${providerName}" error: ${cause instanceof Error ? cause.message : String(cause)}`,
      "PROVIDER_ERROR",
    );
    this.name = "ProviderError";
  }
}

export class MaxToolRoundsError extends ReactiveAgentsError {
  constructor(agentName: string, rounds: number) {
    super(
      `Agent "${agentName}" exceeded max tool rounds (${rounds})`,
      "MAX_TOOL_ROUNDS",
    );
    this.name = "MaxToolRoundsError";
  }
}

export class CacheError extends ReactiveAgentsError {
  constructor(message: string) {
    super(message, "CACHE_ERROR");
    this.name = "CacheError";
  }
}

export class TimeoutError extends ReactiveAgentsError {
  constructor(agentName: string, timeoutMs: number) {
    super(
      `Agent "${agentName}" timed out after ${timeoutMs}ms`,
      "TIMEOUT",
    );
    this.name = "TimeoutError";
  }
}
