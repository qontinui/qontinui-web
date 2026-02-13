import { useCallback } from "react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseErrorHandler");

/**
 * Extracts a human-readable message from an unknown error.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "An unexpected error occurred";
}

interface UseErrorHandlerOptions {
  /** Show toast notifications on error. Defaults to true. */
  showToast?: boolean;
  /** Custom error transform before displaying. */
  formatMessage?: (message: string, action?: string) => string;
}

interface ErrorHandlerResult {
  /** Handle an error with optional action context. Logs and optionally shows a toast. */
  handleError: (error: unknown, action?: string) => void;
  /** Wrap an async function with centralized error handling. Returns undefined on failure. */
  wrapAsync: <T>(
    fn: () => Promise<T>,
    action?: string
  ) => Promise<T | undefined>;
}

/**
 * Centralized error handling hook.
 *
 * Provides consistent error logging and toast notifications across components.
 * Pairs well with sonner toast library already used throughout the app.
 *
 * @param context - The component or module name for log context (e.g., "ProjectLoader", "DatasetImport")
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { handleError, wrapAsync } = useErrorHandler("MyComponent");
 *
 *   const loadData = async () => {
 *     const result = await wrapAsync(
 *       () => api.fetchData(),
 *       "loading data"
 *     );
 *     if (result) {
 *       setData(result);
 *     }
 *   };
 *
 *   const handleClick = async () => {
 *     try {
 *       await riskyOperation();
 *     } catch (err) {
 *       handleError(err, "processing click");
 *     }
 *   };
 * }
 * ```
 */
export function useErrorHandler(
  context: string,
  options: UseErrorHandlerOptions = {}
): ErrorHandlerResult {
  const { showToast = true, formatMessage } = options;

  const handleError = useCallback(
    (error: unknown, action?: string) => {
      const message = getErrorMessage(error);
      const actionLabel = action ? ` [${action}]` : "";

      // Structured console logging with context
      logger.error(`[${context}]${actionLabel}:`, message, error);

      if (showToast) {
        const displayMessage = formatMessage
          ? formatMessage(message, action)
          : action
            ? `Failed ${action}: ${message}`
            : message;

        toast.error(displayMessage);
      }
    },
    [context, showToast, formatMessage]
  );

  const wrapAsync = useCallback(
    async <T>(
      fn: () => Promise<T>,
      action?: string
    ): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (error) {
        handleError(error, action);
        return undefined;
      }
    },
    [handleError]
  );

  return { handleError, wrapAsync };
}

export { getErrorMessage };
