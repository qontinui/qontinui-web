"use client";

/**
 * UI Bridge Provider Wrapper
 *
 * Configures UIBridgeProvider with appropriate features based on environment.
 * Includes AutoRegisterProvider for automatic element registration.
 * Supports both WebSocket and HTTP polling for remote automation.
 *
 * Transport modes:
 * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
 * - 'websocket': Use WebSocket only
 * - 'http': Use HTTP polling only
 */

import React from "react";
import { UIBridgeProvider, AutoRegisterProvider } from "ui-bridge/react";
import type { UIBridgeFeatures, UIBridgeConfig } from "ui-bridge/core";
import { UIBridgeTransportListener } from "./UIBridgeTransportListener";
import type { TransportMode } from "./useUIBridgeTransport";

/**
 * Feature configuration for UI Bridge
 * Render logging is always enabled for state discovery.
 */
const features: UIBridgeFeatures = {
  renderLog: true,
  control: true,
  debug: process.env.NODE_ENV === "development",
};

/**
 * Configuration for UI Bridge
 */
const config: UIBridgeConfig = {
  verbose: process.env.NODE_ENV === "development",
  maxLogEntries: 1000,
};

interface UIBridgeWrapperProps {
  children: React.ReactNode;
  /**
   * Enable remote command listening for automation.
   * Defaults to true in development.
   */
  enableRemoteCommands?: boolean;
  /**
   * Transport mode for remote commands.
   * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
   * - 'websocket': Use WebSocket only
   * - 'http': Use HTTP polling only
   */
  transport?: TransportMode;
  /**
   * WebSocket URL for remote commands.
   * Defaults to current host with /api/ui-bridge/ws path.
   */
  wsUrl?: string;
}

/**
 * UI Bridge Provider wrapper component.
 *
 * This wraps the application with UIBridgeProvider for state discovery.
 * Render logging is always enabled.
 *
 * Features:
 * - Automatic element registration via AutoRegisterProvider
 * - Remote command listening via WebSocket (primary) or HTTP polling (fallback)
 * - SWC plugin integration for compile-time instrumentation
 */
export function UIBridgeWrapper({
  children,
  enableRemoteCommands = process.env.NODE_ENV === "development",
  transport = "auto",
  wsUrl,
}: UIBridgeWrapperProps) {
  return (
    <UIBridgeProvider features={features} config={config}>
      {/* AutoRegisterProvider enables automatic element registration for UI Bridge */}
      {/* All interactive elements (buttons, inputs, links, etc.) are auto-discovered */}
      <AutoRegisterProvider
        enabled={true}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={["[data-no-register]"]}
      >
        {/* Transport listener for remote automation (WebSocket primary, HTTP fallback) */}
        <UIBridgeTransportListener
          enabled={enableRemoteCommands}
          mode={transport}
          wsUrl={wsUrl}
        />
        {children as Parameters<typeof AutoRegisterProvider>[0]["children"]}
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
