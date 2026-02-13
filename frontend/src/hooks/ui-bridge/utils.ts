/**
 * UI Bridge Exploration Utilities
 *
 * Shared utility functions for communication, config persistence,
 * and data conversion used across UI Bridge exploration sub-hooks.
 */

import type {
  UIBridgeExplorationConfig,
  ExplorationSession,
  ExplorationSessionResponse,
} from "./types";
import { DEFAULT_EXPLORATION_CONFIG } from "./types";

const STORAGE_KEY = "qontinui-exploration-config";

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if we're running on a cloud environment (not localhost)
 */
export function isCloudEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  return (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    !hostname.startsWith("192.168.")
  );
}

/**
 * Send a command to the runner through the Chrome extension.
 * This is used when running on cloud (qontinui.io) where direct HTTP to localhost isn't possible.
 */
export async function sendCommandViaExtension(
  action: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `ext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const handleResponse = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== "__QONTINUI_RUNNER_RESPONSE__")
        return;
      if (event.data.requestId !== requestId) return;

      window.removeEventListener("message", handleResponse);

      if (event.data.success) {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data.error || "Extension command failed"));
      }
    };

    window.addEventListener("message", handleResponse);

    // Set a timeout
    setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(
        new Error(
          "Extension command timed out. Make sure the Qontinui extension is installed and the runner is connected."
        )
      );
    }, 15000);

    // Send command to extension via postMessage
    window.postMessage(
      {
        type: "__QONTINUI_RUNNER_COMMAND__",
        requestId,
        action,
        params,
      },
      "*"
    );
  });
}

/**
 * Send a command to the runner - automatically chooses between direct HTTP or extension based on environment
 */
export async function sendRunnerCommand(
  runnerUrl: string | null,
  action: string,
  params: Record<string, unknown> = {},
  timeoutSecs: number = 10
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // For cloud environment or when runnerUrl is null, use extension
  if (isCloudEnvironment() || !runnerUrl) {
    try {
      const data = await sendCommandViaExtension(action, params);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // For local development, use direct HTTP
  try {
    const response = await fetch(`${runnerUrl}/extension/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        params,
        timeout_secs: timeoutSecs,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: error.error || "Request failed" };
    }

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Load config from localStorage
 */
export function loadPersistedConfig(): UIBridgeExplorationConfig {
  if (typeof window === "undefined") {
    return DEFAULT_EXPLORATION_CONFIG;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new fields
      return { ...DEFAULT_EXPLORATION_CONFIG, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_EXPLORATION_CONFIG;
}

/**
 * Save config to localStorage
 */
export function persistConfig(config: UIBridgeExplorationConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Convert API response to frontend model
 */
export function toExplorationSession(
  response: ExplorationSessionResponse
): ExplorationSession {
  return {
    id: response.id,
    projectId: response.project_id,
    name: response.name,
    status: response.status,
    targetType: response.target_type,
    targetUrl: response.target_url,
    explorationConfig: response.exploration_config,
    renderCount: response.render_count,
    elementsDiscovered: response.elements_discovered,
    elementsExplored: response.elements_explored,
    errorMessage: response.error_message,
    discoveryCompleted: response.discovery_completed,
    savedConfigId: response.saved_config_id,
    startedAt: response.started_at,
    completedAt: response.completed_at,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
  };
}

/**
 * Infer element type from tag name and selector
 */
export function inferElementType(tagName: string, selector: string): string {
  const tag = tagName?.toLowerCase() || "";
  const sel = selector?.toLowerCase() || "";

  if (tag === "button" || sel.includes("button")) return "button";
  if (tag === "a" || sel.includes("link")) return "link";
  if (tag === "input") return "input";
  if (sel.includes("tab")) return "tab";
  if (sel.includes("menu")) return "menuitem";
  return "element";
}

/**
 * Extract class name from CSS selector
 */
export function extractClassFromSelector(
  selector: string
): string | undefined {
  const match = selector.match(/\.([a-zA-Z0-9_-]+)/);
  return match ? match[1] : undefined;
}
