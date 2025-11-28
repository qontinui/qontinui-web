"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { RequireProject } from "@/components/require-project";
import { WebExtractionPage } from "@/components/web-extraction/WebExtractionPage";

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function WebExtraction() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="Web Extraction">
        <WebExtractionPage />
      </RequireProject>
    </Suspense>
  );
}
