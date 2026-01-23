"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ComparisonSelector } from "@/components/testing/ComparisonSelector";
import { TestRunComparison } from "@/components/testing/TestRunComparison";
import { Card, CardContent } from "@/components/ui/card";
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

    // Update URL params
    const params = new URLSearchParams(searchParams.toString());
    params.set("run1", newRun1Id);
    params.set("run2", newRun2Id);
    router.push(`/qa-dashboard/compare?${params.toString()}`);
  };

  if (!projectIdParam) {
    return (
      <div className="container mx-auto p-8">
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-12 text-center">
            <div className="text-red-400 mb-4">
              No project specified. Please select a project first.
            </div>
            <Button
              onClick={() => router.push("/qa-dashboard")}
              variant="outline"
              className="border-border-default hover:border-brand-primary hover:text-brand-primary"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to QA Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 space-y-6" data-ui-id="qa-compare-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Compare Test Runs</h1>
          <p className="text-text-muted">
            Analyze differences between two test runs to identify improvements
            or regressions
          </p>
        </div>
        <Button
          onClick={() =>
            router.push(`/qa-dashboard/runs?project_id=${projectIdParam}`)
          }
          variant="outline"
          className="border-border-default hover:border-brand-primary hover:text-brand-primary"
          data-ui-id="qa-compare-back-btn"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Runs
        </Button>
      </div>

      <ComparisonSelector
        projectId={projectIdParam}
        onCompare={handleCompare}
      />

      {run1Id && run2Id && (
        <TestRunComparison run1Id={run1Id} run2Id={run2Id} />
      )}

      {!run1Id || !run2Id ? (
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-12 text-center">
            <div className="text-text-muted">
              Select two test runs above to see a detailed comparison
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto p-8">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="p-12 text-center">
              <div className="text-text-muted">Loading...</div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
