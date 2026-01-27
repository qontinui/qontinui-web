/**
 * UI Bridge Integration
 *
 * This module integrates UI Bridge for DOM observation, control, and debugging.
 * Replaces the legacy RenderLogContext with the unified ui-bridge framework.
 */

export { UIBridgeWrapper } from "./provider";
export { RenderLogWrapper } from "./RenderLogWrapper";
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
} from "./handlers";
export { useUIBridgeCommandHandler } from "./useUIBridgeCommandHandler";
