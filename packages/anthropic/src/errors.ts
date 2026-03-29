/**
 * Anthropic-specific error handling utilities.
 *
 * Provides rate-limit detection, retryable-error classification,
 * and wrapping of raw SDK errors into a consistent shape.
 */

/** Error codes specific to the Anthropic provider adapter. */
export type AnthropicErrorCode =
  | "ANTHROPIC_RATE_LIMIT"
  | "ANTHROPIC_OVERLOADED"
  | "ANTHROPIC_AUTH"
  | "ANTHROPIC_BAD_REQUEST"
  | "ANTHROPIC_NOT_FOUND"
  | "ANTHROPIC_SERVER_ERROR"
  | "ANTHROPIC_CONNECTION"
  | "ANTHROPIC_UNKNOWN";

/**
 * A wrapped Anthropic error with structured metadata.
 */
export class AnthropicProviderError extends Error {
  public readonly code: AnthropicErrorCode;
  public readonly statusCode: number | undefined;
  public readonly isRetryable: boolean;
  public readonly isRateLimit: boolean;
  public readonly cause: unknown;

  constructor(opts: {
    message: string;
    code: AnthropicErrorCode;
    statusCode?: number;
    isRetryable: boolean;
    isRateLimit: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "AnthropicProviderError";
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.isRetryable = opts.isRetryable;
    this.isRateLimit = opts.isRateLimit;
    this.cause = opts.cause;
  }
}

/**
 * Detect whether an error is a 429 rate-limit error.
 *
 * Works with both the Anthropic SDK's RateLimitError class and
 * plain objects / errors that carry a `status` property of 429.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;

  // SDK RateLimitError has status === 429
  if ("status" in error && (error as { status: unknown }).status === 429) {
    return true;
  }

  // Fallback: check the constructor name
  if (
    error instanceof Error &&
    error.constructor.name === "RateLimitError"
  ) {
    return true;
  }

  return false;
}

/**
 * Detect whether an error is retryable (transient).
 *
 * Retryable errors:
 * - 429 rate limit
 * - 500+ server errors (overloaded, internal errors)
 * - Connection / timeout errors
 */
export function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;

  if (error == null || typeof error !== "object") return false;

  // Server errors (5xx)
  if ("status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && status >= 500) return true;
  }

  // SDK connection errors
  if (error instanceof Error) {
    const name = error.constructor.name;
    if (
      name === "APIConnectionError" ||
      name === "APIConnectionTimeoutError" ||
      name === "InternalServerError"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Wrap any thrown error from the Anthropic SDK into an AnthropicProviderError.
 */
export function wrapError(error: unknown): AnthropicProviderError {
  const message =
    error instanceof Error ? error.message : String(error);

  // Rate limit
  if (isRateLimitError(error)) {
    return new AnthropicProviderError({
      message: `Anthropic rate limit exceeded: ${message}`,
      code: "ANTHROPIC_RATE_LIMIT",
      statusCode: 429,
      isRetryable: true,
      isRateLimit: true,
      cause: error,
    });
  }

  // Typed status-based errors
  if (error != null && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;

    if (status === 401) {
      return new AnthropicProviderError({
        message: `Anthropic authentication failed: ${message}`,
        code: "ANTHROPIC_AUTH",
        statusCode: 401,
        isRetryable: false,
        isRateLimit: false,
        cause: error,
      });
    }

    if (status === 400) {
      return new AnthropicProviderError({
        message: `Anthropic bad request: ${message}`,
        code: "ANTHROPIC_BAD_REQUEST",
        statusCode: 400,
        isRetryable: false,
        isRateLimit: false,
        cause: error,
      });
    }

    if (status === 404) {
      return new AnthropicProviderError({
        message: `Anthropic resource not found: ${message}`,
        code: "ANTHROPIC_NOT_FOUND",
        statusCode: 404,
        isRetryable: false,
        isRateLimit: false,
        cause: error,
      });
    }

    if (typeof status === "number" && status >= 500) {
      return new AnthropicProviderError({
        message: `Anthropic server error: ${message}`,
        code: "ANTHROPIC_SERVER_ERROR",
        statusCode: status,
        isRetryable: true,
        isRateLimit: false,
        cause: error,
      });
    }
  }

  // Connection errors
  if (
    error instanceof Error &&
    (error.constructor.name === "APIConnectionError" ||
      error.constructor.name === "APIConnectionTimeoutError")
  ) {
    return new AnthropicProviderError({
      message: `Anthropic connection error: ${message}`,
      code: "ANTHROPIC_CONNECTION",
      isRetryable: true,
      isRateLimit: false,
      cause: error,
    });
  }

  // Unknown
  return new AnthropicProviderError({
    message: `Anthropic error: ${message}`,
    code: "ANTHROPIC_UNKNOWN",
    isRetryable: false,
    isRateLimit: false,
    cause: error,
  });
}
