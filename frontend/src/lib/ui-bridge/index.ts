/**
 * UI Bridge Integration
 *
 * This module integrates UI Bridge for DOM observation, control, and debugging.
 * Uses the SDK's CommandRelay for browser-server communication.
 */

export { UIBridgeWrapper } from "./provider";
export { RouteAwarenessProvider } from "./RouteAwarenessProvider";
export { RenderLogWrapper } from "./RenderLogWrapper";
export { relay, handlers } from "./relay";
export type { DiscoveredLink, PageNodeStatus } from "./types";
