/**
 * page-crawler.ts
 *
 * Async crawl orchestration for automated page discovery.
 * Pure async functions — no React state. Uses runnerApi directly.
 */

import { runnerApi } from "@/lib/runner/runner-api-object";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";
import type { PageEntry } from "@/lib/page-sweep-generator";
import {
  mergeDiscoveredPages,
  noSpecPageEntry,
} from "@/lib/page-sweep-generator";
import { parseDiscoveredSpecs, unwrapSpecResponse } from "./spec-parser";
import {
  transformSdkElements,
  extractLinks,
  unwrapElementResponse,
} from "./link-extractor";
import type { DiscoveredLink } from "@/lib/ui-bridge/types";

// =============================================================================
// Types
// =============================================================================

export interface CrawlProgress {
  currentPage: string;
  currentIndex: number;
  totalPages: number;
  pagesWithSpecs: number;
  pagesWithoutSpecs: number;
}

export interface CrawlOptions {
  /** Delay after navigation before discovering specs (ms). Default: 2500 */
  settleDelayMs?: number;
  /** Target a specific browser tab for navigation */
  targetTabId?: string;
  /** Progress callback, called for each page */
  onProgress?: (progress: CrawlProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// =============================================================================
// Core functions
// =============================================================================

/**
 * Discover specs on the current page (no navigation).
 * Returns parsed DiscoveredSpec[] or empty array.
 */
async function discoverCurrentPageSpecs(
  targetTabId?: string
): Promise<DiscoveredSpec[]> {
  const raw = await runnerApi.uiBridgeDiscover({
    action: "getSpecs",
    ...(targetTabId ? { targetTabId } : {}),
  });
  const rawSpecs = unwrapSpecResponse(raw);
  return parseDiscoveredSpecs(rawSpecs);
}

/**
 * Get the current page URL from a snapshot.
 */
async function getCurrentPageUrl(): Promise<string | null> {
  try {
    const snapshot = await runnerApi.uiBridgeSnapshot();
    const url = (snapshot as Record<string, unknown>)?.url;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Discover navigable links from the current page via element discovery.
 *
 * @param appOrigin - Origin of the connected app for filtering links
 */
export async function discoverCurrentPageLinks(
  appOrigin?: string,
  targetTabId?: string
): Promise<DiscoveredLink[]> {
  const raw = await runnerApi.uiBridgeDiscover({
    interactive_only: false,
    ...(targetTabId ? { targetTabId } : {}),
  });
  const rawElems = unwrapElementResponse(raw);
  const elems = transformSdkElements(rawElems);
  return extractLinks(elems, appOrigin);
}

/**
 * Crawl a list of URLs, navigating to each and discovering specs.
 * Returns PageEntry[] — each page either has specs or is marked as no-spec.
 */
export async function crawlPages(
  urls: string[],
  options: CrawlOptions = {}
): Promise<PageEntry[]> {
  const { settleDelayMs = 2500, targetTabId, onProgress, signal } = options;

  const pages: PageEntry[] = [];
  let pagesWithSpecs = 0;
  let pagesWithoutSpecs = 0;

  for (const [i, url] of urls.entries()) {
    if (signal?.aborted) break;

    onProgress?.({
      currentPage: url,
      currentIndex: i,
      totalPages: urls.length,
      pagesWithSpecs,
      pagesWithoutSpecs,
    });

    try {
      // Navigate to the page
      await runnerApi.uiBridgePageNavigate(url, targetTabId);

      // Wait for page to settle
      await new Promise((resolve) => setTimeout(resolve, settleDelayMs));

      if (signal?.aborted) break;

      // Discover specs
      const specs = await discoverCurrentPageSpecs(targetTabId);

      if (specs.length > 0) {
        const merged = mergeDiscoveredPages([], specs);
        pages.push(...merged);
        pagesWithSpecs++;
      } else {
        // Try to get the actual pathname from the snapshot
        const currentUrl = await getCurrentPageUrl();
        const pathname = currentUrl ? new URL(currentUrl).pathname : url;
        pages.push(noSpecPageEntry(pathname));
        pagesWithoutSpecs++;
      }
    } catch {
      // Navigation or discovery failed — mark as no-spec
      pages.push(noSpecPageEntry(url));
      pagesWithoutSpecs++;
    }
  }

  // Final progress update
  onProgress?.({
    currentPage: "",
    currentIndex: urls.length,
    totalPages: urls.length,
    pagesWithSpecs,
    pagesWithoutSpecs,
  });

  return pages;
}

/**
 * Full auto-discovery: discover links from the current page, then crawl each.
 * Returns PageEntry[] for all discovered pages.
 */
export async function discoverAndCrawlAllPages(
  options: CrawlOptions & { appOrigin?: string } = {}
): Promise<PageEntry[]> {
  const { appOrigin, ...crawlOptions } = options;

  // Step 1: Discover navigable links from the current page
  const links = await discoverCurrentPageLinks(
    appOrigin,
    crawlOptions.targetTabId
  );

  if (links.length === 0) {
    return [];
  }

  const urls = links.map((l) => l.url);

  // Step 2: Crawl each discovered URL
  return crawlPages(urls, crawlOptions);
}
