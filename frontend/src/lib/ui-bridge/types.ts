/**
 * Shared UI Bridge types used across inspector, workflow builder, and page tree.
 */

/** A navigable link discovered from SDK element inspection. */
export interface DiscoveredLink {
  url: string;
  text: string;
}

/** Per-page metadata for the page tree (spec discovery status, loading state). */
export interface PageNodeStatus {
  hasSpecs: boolean;
  specGroupCount: number;
  isLoading: boolean;
  isActive: boolean;
}

/** A single SDK connection to an app. */
export interface SdkConnection {
  url: string;
  app: { appId?: string; appName?: string; version?: string };
  connectedAt: number;
  isActive: boolean;
}

/** A targetable tab or app (web tab, desktop app, etc.). */
export interface Target {
  id: string;
  type: "web" | "desktop" | "mobile";
  label: string;
  appName: string;
  pathname?: string;
  url?: string;
  isSelf?: boolean;
}
