/**
 * Direct UI Bridge SDK service.
 *
 * Calls UI Bridge endpoints directly (without going through the runner).
 * This allows the inspector and other tools to work even when the runner
 * is offline, as long as the target app's UI Bridge is accessible.
 *
 * The runner's own UI Bridge is the exception: it is addressed by runner
 * TARGET, through the per-request transport resolver (loopback for a runner
 * proven local, the backend relay otherwise), never by a base URL.
 */

import { runnerRequest } from "@/lib/runner/api-client";
import type { RunnerTarget } from "@/lib/runner/target";

export type UIBridgeConfig =
  | {
      /** Base URL of the UI Bridge endpoint (e.g., http://localhost:3001/api/ui-bridge) */
      baseUrl: string;
    }
  | {
      /** A runner's UI Bridge, reached through the transport resolver. */
      runnerTarget: RunnerTarget;
      /** Path prefix of the UI Bridge on the runner (e.g. `/ui-bridge`). */
      pathPrefix: string;
    };

export interface UIBridgeElement {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  className?: string;
  attributes?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  children?: UIBridgeElement[];
}

export interface UIBridgeSnapshot {
  url: string;
  title: string;
  elements: UIBridgeElement[];
  timestamp: string;
}

export interface UIBridgeActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

const DEFAULT_TIMEOUT = 10000;

async function fetchBridge<T>(
  config: UIBridgeConfig,
  path: string,
  options?: RequestInit
): Promise<T> {
  const init: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  };
  // The runner's bridge takes the budget as `timeoutMs` — the one deadline
  // concept, which over the relay is also sent to the backend as its wait. A
  // direct fetch has no relay, so an abort signal is its deadline.
  const response =
    "runnerTarget" in config
      ? await runnerRequest(
          config.runnerTarget,
          `${config.pathPrefix}${path}`,
          {
            ...init,
            timeoutMs: DEFAULT_TIMEOUT,
          }
        )
      : await fetch(`${config.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        });

  if (!response.ok) {
    throw new Error(
      `UI Bridge error: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

/**
 * Create a UI Bridge client for a specific target app.
 */
export function createUIBridgeClient(config: UIBridgeConfig) {
  return {
    /**
     * Get a snapshot of the current page state including all elements.
     */
    getSnapshot: () =>
      fetchBridge<UIBridgeSnapshot>(config, "/control/snapshot"),

    /**
     * Execute an action on a specific element.
     */
    executeAction: (
      elementId: string,
      action: string,
      params?: Record<string, unknown>
    ) =>
      fetchBridge<UIBridgeActionResult>(config, "/control/action", {
        method: "POST",
        body: JSON.stringify({ elementId, action, ...params }),
      }),

    /**
     * Take a screenshot of the current page.
     */
    captureScreenshot: () =>
      fetchBridge<{ screenshot: string }>(config, "/control/screenshot"),

    /**
     * Check if the UI Bridge is available.
     */
    ping: async (): Promise<boolean> => {
      try {
        await fetchBridge(config, "/control/snapshot");
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Pre-configured clients for known apps.
 */
export const webFrontendBridge = createUIBridgeClient({
  baseUrl: "http://localhost:3001/api/ui-bridge",
});

/** The UI Bridge of a runner's own frontend, for the given runner target. */
export function createRunnerFrontendBridge(target: RunnerTarget) {
  return createUIBridgeClient({
    runnerTarget: target,
    pathPrefix: "/ui-bridge",
  });
}
