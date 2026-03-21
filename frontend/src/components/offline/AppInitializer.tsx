/**
 * App Initializer Component
 *
 * Handles offline-first initialization tasks:
 * - Cleanup expired screenshots from IndexedDB
 * - Cleanup completed sync items
 * - Process pending items from previous session
 * - Schedule periodic cleanup
 */

"use client";

import { useEffect } from "react";
import { syncQueue } from "@/lib/sync-queue";
import { screenshotDB } from "@/lib/screenshot-db";
import { syncProcessor } from "@/lib/sync-processor";
import { createLogger } from "@/lib/logger";

const log = createLogger("AppInitializer");

export function AppInitializer({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Run cleanup on app start
    const initializeApp = async () => {
      try {
        log.debug("Starting offline-first initialization...");

        // 1. Cleanup expired screenshots from IndexedDB
        const deletedScreenshots = await screenshotDB.cleanupExpired();
        log.debug(`Cleaned up ${deletedScreenshots} expired screenshots`);

        // 2. Cleanup old completed sync items
        const deletedSyncItems = await syncQueue.clearCompleted();
        log.debug(`Cleaned up ${deletedSyncItems} completed sync items`);

        // 3. Process any pending items from last session (only if online)
        if (navigator.onLine) {
          const processed = await syncProcessor.processQueue();
          log.debug(
            `Processed ${processed} pending items from previous session`
          );
        } else {
          log.debug(
            "Offline - will process pending items when connection is restored"
          );
        }

        log.debug("Initialization complete");
      } catch (error) {
        console.error("[AppInitializer] Initialization error:", error);
      }
    };

    // Run initialization
    initializeApp();

    // Schedule daily cleanup (every 24 hours)
    const cleanupInterval = setInterval(async () => {
      try {
        log.debug("Running scheduled cleanup...");
        await screenshotDB.cleanupExpired();
        await syncQueue.clearCompleted();
        log.debug("Scheduled cleanup complete");
      } catch (error) {
        console.error("[AppInitializer] Cleanup error:", error);
      }
    }, 86400000); // 24 hours in milliseconds

    // Cleanup interval on unmount
    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  return <>{children}</>;
}
