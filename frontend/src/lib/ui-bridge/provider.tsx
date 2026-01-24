"use client";

/**
 * UI Bridge Provider Wrapper
 *
 * Configures UIBridgeProvider with appropriate features based on environment.
 * Includes AutoRegisterProvider for automatic element registration.
 */

import React from "react";
import { UIBridgeProvider, AutoRegisterProvider } from "ui-bridge/react";
import type { UIBridgeFeatures, UIBridgeConfig } from "ui-bridge/core";

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
}

/**
 * UI Bridge Provider wrapper component.
 *
 * This wraps the application with UIBridgeProvider for state discovery.
 * Render logging is always enabled.
 */
export function UIBridgeWrapper({ children }: UIBridgeWrapperProps) {
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
        {children as Parameters<typeof AutoRegisterProvider>[0]["children"]}
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
