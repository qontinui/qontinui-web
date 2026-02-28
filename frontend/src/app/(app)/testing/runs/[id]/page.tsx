"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { TestRunDetails } from "@/components/testing/TestRunDetails";
import { StateGraphVisualization } from "@/components/testing/StateGraphVisualization";
import { useTestRun } from "@/hooks/useTesting";
import { RequireProject } from "@/components/require-project";

export default function TestRunDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const runId = params.id as string;

  const { data: run } = useTestRun(runId);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div
          data-content-role="status"
          data-content-label="loading state"
          className="text-lg text-muted-foreground"
        >
          Loading...
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Test Run Details">
      <div
        className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
        data-ui-id="testing-page-run-details"
      >
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            Test Run Details
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <TestRunDetails runId={runId} />

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
