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
