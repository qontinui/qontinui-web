/**
 * UI Bridge Server Handlers
 *
 * Implements UIBridgeServerHandlers for Next.js API routes.
 * These handlers connect to the global UIBridgeRegistry on the client side.
 *
 * Note: Since the registry lives on the client, these handlers need to be
 * called from the client side via the UI Bridge API routes.
 */

import type { UIBridgeServerHandlers, RenderLogQuery, APIResponse } from "ui-bridge-server";
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  DiscoveryRequest,
  DiscoveryResponse,
  WorkflowRunRequest,
  WorkflowRunResponse,
  ControlSnapshot,
} from "ui-bridge/control";
import type { RenderLogEntry } from "ui-bridge/render-log";

/**
 * Create a success response wrapper
 */
function success<T>(data: T): APIResponse<T> {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create an error response wrapper
 */
function error(message: string, code?: string): APIResponse<never> {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now(),
  };
}

/**
 * Server-side handler implementations.
 *
 * Since UI Bridge state lives in the browser (client-side), these handlers
 * serve as a bridge between external clients (like the qontinui-runner or
 * Python clients) and the browser-based UIBridgeRegistry.
 *
 * The pattern is:
 * 1. External client calls API route
 * 2. API route returns instructions or state
 * 3. For actions, the client must relay to the browser via SSE/WebSocket
 *
 * For now, we implement in-memory state that can be synchronized.
 */

// In-memory render log storage (server-side cache)
let renderLogEntries: RenderLogEntry[] = [];
const MAX_ENTRIES = 1000;

/**
 * UI Bridge server handlers implementation
 */
export const uiBridgeHandlers: UIBridgeServerHandlers = {
  // Render log endpoints
  async getRenderLog(query?: RenderLogQuery): Promise<APIResponse<RenderLogEntry[]>> {
    let results = [...renderLogEntries];

    if (query?.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query?.since) {
      results = results.filter((e) => e.timestamp >= query.since!);
    }
    if (query?.until) {
      results = results.filter((e) => e.timestamp <= query.until!);
    }
    if (query?.limit) {
      results = results.slice(-query.limit);
    }

    return success(results);
  },

  async clearRenderLog(): Promise<APIResponse<void>> {
    renderLogEntries = [];
    return success(undefined);
  },

  async captureSnapshot(): Promise<APIResponse<unknown>> {
    // This needs to be triggered on the client side
    // Return a placeholder that indicates client should capture
    return success({
      message: "Snapshot capture should be triggered on client",
      timestamp: Date.now(),
    });
  },

  async getRenderLogPath(): Promise<APIResponse<{ path: string }>> {
    return success({ path: "/api/ui-bridge/render-log" });
  },

  // Control - Elements
  async getElements(): Promise<APIResponse<ControlSnapshot["elements"]>> {
    // Return empty array - actual elements are on client
    // External clients should use the control snapshot endpoint
    return success([]);
  },

  async getElement(id: string): Promise<APIResponse<ControlSnapshot["elements"][0]>> {
    return error(`Element ${id} not found on server - elements live on client`, "NOT_FOUND");
  },

  async getElementState(id: string): Promise<APIResponse<unknown>> {
    return error(`Element ${id} state not available on server`, "NOT_FOUND");
  },

  async executeElementAction(
    id: string,
    request: ControlActionRequest
  ): Promise<APIResponse<ControlActionResponse>> {
    // Action execution happens on client
    // This endpoint receives the result or relays to client
    return error(
      "Element actions must be executed on client - use WebSocket or SSE",
      "CLIENT_REQUIRED"
    );
  },

  // Control - Components
  async getComponents(): Promise<APIResponse<ControlSnapshot["components"]>> {
    return success([]);
  },

  async getComponent(id: string): Promise<APIResponse<ControlSnapshot["components"][0]>> {
    return error(`Component ${id} not found on server`, "NOT_FOUND");
  },

  async executeComponentAction(
    id: string,
    request: ComponentActionRequest
  ): Promise<APIResponse<ComponentActionResponse>> {
    return error(
      "Component actions must be executed on client - use WebSocket or SSE",
      "CLIENT_REQUIRED"
    );
  },

  // Discovery endpoints
  async discover(request?: DiscoveryRequest): Promise<APIResponse<DiscoveryResponse>> {
    // Discovery requires DOM access, must happen on client
    return success({
      elements: [],
      total: 0,
      durationMs: 0,
      timestamp: Date.now(),
    });
  },

  async getControlSnapshot(): Promise<APIResponse<ControlSnapshot>> {
    // Return empty snapshot - actual state is on client
    return success({
      timestamp: Date.now(),
      elements: [],
      components: [],
      workflows: [],
      activeRuns: [],
    });
  },

  // Workflow endpoints
  async getWorkflows(): Promise<APIResponse<ControlSnapshot["workflows"]>> {
    return success([]);
  },

  async runWorkflow(
    id: string,
    request?: WorkflowRunRequest
  ): Promise<APIResponse<WorkflowRunResponse>> {
    return error("Workflow execution must happen on client", "CLIENT_REQUIRED");
  },

  async getWorkflowStatus(runId: string): Promise<APIResponse<WorkflowRunResponse>> {
    return error(`Workflow run ${runId} not found`, "NOT_FOUND");
  },

  // Debug endpoints
  async getActionHistory(limit?: number): Promise<APIResponse<unknown[]>> {
    return success([]);
  },

  async getMetrics(): Promise<APIResponse<unknown>> {
    return success({
      timestamp: Date.now(),
      uptime: process.uptime() * 1000,
      memory: process.memoryUsage(),
    });
  },

  async highlightElement(id: string): Promise<APIResponse<void>> {
    return error("Element highlighting must happen on client", "CLIENT_REQUIRED");
  },

  async getElementTree(): Promise<APIResponse<unknown>> {
    return success({
      message: "Element tree must be captured on client",
      timestamp: Date.now(),
    });
  },
};

/**
 * Add a render log entry (called from client via API)
 */
export function addRenderLogEntry(entry: RenderLogEntry): void {
  renderLogEntries.push(entry);
  while (renderLogEntries.length > MAX_ENTRIES) {
    renderLogEntries.shift();
  }
}

/**
 * Bulk add render log entries
 */
export function addRenderLogEntries(entries: RenderLogEntry[]): void {
  for (const entry of entries) {
    addRenderLogEntry(entry);
  }
}
