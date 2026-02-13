"use client";

import { Suspense } from "react";
import { RequireProject } from "@/components/require-project";
import { Loader2 } from "lucide-react";
import { TestingContent } from "./_components";

export default function WorkflowTestingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
        </div>
      }
    >
      <RequireProject pageName="Workflow Testing">
        <TestingContent />
      </RequireProject>
    </Suspense>
  );
}
