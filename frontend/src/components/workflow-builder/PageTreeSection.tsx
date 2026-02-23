"use client";

import { useState, useCallback } from "react";
import { Loader2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTreePanel } from "@/components/shared/PageTree";
import type { DiscoveredLink, PageNodeStatus } from "@/lib/ui-bridge/types";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";
import { discoverCurrentPageLinks } from "@/lib/ui-bridge/page-crawler";
import { parseDiscoveredSpecs } from "@/lib/ui-bridge/spec-parser";
import { unwrapSpecResponse } from "@/lib/ui-bridge/spec-parser";
import { runnerApi } from "@/lib/runner-api";

// =============================================================================
// Types
// =============================================================================

export interface PageTreeSectionProps {
  isConnected: boolean;
  appOrigin?: string;
  onSpecsDiscovered: (pageUrl: string, specs: DiscoveredSpec[]) => void;
}

// =============================================================================
// Component
// =============================================================================

export function PageTreeSection({
  isConnected,
  appOrigin,
  onSpecsDiscovered,
}: PageTreeSectionProps) {
  const [discoveredLinks, setDiscoveredLinks] = useState<DiscoveredLink[]>([]);
  const [pageStatus, setPageStatus] = useState<Map<string, PageNodeStatus>>(
    () => new Map()
  );
  const [isDiscoveringPages, setIsDiscoveringPages] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // Discover navigable links from the currently connected page
  const handleDiscoverPages = useCallback(async () => {
    if (!isConnected) return;
    setIsDiscoveringPages(true);
    try {
      const links = await discoverCurrentPageLinks(appOrigin);
      setDiscoveredLinks((prev) => {
        const existingUrls = new Set(prev.map((l) => l.url));
        const newLinks = links.filter((l) => !existingUrls.has(l.url));
        return newLinks.length > 0 ? [...prev, ...newLinks] : prev;
      });
    } catch {
      // Discovery failed silently — the user can retry
    } finally {
      setIsDiscoveringPages(false);
    }
  }, [isConnected, appOrigin]);

  // Navigate to a page, discover its specs, and report back
  const handlePageClick = useCallback(
    async (url: string, _link: DiscoveredLink) => {
      if (isBusy) return;
      setIsBusy(true);

      // Mark this page as loading
      setPageStatus((prev) => {
        const next = new Map(prev);
        // Clear isActive from all pages
        for (const [key, val] of next) {
          if (val.isActive) next.set(key, { ...val, isActive: false });
        }
        const existing = next.get(url);
        next.set(url, {
          hasSpecs: existing?.hasSpecs ?? false,
          specGroupCount: existing?.specGroupCount ?? 0,
          isLoading: true,
          isActive: true,
        });
        return next;
      });

      try {
        // Navigate to the page
        await runnerApi.uiBridgePageNavigate(url);

        // Wait for page to settle
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // Discover specs
        const raw = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
        const rawSpecs = unwrapSpecResponse(raw);
        const specs = parseDiscoveredSpecs(rawSpecs);

        // Update page status
        setPageStatus((prev) => {
          const next = new Map(prev);
          next.set(url, {
            hasSpecs: specs.length > 0,
            specGroupCount: specs.reduce(
              (sum, s) => sum + (s.config?.groups?.length ?? 0),
              0
            ),
            isLoading: false,
            isActive: true,
          });
          return next;
        });

        // Report specs to parent
        if (specs.length > 0) {
          onSpecsDiscovered(url, specs);
        }
      } catch {
        // Mark page as done (no specs found on error)
        setPageStatus((prev) => {
          const next = new Map(prev);
          next.set(url, {
            hasSpecs: false,
            specGroupCount: 0,
            isLoading: false,
            isActive: true,
          });
          return next;
        });
      } finally {
        setIsBusy(false);
      }
    },
    [isBusy, onSpecsDiscovered]
  );

  if (!isConnected) return null;

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs"
        onClick={handleDiscoverPages}
        disabled={isDiscoveringPages || isBusy}
      >
        {isDiscoveringPages ? (
          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
        ) : (
          <Network className="w-3.5 h-3.5 mr-1" />
        )}
        {isDiscoveringPages ? "Discovering Pages..." : "Discover Pages"}
      </Button>

      {discoveredLinks.length > 0 && (
        <PageTreePanel
          discoveredLinks={discoveredLinks}
          onPageClick={handlePageClick}
          isBusy={isBusy}
          pageStatus={pageStatus}
          showSpecStatus
          title={`Pages (${discoveredLinks.length})`}
          maxHeight="200px"
        />
      )}
    </div>
  );
}
