"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ComparisonSelector } from "@/components/testing/ComparisonSelector";
import { TestRunComparison } from "@/components/testing/TestRunComparison";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

function ComparePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("project_id");

  const [run1Id, setRun1Id] = useState<string | null>(
    searchParams.get("run1") || null
  );
  const [run2Id, setRun2Id] = useState<string | null>(
    searchParams.get("run2") || null
  );

  const handleCompare = (newRun1Id: string, newRun2Id: string) => {
    setRun1Id(newRun1Id);
    setRun2Id(newRun2Id);

    const params = new URLSearchParams(searchParams.toString());
    params.set("run1", newRun1Id);
    params.set("run2", newRun2Id);
    router.push(`/qa-dashboard/compare?${params.toString()}`);
  };

  if (!projectIdParam) {
    return (
      <div className="p-12 text-center">
        <div className="text-red-400 mb-4">
          No project specified. Please select a project first.
        </div>
        <Button onClick={() => router.push("/qa-dashboard")} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to QA Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-id="qa-compare-page"
    >
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">
          Compare Test Runs
        </h1>
        <Button
          onClick={() =>
            router.push(`/qa-dashboard/runs?project_id=${projectIdParam}`)
          }
          variant="outline"
          size="sm"
          data-ui-id="qa-compare-back-btn"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Runs
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-sm text-muted-foreground">
          Analyze differences between two test runs to identify improvements or
          regressions
        </p>

        <ComparisonSelector
          projectId={projectIdParam}
          onCompare={handleCompare}
        />

        {run1Id && run2Id && (
          <TestRunComparison run1Id={run1Id} run2Id={run2Id} />
        )}

        {!run1Id || !run2Id ? (
          <div className="p-12 text-center text-muted-foreground">
            Select two test runs above to see a detailed comparison
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
