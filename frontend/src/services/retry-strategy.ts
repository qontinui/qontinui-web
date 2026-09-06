/**
 * RetryStrategy - Handles HTTP request retry logic with backoff
 *
 * Implements exponential backoff for server errors and rate limit handling.
 *
 * WHAT it retries is decided outside this class. `shouldRetry` knows only the
 * status (429, or any 5xx) and the attempt count; it knows nothing about the
 * request's method, whether the caller declared it idempotent, or which
 * statuses the caller opted out of. `HttpClient` owns that decision
 * (`isRetryableStatus`) and hands it in as the optional `isRetryable`
 * predicate on `executeWithRetry`, which is consulted on EVERY response in the
 * chain — not just the one that entered it — so a chain entered on a 429
 * cannot slide into retrying a 5xx the caller's policy forbids. Without a
 * predicate the class keeps its original status-only behaviour.
 *
 * Thrown errors (network failure, the client-side timeout) are never retried
 * here: the chain branches on `response.status` only.
 */

export interface RetryConfig {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export interface RetryResult {
  shouldRetry: boolean;
  waitMs: number;
  reason?: string;
}

export class RetryStrategy {
  static readonly DEFAULT_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
  };

  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...RetryStrategy.DEFAULT_CONFIG, ...config };
  }

  /**
   * A strategy with the same backoff configuration but a different retry
   * budget. Used for a per-request `maxRetries` override so the override
   * never has to mutate a strategy that other callers share.
   */
  withMaxRetries(maxRetries: number): RetryStrategy {
    if (maxRetries === this.config.maxRetries) return this;
    return new RetryStrategy({ ...this.config, maxRetries });
  }

  /**
   * Execute a request function with automatic retry logic
   *
   * @param requestFn Function that returns a Promise<Response>
   * @param attempt Current attempt number (starts at 1)
   * @param isRetryable Optional caller policy consulted on every response in
   *   the chain BEFORE the status/attempt check. When it returns false the
   *   response is returned as-is, whatever its status. Threaded through the
   *   recursion so it gates the second, third, … response too.
   * @returns The successful response
   */
  async executeWithRetry(
    requestFn: () => Promise<Response>,
    attempt: number = 1,
    isRetryable?: (response: Response) => boolean
  ): Promise<Response> {
    const response = await requestFn();

    // The caller's policy wins over the status check: a response it declares
    // non-retryable leaves the chain here, so a chain entered on a 429 cannot
    // retry a later 5xx the caller forbade (non-idempotent method, or an
    // opted-out status).
    if (isRetryable && !isRetryable(response)) {
      return response;
    }

    // Check if we should retry based on response status
    const retryDecision = this.shouldRetry(response, attempt);

    if (retryDecision.shouldRetry) {
      console.warn(
        `[RetryStrategy] ${retryDecision.reason}. Retrying in ${retryDecision.waitMs}ms (attempt ${attempt}/${this.config.maxRetries})`
      );
      await this.wait(retryDecision.waitMs);
      return this.executeWithRetry(requestFn, attempt + 1, isRetryable);
    }

    return response;
  }

  /**
   * Determine if a response should trigger a retry
   *
   * @param response The HTTP response
   * @param attempt Current attempt number
   * @returns RetryResult indicating whether to retry and how long to wait
   */
  private shouldRetry(response: Response, attempt: number): RetryResult {
    // Don't retry if we've exceeded max attempts
    if (attempt > this.config.maxRetries) {
      return { shouldRetry: false, waitMs: 0 };
    }

    // Handle rate limiting (429)
    if (response.status === 429) {
      return this.handleRateLimitRetry(response);
    }

    // Handle server errors (5xx)
    if (response.status >= 500) {
      return this.handleServerErrorRetry(attempt);
    }

    // Don't retry for other status codes
    return { shouldRetry: false, waitMs: 0 };
  }

  /**
   * Handle retry logic for rate limiting (429 status)
   *
   * @param response The HTTP response with rate limit
   * @returns RetryResult with wait time from Retry-After header
   */
  private handleRateLimitRetry(response: Response): RetryResult {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader
      ? parseInt(retryAfterHeader)
      : 60;
    const waitMs = retryAfterSeconds * 1000;

    return {
      shouldRetry: true,
      waitMs,
      reason: `Rate limited (429)`,
    };
  }

  /**
   * Handle retry logic for server errors (5xx status)
   *
   * Uses exponential backoff: wait = min(initialBackoff * 2^(attempt-1), maxBackoff)
   *
   * @param attempt Current attempt number
   * @returns RetryResult with exponential backoff wait time
   */
  private handleServerErrorRetry(attempt: number): RetryResult {
    const backoffMs = this.calculateBackoff(attempt);

    return {
      shouldRetry: true,
      waitMs: backoffMs,
      reason: `Server error (5xx)`,
    };
  }

  /**
   * Calculate exponential backoff time
   *
   * Formula: min(initialBackoff * 2^(attempt-1), maxBackoff)
   *
   * @param attempt Current attempt number
   * @returns Backoff time in milliseconds
   */
  calculateBackoff(attempt: number): number {
    const exponentialBackoff =
      this.config.initialBackoffMs * Math.pow(2, attempt - 1);
    return Math.min(exponentialBackoff, this.config.maxBackoffMs);
  }

  /**
   * Wait for a specified duration
   *
   * @param ms Milliseconds to wait
   * @returns Promise that resolves after the wait time
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the maximum number of retries configured
   */
  getMaxRetries(): number {
    return this.config.maxRetries;
  }

  /**
   * Check if an attempt number is within retry limits
   *
   * @param attempt Current attempt number
   * @returns true if more retries are allowed
   */
  canRetry(attempt: number): boolean {
    return attempt <= this.config.maxRetries;
  }
}

// Export a default instance for convenience
export const defaultRetryStrategy = new RetryStrategy();
