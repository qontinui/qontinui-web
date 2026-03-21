/**
 * Service Worker Registration and Management
 *
 * Handles registration, updates, and communication with the service worker.
 */

import { syncProcessor } from "./sync-processor";
import { createLogger } from "@/lib/logger";

const log = createLogger("ServiceWorker");

/**
 * Service worker registration status
 */
export type ServiceWorkerStatus =
  | "unsupported" // Browser doesn't support service workers
  | "registering" // Registration in progress
  | "registered" // Successfully registered
  | "updated" // New version available
  | "error"; // Registration failed

/**
 * Service worker manager
 */
class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private status: ServiceWorkerStatus = "unsupported";
  private statusListeners: Set<(status: ServiceWorkerStatus) => void> =
    new Set();

  /**
   * Register service worker
   */
  async register(): Promise<ServiceWorkerRegistration | null> {
    // Check if service workers are supported
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      console.warn("[ServiceWorker] Not supported in this browser");
      this.setStatus("unsupported");
      return null;
    }

    try {
      this.setStatus("registering");

      // Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      this.registration = registration;
      this.setStatus("registered");

      log.debug("Registered successfully");

      // Setup update detection
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;

        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New service worker installed, update available
              log.debug("Update available");
              this.setStatus("updated");
            }
          });
        }
      });

      // Setup background sync message handler
      navigator.serviceWorker.addEventListener("message", (event) => {
        this.handleMessage(event);
      });

      // Register for background sync
      if ("sync" in registration) {
        log.debug("Background Sync API supported");
      } else {
        console.warn(
          "[ServiceWorker] Background Sync API not supported, using polling"
        );
      }

      return registration;
    } catch (error) {
      console.error("[ServiceWorker] Registration failed:", error);
      this.setStatus("error");
      return null;
    }
  }

  /**
   * Unregister service worker
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      const success = await this.registration.unregister();
      if (success) {
        log.debug("Unregistered successfully");
        this.registration = null;
      }
      return success;
    } catch (error) {
      console.error("[ServiceWorker] Unregister failed:", error);
      return false;
    }
  }

  /**
   * Request background sync
   *
   * Triggers the service worker to process the sync queue.
   * Falls back to immediate processing if background sync is not supported.
   */
  async requestBackgroundSync(tag = "sync-screenshots"): Promise<void> {
    if (!this.registration) {
      console.warn(
        "[ServiceWorker] Not registered, processing sync immediately"
      );
      await syncProcessor.processQueue();
      return;
    }

    // Try to use Background Sync API
    if ("sync" in this.registration) {
      try {
        await (
          this.registration.sync as { register: (tag: string) => Promise<void> }
        ).register(tag);
        log.debug(`Background sync registered: ${tag}`);
      } catch (error) {
        console.error("[ServiceWorker] Background sync failed:", error);
        // Fallback to immediate processing
        await syncProcessor.processQueue();
      }
    } else {
      // Fallback to immediate processing
      log.debug("Background sync not supported, processing immediately");
      await syncProcessor.processQueue();
    }
  }

  /**
   * Update service worker to new version
   */
  async update(): Promise<void> {
    if (!this.registration) {
      return;
    }

    try {
      await this.registration.update();
      log.debug("Update check completed");
    } catch (error) {
      console.error("[ServiceWorker] Update check failed:", error);
    }
  }

  /**
   * Skip waiting and activate new service worker
   */
  async skipWaiting(): Promise<void> {
    if (!this.registration || !this.registration.waiting) {
      return;
    }

    // Send skip waiting message
    this.registration.waiting.postMessage({ type: "SKIP_WAITING" });

    // Reload page after activation
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }

  /**
   * Handle messages from service worker
   */
  private handleMessage(event: MessageEvent): void {
    const { data, ports } = event;

    if (data.type === "BACKGROUND_SYNC") {
      // Service worker requesting sync
      syncProcessor
        .processQueue()
        .then(() => {
          // Send success response
          if (ports[0]) {
            ports[0].postMessage({ success: true });
          }
        })
        .catch((error) => {
          // Send error response
          if (ports[0]) {
            ports[0].postMessage({
              success: false,
              error: error.message,
            });
          }
        });
    }
  }

  /**
   * Get current status
   */
  getStatus(): ServiceWorkerStatus {
    return this.status;
  }

  /**
   * Set status and notify listeners
   */
  private setStatus(status: ServiceWorkerStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error("[ServiceWorker] Error in status listener:", error);
      }
    }
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: ServiceWorkerStatus) => void): () => void {
    this.statusListeners.add(listener);

    // Call immediately with current status
    listener(this.status);

    // Return unsubscribe function
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Get registration
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }

  /**
   * Check if service worker is supported
   */
  isSupported(): boolean {
    return typeof window !== "undefined" && "serviceWorker" in navigator;
  }

  /**
   * Check if background sync is supported
   */
  isBackgroundSyncSupported(): boolean {
    return this.registration ? "sync" in this.registration : false;
  }
}

// Export singleton instance
export const serviceWorkerManager = new ServiceWorkerManager();

/**
 * Initialize service worker on page load
 */
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    serviceWorkerManager.register();
  });
}
