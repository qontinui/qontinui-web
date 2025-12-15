"use client";

/**
 * Web Extraction Page
 *
 * Automated web page crawler to discover states/elements from URLs.
 * Allows users to:
 * - Input URLs to crawl
 * - Configure extraction options (viewports, capture hover/focus, max depth, max pages)
 * - Create extraction sessions via API
 * - Monitor extraction progress
 * - View discovered states/elements
 * - Import discovered states into current project
 */

import WebExtractionTab from "@/components/web-extraction/WebExtractionTab";
import { RequireProject } from "@/components/require-project";

export default function WebExtractionPage() {
  return (
    <RequireProject pageName="Web Extraction">
      <WebExtractionTab />
    </RequireProject>
  );
}
