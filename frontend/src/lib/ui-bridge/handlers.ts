/**
 * UI Bridge Server Handlers
 *
 * Implements UIBridgeServerHandlers for Next.js API routes.
 * These handlers connect to the global UIBridgeRegistry on the client side.
 *
 * Architecture:
 * - Server-side handlers receive requests from external clients (runner, Python)
 * - For read-only operations, handlers return cached state
 * - For actions, commands are relayed to the browser via WebSocket
 * - Browser executes commands and sends responses back via REST API
 */

import type { UIBridgeServerHandlers, RenderLogQuery, APIResponse } from "ui-bridge-server";
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  DiscoveryRequest,
  DiscoveryResponse,
  FindRequest,
  FindResponse,
  WorkflowRunRequest,
  WorkflowRunResponse,
  ControlSnapshot,
} from "ui-bridge/control";
import type { RenderLogEntry } from "ui-bridge/render-log";
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
} from "ui-bridge/ai";

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

// ============================================================================
// In-Memory State Storage
// ============================================================================

// Render log entries (server-side cache)
let renderLogEntries: RenderLogEntry[] = [];
const MAX_ENTRIES = 1000;

// Latest control snapshot from browser (synchronized via WebSocket)
let latestControlSnapshot: ControlSnapshot = {
  timestamp: Date.now(),
  elements: [],
  components: [],
  workflows: [],
  activeRuns: [],
};

// Latest semantic snapshot from browser
let latestSemanticSnapshot: SemanticSnapshot | null = null;

// Pending command responses (command_id -> resolver)
const pendingCommands = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();

// Command timeout in milliseconds
const COMMAND_TIMEOUT_MS = 30000;

// ============================================================================
// Command Queue for Browser Relay
// ============================================================================

/**
 * Generate a unique command ID
 */
function generateCommandId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Queue a command to be executed in the browser.
 * Returns a promise that resolves when the browser sends back the response.
 */
export function queueCommand<T>(
  action: string,
  payload: unknown
): Promise<T> {
  const commandId = generateCommandId();

  return new Promise((resolve, reject) => {
    // Set timeout for command response
    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Command ${action} timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

    // Store the pending command
    pendingCommands.set(commandId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });

    // The command will be picked up by the browser via the command queue endpoint
    commandQueue.push({
      commandId,
      action,
      payload,
      timestamp: Date.now(),
    });

    // Limit queue size
    while (commandQueue.length > 100) {
      const dropped = commandQueue.shift();
      if (dropped) {
        const pending = pendingCommands.get(dropped.commandId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Command dropped from queue"));
          pendingCommands.delete(dropped.commandId);
        }
      }
    }
  });
}

/**
 * Resolve a pending command with a response from the browser
 */
export function resolveCommand(commandId: string, result: unknown): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.resolve(result);
  return true;
}

/**
 * Reject a pending command with an error
 */
export function rejectCommand(commandId: string, errorMessage: string): boolean {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  pending.reject(new Error(errorMessage));
  return true;
}

// Command queue for browser to poll
interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

const commandQueue: QueuedCommand[] = [];

/**
 * Get pending commands for the browser to execute
 */
export function getPendingCommands(): QueuedCommand[] {
  return commandQueue.splice(0, commandQueue.length);
}

// ============================================================================
// Snapshot Synchronization
// ============================================================================

/**
 * Update the control snapshot (called from browser via sync endpoint)
 */
export function updateControlSnapshot(snapshot: ControlSnapshot): void {
  latestControlSnapshot = snapshot;
}

/**
 * Update the semantic snapshot (called from browser via sync endpoint)
 */
export function updateSemanticSnapshot(snapshot: SemanticSnapshot): void {
  latestSemanticSnapshot = snapshot;
}

// ============================================================================
// Render Log Management
// ============================================================================

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

// ============================================================================
// UI Bridge Server Handlers Implementation
// ============================================================================

