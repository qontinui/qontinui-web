"use client";

export const dynamic = "force-dynamic";

import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TestRunDetails } from "@/components/testing/TestRunDetails";
import { StateGraphVisualization } from "@/components/testing/StateGraphVisualization";
import { StateCoverageHeatMap } from "@/components/testing/StateCoverageHeatMap";
import { CoverageSummaryCard } from "@/components/testing/CoverageSummaryCard";
import { useTestRun } from "@/hooks/useTesting";
import { RequireProject } from "@/components/require-project";
import { ArrowLeft } from "lucide-react";

export default function TestRunDetailPage() {
  const router = useRouter();
  const params = useParams();
  const runId = params.id as string;

  const { data: run } = useTestRun(runId);

  return (
    <RequireProject pageName="Test Run Details">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/qa-dashboard/runs")}
              data-testid="qa-run-details-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <h1 className="text-lg font-semibold text-foreground">
              Test Run Details
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <TestRunDetails runId={runId} />

            {run && (
              <CoverageSummaryCard
                projectId={run.project_id}
                workflowId={run.workflow_id}
              />
            )}

            {run && (
              <StateCoverageHeatMap
                projectId={run.project_id}
                workflowId={run.workflow_id}
              />
            )}

            {run && (
              <StateGraphVisualization
                projectId={run.project_id}
                workflowId={run.workflow_id}
              />
            )}
          </div>
        </main>
      </div>
    </RequireProject>
  );
}
