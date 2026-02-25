/**
 * tree-builder.ts
 *
 * Pure functions for building a hierarchical tree from a flat list of links.
 * Reusable across inspector, workflow builder, and page sweep.
 */

import type { DiscoveredLink, PageNodeStatus } from "@/lib/ui-bridge/types";

/** A node in the path-segment tree. */
export interface TreeNode {
  segment: string;
  fullPath: string;
  links: DiscoveredLink[];
  children: Map<string, TreeNode>;
  status?: PageNodeStatus;
}

/**
 * Build a path-segment tree from a flat link list.
 * Optionally overlays per-page status onto leaf nodes.
 */
export function buildTree(
  links: DiscoveredLink[],
  pageStatus?: Map<string, PageNodeStatus>
): TreeNode {
  const root: TreeNode = {
    segment: "/",
    fullPath: "/",
    links: [],
    children: new Map(),
  };

  for (const link of links) {
    const parts = link.url.split("/").filter((p) => p.length > 0);

    let current = root;
    let path = "";

    for (const part of parts) {
      path += "/" + part;
      if (!current.children.has(part)) {
        current.children.set(part, {
          segment: part,
          fullPath: path,
          links: [],
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }

    current.links.push(link);

    // Overlay page status if available
    if (pageStatus) {
      const status = pageStatus.get(link.url);
      if (status) {
        current.status = status;
      }
    }
  }

  return root;
}
