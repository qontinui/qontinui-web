/**
 * Database Error Handler
 *
 * Provides unified error handling, recovery, and retry logic for IndexedDB operations.
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Known IndexedDB error types
 */
export enum DBErrorType {
  /** Connection failed or closed */
  CONNECTION_ERROR = "CONNECTION_ERROR",
  /** Transaction aborted */
  TRANSACTION_ABORTED = "TRANSACTION_ABORTED",
  /** Constraint violation (e.g., duplicate key) */
  CONSTRAINT_ERROR = "CONSTRAINT_ERROR",
  /** Data error (e.g., invalid data) */
  DATA_ERROR = "DATA_ERROR",
  /** Quota exceeded */
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  /** Version error (upgrade blocked) */
  VERSION_ERROR = "VERSION_ERROR",
  /** Operation not allowed */
  NOT_ALLOWED = "NOT_ALLOWED",
  /** Unknown error */
  UNKNOWN = "UNKNOWN",
}

/**
 * Structured database error
 */
export class DBError extends Error {
  readonly type: DBErrorType;
  readonly operation: string;
  readonly storeName?: string;
  readonly originalError?: Error;
  readonly retryable: boolean;

  constructor(
    type: DBErrorType,
    message: string,
    options: {
      operation: string;
      storeName?: string;
      originalError?: Error;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "DBError";
    this.type = type;
    this.operation = options.operation;
    this.storeName = options.storeName;
    this.originalError = options.originalError;
    this.retryable = options.retryable ?? this.isRetryable(type);
  }

  private isRetryable(type: DBErrorType): boolean {
    switch (type) {
      case DBErrorType.CONNECTION_ERROR:
      case DBErrorType.TRANSACTION_ABORTED:
        return true;
      case DBErrorType.CONSTRAINT_ERROR:
      case DBErrorType.DATA_ERROR:
      case DBErrorType.QUOTA_EXCEEDED:
      case DBErrorType.VERSION_ERROR:
      case DBErrorType.NOT_ALLOWED:
        return false;
      default:
        return false;
    }
  }
}

/**
 * Classify an error into a DBErrorType
 */
export function classifyError(error: unknown): DBErrorType {
  if (!(error instanceof Error)) {
    return DBErrorType.UNKNOWN;
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Connection errors
  if (
    message.includes("connection") ||
    message.includes("closed") ||
    message.includes("not available")
  ) {
    return DBErrorType.CONNECTION_ERROR;
  }

  // Transaction errors
  if (
    name === "transactioninactiveerror" ||
    message.includes("transaction") ||
    message.includes("aborted")
  ) {
    return DBErrorType.TRANSACTION_ABORTED;
  }

  // Constraint errors
  if (
    name === "constrainterror" ||
    message.includes("constraint") ||
    message.includes("duplicate") ||
    message.includes("already exists")
  ) {
    return DBErrorType.CONSTRAINT_ERROR;
  }

  // Data errors
  if (name === "dataerror" || message.includes("data")) {
    return DBErrorType.DATA_ERROR;
  }

  // Quota errors
  if (
    name === "quotaexceedederror" ||
    message.includes("quota") ||
    message.includes("storage")
  ) {
    return DBErrorType.QUOTA_EXCEEDED;
  }

  // Version errors
  if (name === "versionerror" || message.includes("version")) {
    return DBErrorType.VERSION_ERROR;
  }

  // Not allowed errors
  if (
    name === "notallowederror" ||
    message.includes("not allowed") ||
    message.includes("permission")
  ) {
    return DBErrorType.NOT_ALLOWED;
  }

  return DBErrorType.UNKNOWN;
}

/**
 * Wrap an error in a DBError
 */
export function wrapError(
  error: unknown,
  operation: string,
  storeName?: string
): DBError {
  const originalError =
    error instanceof Error ? error : new Error(String(error));
  const type = classifyError(originalError);

  return new DBError(type, originalError.message, {
    operation,
    storeName,
    originalError,
  });
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay between retries (ms) */
  baseDelay: number;
  /** Maximum delay between retries (ms) */
  maxDelay: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Jitter factor (0-1) to add randomness to delays */
  jitter: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  exponentialBackoff: true,
  jitter: 0.1,
};

/**
 * Calculate delay for a retry attempt
 */
function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  let delay = config.baseDelay;

  if (config.exponentialBackoff) {
    delay = config.baseDelay * Math.pow(2, attempt);
  }

  delay = Math.min(delay, config.maxDelay);

  if (config.jitter > 0) {
    const jitterAmount = delay * config.jitter;
    delay += Math.random() * jitterAmount - jitterAmount / 2;
  }

  return Math.max(0, delay);
}

/**
 * Execute a database operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    operationName: string;
    storeName?: string;
    retryConfig?: Partial<RetryConfig>;
    onRetry?: (attempt: number, error: DBError) => void;
  }
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options.retryConfig };
  let lastError: DBError | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = wrapError(error, options.operationName, options.storeName);

      // Don't retry non-retryable errors
      if (!lastError.retryable) {
        projectLogger.error("DBErrorHandler", "Non-retryable error", {
          operation: options.operationName,
          store: options.storeName,
          errorType: lastError.type,
          error: lastError.message,
        });
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= config.maxRetries) {
        projectLogger.error("DBErrorHandler", "Max retries exceeded", {
          operation: options.operationName,
          store: options.storeName,
          attempts: attempt + 1,
          error: lastError.message,
        });
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateRetryDelay(attempt, config);

      projectLogger.warn("DBErrorHandler", "Retrying operation", {
        operation: options.operationName,
        store: options.storeName,
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
        delay,
        errorType: lastError.type,
      });

      // Notify caller of retry
      if (options.onRetry) {
        options.onRetry(attempt + 1, lastError);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error("Unknown error in withRetry");
}

/**
 * Handle quota exceeded errors with cleanup suggestions
 */
export async function handleQuotaExceeded(
  dbName: string,
  operation: string
): Promise<void> {
  projectLogger.error("DBErrorHandler", "Storage quota exceeded", {
    database: dbName,
    operation,
  });

  // Suggest cleanup actions
  const suggestions = [
    "Clear browser cache and cookies",
    "Delete old project data",
    "Export data before clearing",
  ];

  projectLogger.info("DBErrorHandler", "Quota recovery suggestions", {
    suggestions,
  });

  // Could emit an event for UI to show a warning
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("db-quota-exceeded", {
        detail: { database: dbName, suggestions },
      })
    );
  }
}

/**
 * Recover from connection errors by reconnecting
 */
export async function recoverConnection(
  getConnection: () => Promise<IDBDatabase>,
  maxAttempts: number = 3
): Promise<IDBDatabase | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const db = await getConnection();
      projectLogger.info("DBErrorHandler", "Connection recovered", {
        attempt,
      });
      return db;
    } catch (error) {
      projectLogger.warn("DBErrorHandler", "Recovery attempt failed", {
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            calculateRetryDelay(attempt, DEFAULT_RETRY_CONFIG)
          )
        );
      }
    }
  }

  projectLogger.error("DBErrorHandler", "Connection recovery failed");
  return null;
}
