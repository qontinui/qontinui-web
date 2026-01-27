"use client";

/**
 * UI Bridge Command Listener Component
 *
 * This component listens for commands from external clients (like the runner)
 * and executes them in the browser context.
 *
 * Mount this component in your app to enable remote UI automation.
 */

import { useUIBridgeCommandHandler } from "./useUIBridgeCommandHandler";

interface UIBridgeCommandListenerProps {
  /**
   * Whether to enable command listening.
   * Defaults to true in development, false in production.
   */
  enabled?: boolean;
}

/**
 * Component that listens for and executes UI Bridge commands.
 *
 * This enables external clients (like qontinui-runner) to:
 * - Query page elements
 * - Execute actions (click, type, etc.)
 * - Run AI-based element search
 * - Make assertions about UI state
 */
export function UIBridgeCommandListener({
  enabled = process.env.NODE_ENV === "development",
}: UIBridgeCommandListenerProps) {
  useUIBridgeCommandHandler(enabled);

  // This component doesn't render anything
  return null;
}
