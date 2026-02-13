/**
 * UI Bridge SDK Configuration
 *
 * Shared configuration for the UI Bridge SDK integration.
 * Used by the health endpoint and any other routes that need
 * to describe this application to external clients.
 */

export const uiBridgeConfig = {
  appId: "qontinui-web",
  appName: "Qontinui Web",
  appType: "web" as const,
  framework: "nextjs" as const,
  version: "0.1.0",
  capabilities: ["elements", "components", "snapshot", "ai"] as const,
};

export type UIBridgeAppConfig = typeof uiBridgeConfig;
