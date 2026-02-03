"use client";

/**
 * Database Error Handler Component
 *
 * Listens for IndexedDB error events and displays appropriate toast notifications.
 * Provides user-friendly messages for storage corruption and quota issues.
 *
 * Also catches global unhandled promise rejections related to IndexedDB errors
 * to provide user-friendly guidance.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface StorageCorruptedDetail {
  database: string;
  message: string;
}

interface StorageRecoveredDetail {
  database: string;
  message: string;
}

interface StorageRecoveryFailedDetail {
  database: string;
  message: string;
}

interface QuotaExceededDetail {
  database: string;
  suggestions: string[];
}

/**
 * Check if an error message indicates IndexedDB storage corruption
 */
function isStorageCorruptionError(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("internal error") ||
    lowerMessage.includes("backing store") ||
    lowerMessage.includes("indexeddb") ||
    lowerMessage.includes("corrupted") ||
    lowerMessage.includes("leveldb")
  );
}

export function DBErrorHandler() {
  // Track whether we've already shown the corruption message to avoid spamming
  const hasShownCorruptionMessage = useRef(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Handler for storage corruption detection from our custom events
    const handleStorageCorrupted = (
      event: CustomEvent<StorageCorruptedDetail>
    ) => {
      if (!hasShownCorruptionMessage.current) {
        hasShownCorruptionMessage.current = true;
        setShowBanner(true);
        toast.warning("Storage Issue Detected", {
          description: event.detail.message,
          duration: 10000,
        });
      }
    };

    // Handler for successful recovery
    const handleStorageRecovered = (
      event: CustomEvent<StorageRecoveredDetail>
    ) => {
      hasShownCorruptionMessage.current = false;
      setShowBanner(false);
      toast.success("Storage Recovered", {
        description: event.detail.message,
        duration: 8000,
        action: {
          label: "Refresh",
          onClick: () => window.location.reload(),
        },
      });
    };

    // Handler for failed recovery
    const handleRecoveryFailed = (
      event: CustomEvent<StorageRecoveryFailedDetail>
    ) => {
      setShowBanner(true);
      toast.error("Storage Recovery Failed", {
        description: event.detail.message,
        duration: 15000,
        action: {
          label: "Learn More",
          onClick: () => {
            toast.info("Instructions", {
              description:
                "Press F12 to open DevTools, go to Application tab, then Storage section, and click 'Clear site data'.",
              duration: 30000,
            });
          },
        },
      });
    };

    // Handler for quota exceeded
    const handleQuotaExceeded = (event: CustomEvent<QuotaExceededDetail>) => {
      toast.error("Storage Quota Exceeded", {
        description: `Database '${event.detail.database}' has run out of storage space.`,
        duration: 15000,
        action: {
          label: "Learn More",
          onClick: () => {
            toast.info("Suggestions", {
              description: event.detail.suggestions.join("\n"),
              duration: 20000,
            });
          },
        },
      });
    };

    // Global handler for unhandled promise rejections (catches IndexedDB errors)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "";

      if (
        isStorageCorruptionError(message) &&
        !hasShownCorruptionMessage.current
      ) {
        hasShownCorruptionMessage.current = true;
        setShowBanner(true);

        // Prevent the default error handling (console error)
        event.preventDefault();

        toast.error("Browser Storage Corrupted", {
          description:
            "Your browser's local storage is corrupted. This may have been caused by running out of disk space.",
          duration: 15000,
          action: {
            label: "Fix Now",
            onClick: () => {
              toast.info("How to Fix", {
                description:
                  "1. Press F12 to open DevTools\n2. Go to Application tab\n3. Click 'Storage' in left sidebar\n4. Click 'Clear site data'\n5. Refresh the page",
                duration: 60000,
              });
            },
          },
        });
      }
    };

    // Add event listeners
    window.addEventListener(
      "db-storage-corrupted",
      handleStorageCorrupted as EventListener
    );
    window.addEventListener(
      "db-storage-recovered",
      handleStorageRecovered as EventListener
    );
    window.addEventListener(
      "db-storage-recovery-failed",
      handleRecoveryFailed as EventListener
    );
    window.addEventListener(
      "db-quota-exceeded",
      handleQuotaExceeded as EventListener
    );
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    // Cleanup
    return () => {
      window.removeEventListener(
        "db-storage-corrupted",
        handleStorageCorrupted as EventListener
      );
      window.removeEventListener(
        "db-storage-recovered",
        handleStorageRecovered as EventListener
      );
      window.removeEventListener(
        "db-storage-recovery-failed",
        handleRecoveryFailed as EventListener
      );
      window.removeEventListener(
        "db-quota-exceeded",
        handleQuotaExceeded as EventListener
      );
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
    };
  }, []);

  // Show a persistent banner if storage is corrupted
  if (showBanner) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Browser Storage Error:</span>
          <span>
            Local storage is corrupted. Clear site data to fix (F12 →
            Application → Storage → Clear site data).
          </span>
        </div>
        <button
          onClick={() => setShowBanner(false)}
          className="ml-4 px-2 py-1 bg-destructive-foreground/20 rounded hover:bg-destructive-foreground/30 transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
