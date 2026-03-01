"use client";

/**
 * Web Extraction Page (Legacy)
 *
 * This page redirects to the new unified Extraction page.
 * The unified page supports multiple extraction methods:
 * - Web Extraction (DOM-based)
 * - UI-TARS Web (Vision-based for websites)
 * - UI-TARS Desktop (Vision-based for native apps)
 * - Image Extraction (Template matching)
 */

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function WebExtractionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Preserve query params when redirecting
    const params = searchParams.toString();
    const redirectUrl = params
      ? `/automation-builder/extraction?${params}`
      : "/automation-builder/extraction";
    router.replace(redirectUrl);
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-mono">
          Redirecting to unified Extraction page...
        </p>
      </div>
    </div>
  );
}

export default function WebExtractionPage() {
  return (
    <Suspense fallback={null}>
      <WebExtractionPageContent />
    </Suspense>
  );
}
