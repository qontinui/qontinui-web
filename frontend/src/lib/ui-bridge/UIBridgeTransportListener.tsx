"use client";

/**
 * UI Bridge Transport Listener Component
 *
 * This component provides the transport layer for UI Bridge commands.
 * It uses WebSocket as the primary transport with HTTP polling as fallback.
 *
 * Mount this component in your app to enable remote UI automation.
 */

import { useUIBridgeTransport, TransportMode } from "./useUIBridgeTransport";

interface UIBridgeTransportListenerProps {
  /**
   * Whether to enable transport.
   * Defaults to true in development, false in production.
   */
  enabled?: boolean;

  /**
   * Transport mode: 'websocket', 'http', or 'auto' (default)
   */
  mode?: TransportMode;

  /**
   * WebSocket URL (optional, defaults to current host)
   */
  wsUrl?: string;

  /**
   * Enable verbose logging
   */
  verbose?: boolean;
}

/**
 * Component that provides transport for UI Bridge commands.
 *
 * This enables external clients (like qontinui-runner) to:
 * - Query page elements
 * - Execute actions (click, type, etc.)
 * - Run AI-based element search
 * - Make assertions about UI state
 *
 * Transport priority:
 * 1. WebSocket - Instant delivery, lower latency
 * 2. HTTP Polling - Fallback when WebSocket unavailable
 */
export function UIBridgeTransportListener({
  enabled = process.env.NODE_ENV === "development",
  mode = "auto",
  wsUrl,
  verbose = false,
}: UIBridgeTransportListenerProps) {
  // Use the transport hook (handles all connection management)
  useUIBridgeTransport(enabled, {
    mode,
    wsUrl,
    verbose,
  });

  // This component doesn't render anything
  return null;
}
