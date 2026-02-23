/**
 * UI Bridge Integration
 *
 * This module integrates UI Bridge for DOM observation, control, and debugging.
 * Replaces the legacy RenderLogContext with the unified ui-bridge framework.
 *
 * Transport Architecture:
 * - WebSocket is the primary transport (lower latency, no polling overhead)
 * - HTTP polling is the fallback when WebSocket is unavailable
 * - 'auto' mode (default) tries WebSocket first, falls back to HTTP
 */

export { UIBridgeWrapper } from "./provider";
export { RenderLogWrapper } from "./RenderLogWrapper";
export { UIBridgeTransportListener } from "./UIBridgeTransportListener";
export { uiBridgeHandlers } from "./handlers";
export {
  queueCommand,
  resolveCommand,
  rejectCommand,
  getPendingCommands,
  updateControlSnapshot,
  updateSemanticSnapshot,
  addRenderLogEntry,
  addRenderLogEntries,
  // WebSocket client registry
  registerWebSocketClient,
  unregisterWebSocketClient,
  updateClientActivity,
  getWebSocketClientCount,
  broadcastEvent,
} from "./handlers";
export type { WebSocketClient } from "./handlers";
export { useUIBridgeCommandHandler } from "./useUIBridgeCommandHandler";
export { useWebSocketCommandHandler } from "./useWebSocketCommandHandler";
export type { WebSocketConnectionState } from "./useWebSocketCommandHandler";
export {
  useUIBridgeTransport,
  type TransportMode,
  type ConnectionState,
  type UIBridgeTransportOptions,
  type UIBridgeTransportResult,
} from "./useUIBridgeTransport";
export type { DiscoveredLink, PageNodeStatus } from "./types";
