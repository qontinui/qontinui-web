/**
 * Direct UI Bridge SDK service.
 *
 * Calls UI Bridge endpoints directly (without going through the runner).
 * This allows the inspector and other tools to work even when the runner
 * is offline, as long as the target app's UI Bridge is accessible.
 */

export interface UIBridgeConfig {
  /** Base URL of the UI Bridge endpoint (e.g., http://localhost:3001/api/ui-bridge) */
  baseUrl: string;
}

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
  const url = `${config.baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(
        `UI Bridge error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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

export const runnerFrontendBridge = createUIBridgeClient({
  baseUrl: "http://localhost:9876/ui-bridge",
});
