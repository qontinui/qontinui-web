"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { TestRunsList } from "@/components/testing/TestRunsList";
import { CoverageTrendChart } from "@/components/testing/CoverageTrendChart";
import { ReliabilityStats } from "@/components/testing/ReliabilityStats";
import { LiveTestExecution } from "@/components/testing/LiveTestExecution";
import { RequireProject } from "@/components/require-project";
import {
  BarChart3,
  FileText,
  TrendingUp,
  PlayCircle,
  Activity,
} from "lucide-react";

export default function QADashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const testRunIdParam = searchParams.get("testRunId");
  const workflowNameParam = searchParams.get("workflowName");

  const [selectedView, setSelectedView] = useState<
    "overview" | "live" | "trends" | "reliability"
  >(() => (testRunIdParam ? "live" : "overview"));
  const [liveTestRunId] = useState<string | null>(() => testRunIdParam || null);
  const [liveWorkflowName] = useState<string | null>(
    () => workflowNameParam || null
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="QA Dashboard">
      <div
        className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
        data-ui-id="qa-dashboard-page"
      >
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            QA Dashboard
          </h1>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/qa-dashboard/runs")}
              data-ui-id="qa-dashboard-all-runs-btn"
            >
              <FileText className="w-4 h-4 mr-2" />
              All Runs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/qa-dashboard/deficiencies")}
              data-ui-id="qa-dashboard-deficiencies-btn"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Deficiencies
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">
              View historical test results, coverage trends, and deficiency
              reports
            </p>
          </div>

          <div
            className="flex items-center gap-2 mb-6"
            data-ui-id="qa-dashboard-view-selector"
          >
            {(
              [
                { key: "overview", label: "Test Runs", icon: PlayCircle },
                { key: "live", label: "Live Execution", icon: Activity },
                { key: "trends", label: "Coverage Trends", icon: TrendingUp },
                { key: "reliability", label: "Reliability", icon: BarChart3 },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSelectedView(key)}
                className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-2 ${
                  selectedView === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-ui-id={`qa-dashboard-${key}-tab`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {selectedView === "overview" && (
            <TestRunsList projectId={projectId || undefined} />
          )}

          {selectedView === "live" && (
            <LiveTestExecution
              testRunId={liveTestRunId || undefined}
              workflowName={liveWorkflowName || undefined}
              onComplete={(data) => {
                console.log("Test execution completed:", data);
              }}
            />
          )}

          {selectedView === "trends" && projectId && (
            <CoverageTrendChart projectId={projectId} />
          )}

          {selectedView === "trends" && !projectId && (
            <div className="p-12 text-center text-muted-foreground">
              Please select a project from the dashboard to view coverage trends
            </div>
          )}

          {selectedView === "reliability" && projectId && (
            <ReliabilityStats projectId={projectId} />
          )}

          {selectedView === "reliability" && !projectId && (
            <div className="p-12 text-center text-muted-foreground">
              Please select a project from the dashboard to view reliability
              statistics
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}