export const uiBridgeHandlers: UIBridgeServerHandlers = {
  // --------------------------------------------------------------------------
  // Render Log Endpoints
  // --------------------------------------------------------------------------

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
    try {
      const result = await queueCommand("captureSnapshot", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getRenderLogPath(): Promise<APIResponse<{ path: string }>> {
    return success({ path: "/api/ui-bridge/render-log" });
  },

  // --------------------------------------------------------------------------
  // Control - Elements
  // --------------------------------------------------------------------------

  async getElements(): Promise<APIResponse<ControlSnapshot["elements"]>> {
    return success(latestControlSnapshot.elements);
  },

  async getElement(id: string): Promise<APIResponse<ControlSnapshot["elements"][0]>> {
    const element = latestControlSnapshot.elements.find((e) => e.id === id);
    if (!element) {
      return error(`Element ${id} not found`, "NOT_FOUND");
    }
    return success(element);
  },

  async getElementState(id: string): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand("getElementState", { id });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async executeElementAction(
    id: string,
    request: ControlActionRequest
  ): Promise<APIResponse<ControlActionResponse>> {
    try {
      const result = await queueCommand<ControlActionResponse>("executeElementAction", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Control - Components
  // --------------------------------------------------------------------------

  async getComponents(): Promise<APIResponse<ControlSnapshot["components"]>> {
    return success(latestControlSnapshot.components);
  },

  async getComponent(id: string): Promise<APIResponse<ControlSnapshot["components"][0]>> {
    const component = latestControlSnapshot.components.find((c) => c.id === id);
    if (!component) {
      return error(`Component ${id} not found`, "NOT_FOUND");
    }
    return success(component);
  },

  async executeComponentAction(
    id: string,
    request: ComponentActionRequest
  ): Promise<APIResponse<ComponentActionResponse>> {
    try {
      const result = await queueCommand<ComponentActionResponse>("executeComponentAction", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Find / Discovery
  // --------------------------------------------------------------------------

  async find(request?: FindRequest): Promise<APIResponse<FindResponse>> {
    try {
      const result = await queueCommand<FindResponse>("find", request || {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async discover(request?: DiscoveryRequest): Promise<APIResponse<DiscoveryResponse>> {
    // Deprecated - use find
    try {
      const result = await queueCommand<DiscoveryResponse>("discover", request || {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getControlSnapshot(): Promise<APIResponse<ControlSnapshot>> {
    // Request fresh snapshot from browser
    try {
      const result = await queueCommand<ControlSnapshot>("getControlSnapshot", {});
      updateControlSnapshot(result);
      return success(result);
    } catch (e) {
      // Fall back to cached snapshot
      return success(latestControlSnapshot);
    }
  },

  // --------------------------------------------------------------------------
  // Workflows
  // --------------------------------------------------------------------------

  async getWorkflows(): Promise<APIResponse<ControlSnapshot["workflows"]>> {
    return success(latestControlSnapshot.workflows);
  },

  async runWorkflow(
    id: string,
    request?: WorkflowRunRequest
  ): Promise<APIResponse<WorkflowRunResponse>> {
    try {
      const result = await queueCommand<WorkflowRunResponse>("runWorkflow", {
        id,
        request,
      });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getWorkflowStatus(runId: string): Promise<APIResponse<WorkflowRunResponse>> {
    try {
      const result = await queueCommand<WorkflowRunResponse>("getWorkflowStatus", { runId });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // Debug
  // --------------------------------------------------------------------------

  async getActionHistory(_limit?: number): Promise<APIResponse<unknown[]>> {
    try {
      const result = await queueCommand<unknown[]>("getActionHistory", { limit: _limit });
      return success(result);
    } catch (e) {
      return success([]); // Fall back to empty
    }
  },

  async getMetrics(): Promise<APIResponse<unknown>> {
    return success({
      timestamp: Date.now(),
      uptime: process.uptime() * 1000,
      memory: process.memoryUsage(),
      pendingCommands: pendingCommands.size,
      commandQueueLength: commandQueue.length,
    });
  },

  async highlightElement(id: string): Promise<APIResponse<void>> {
    try {
      await queueCommand("highlightElement", { id });
      return success(undefined);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getElementTree(): Promise<APIResponse<unknown>> {
    try {
      const result = await queueCommand("getElementTree", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  // --------------------------------------------------------------------------
  // AI-Native Endpoints
  // --------------------------------------------------------------------------

  async aiSearch(criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> {
    try {
      const result = await queueCommand<SearchResponse>("aiSearch", criteria);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiExecute(request: NLActionRequest): Promise<APIResponse<NLActionResponse>> {
    try {
      const result = await queueCommand<NLActionResponse>("aiExecute", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiAssert(request: AssertionRequest): Promise<APIResponse<AssertionResult>> {
    try {
      const result = await queueCommand<AssertionResult>("aiAssert", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async aiAssertBatch(
    request: BatchAssertionRequest
  ): Promise<APIResponse<BatchAssertionResult>> {
    try {
      const result = await queueCommand<BatchAssertionResult>("aiAssertBatch", request);
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getSemanticSnapshot(): Promise<APIResponse<SemanticSnapshot>> {
    try {
      const result = await queueCommand<SemanticSnapshot>("getSemanticSnapshot", {});
      updateSemanticSnapshot(result);
      return success(result);
    } catch (e) {
      // Fall back to cached snapshot
      if (latestSemanticSnapshot) {
        return success(latestSemanticSnapshot);
      }
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getSemanticDiff(since?: number): Promise<APIResponse<SemanticDiff | null>> {
    try {
      const result = await queueCommand<SemanticDiff | null>("getSemanticDiff", { since });
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },

  async getPageSummary(): Promise<APIResponse<string>> {
    try {
      const result = await queueCommand<string>("getPageSummary", {});
      return success(result);
    } catch (e) {
      return error((e as Error).message, "COMMAND_FAILED");
    }
  },
};
