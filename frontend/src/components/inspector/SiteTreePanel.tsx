"use client";

import type { DiscoveredLink } from "@/lib/ui-bridge/types";
import { PageTreePanel } from "@/components/shared/PageTree";

interface SiteTreePanelProps {
  discoveredLinks: DiscoveredLink[];
  onNavigate?: (url: string) => void;
  isNavigating?: boolean;
}

export function SiteTreePanel({
  discoveredLinks,
  onNavigate,
  isNavigating,
}: SiteTreePanelProps) {
  if (discoveredLinks.length === 0) return null;

  return (
    <div className="sticky top-16">
      <PageTreePanel
        discoveredLinks={discoveredLinks}
        onPageClick={onNavigate ? (url) => onNavigate(url) : undefined}
        isBusy={isNavigating}
      />
    </div>
  );
}
