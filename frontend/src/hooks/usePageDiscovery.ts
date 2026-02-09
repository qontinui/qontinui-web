"use client";

import { useState, useCallback, useRef } from "react";
import { useExtensionCommand } from "@/lib/runner-api";

export interface DiscoveredPage {
  url: string;
  title: string;
  enabled: boolean;
}

interface ExtensionElement {
  tagName?: string;
  type?: string;
  text?: string;
  href?: string;
  attributes?: Record<string, string>;
}

interface UsePageDiscoveryReturn {
  pages: DiscoveredPage[];
  setPages: React.Dispatch<React.SetStateAction<DiscoveredPage[]>>;
  isDiscovering: boolean;
  hasDiscovered: boolean;
  error: string | null;
  discover: (targetUrl: string) => Promise<void>;
  addPage: (url: string, title?: string) => void;
  togglePage: (url: string) => void;
  toggleAll: (enabled: boolean) => void;
}

export function usePageDiscovery(): UsePageDiscoveryReturn {
  const [pages, setPages] = useState<DiscoveredPage[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [hasDiscovered, setHasDiscovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extensionCommand = useExtensionCommand();

  // Keep a stable ref to mutate to avoid stale closures
  const mutateRef = useRef(extensionCommand.mutate);
  mutateRef.current = extensionCommand.mutate;

  const discover = useCallback(async (targetUrl: string) => {
    setIsDiscovering(true);
    setError(null);
    setHasDiscovered(false);

    try {
      const result = await mutateRef.current({
        action: "getElements",
        params: { includeNonInteractive: false },
      });

      // The runner /extension/command returns { success, data, error }
      // where data contains the actual extension response
      const response = result as {
        success?: boolean;
        data?: { elements?: ExtensionElement[] };
        elements?: ExtensionElement[];
        error?: string;
      };

      if (response.success === false || response.error) {
        setError(response.error || "Extension command failed");
        setHasDiscovered(true);
        return;
      }

      // Elements may be at response.data.elements or response.elements
      const elements = response.data?.elements ?? response.elements;

      if (!elements || !Array.isArray(elements)) {
        setError(
          `No elements returned from extension. Response keys: ${Object.keys(response).join(", ")}`
        );
        setHasDiscovered(true);
        return;
      }

      // Filter for links with href attributes
      const links = elements.filter(
        (el) =>
          (el.tagName?.toLowerCase() === "a" || el.type === "link") &&
          el.href &&
          el.href !== "#" &&
          !el.href.startsWith("javascript:")
      );

      // Extract unique routes relative to targetUrl
      const baseUrl = new URL(targetUrl);
      const seen = new Set<string>();
      const discovered: DiscoveredPage[] = [];

      for (const link of links) {
        if (!link.href) continue;

        let fullUrl: string;
        try {
          // Handle relative and absolute URLs
          fullUrl = new URL(link.href, targetUrl).href;
        } catch {
          continue;
        }

        // Only include URLs on the same origin
        try {
          const parsed = new URL(fullUrl);
          if (parsed.origin !== baseUrl.origin) continue;

          // Use pathname as the dedup key
          const path = parsed.pathname;
          if (seen.has(path)) continue;
          seen.add(path);

          discovered.push({
            url: path,
            title: link.text?.trim() || link.attributes?.["aria-label"] || path,
            enabled: true,
          });
        } catch {
          continue;
        }
      }

      // Sort by URL path
      discovered.sort((a, b) => a.url.localeCompare(b.url));

      setPages(discovered);
      setHasDiscovered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discover pages");
      setHasDiscovered(true);
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  const addPage = useCallback((url: string, title?: string) => {
    setPages((prev) => {
      if (prev.some((p) => p.url === url)) return prev;
      return [...prev, { url, title: title || url, enabled: true }];
    });
  }, []);

  const togglePage = useCallback((url: string) => {
    setPages((prev) =>
      prev.map((p) => (p.url === url ? { ...p, enabled: !p.enabled } : p))
    );
  }, []);

  const toggleAll = useCallback((enabled: boolean) => {
    setPages((prev) => prev.map((p) => ({ ...p, enabled })));
  }, []);

  return {
    pages,
    setPages,
    isDiscovering,
    hasDiscovered,
    error,
    discover,
    addPage,
    togglePage,
    toggleAll,
  };
}
