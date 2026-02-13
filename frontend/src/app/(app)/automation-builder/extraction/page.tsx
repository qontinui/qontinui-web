"use client";

import { RequireProject } from "@/components/require-project";
import { ExtractionPageContent } from "./_components/ExtractionPageContent";

export default function UnifiedExtractionPage() {
  return (
    <RequireProject pageName="Discover">
      <ExtractionPageContent />
    </RequireProject>
  );
}
