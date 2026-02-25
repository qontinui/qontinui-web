"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  // Derive initial state from URL params
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="QA Dashboard">
      <div
        className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white"
        data-ui-id="qa-dashboard-page"
      >
        {/* Header */}
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push("/build/workflows")}
                className="text-text-muted hover:text-white"
                data-ui-id="qa-dashboard-back-btn"
              >
                ← Dashboard
              </Button>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
                QA Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/qa-dashboard/runs")}
                className="border-border-default hover:border-brand-primary hover:text-brand-primary"
                data-ui-id="qa-dashboard-all-runs-btn"
              >
                <FileText className="w-4 h-4 mr-2" />
                All Runs
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/qa-dashboard/deficiencies")}
                className="border-border-default hover:border-brand-secondary hover:text-brand-secondary"
                data-ui-id="qa-dashboard-deficiencies-btn"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Deficiencies
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          {/* Welcome Section */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Test Results Overview</h2>
            <p className="text-text-muted">
              View historical test results, coverage trends, and deficiency
              reports
            </p>
          </div>

          {/* View Selector */}
          <div
            className="flex items-center gap-2 mb-6"
            data-ui-id="qa-dashboard-view-selector"
          >
            <Button
              variant={selectedView === "overview" ? "default" : "outline"}
              onClick={() => setSelectedView("overview")}
              className={
                selectedView === "overview"
                  ? "bg-brand-primary hover:bg-brand-primary/80 text-black"
                  : "border-border-default hover:border-brand-primary hover:text-brand-primary"
              }
              data-ui-id="qa-dashboard-overview-tab"
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Test Runs
            </Button>
            <Button
              variant={selectedView === "live" ? "default" : "outline"}
              onClick={() => setSelectedView("live")}
              className={
                selectedView === "live"
                  ? "bg-brand-primary hover:bg-brand-primary/80 text-black"
                  : "border-border-default hover:border-brand-primary hover:text-brand-primary"
              }
              data-ui-id="qa-dashboard-live-tab"
            >
              <Activity className="w-4 h-4 mr-2" />
              Live Execution
            </Button>
            <Button
              variant={selectedView === "trends" ? "default" : "outline"}
              onClick={() => setSelectedView("trends")}
              className={
                selectedView === "trends"
                  ? "bg-brand-primary hover:bg-brand-primary/80 text-black"
                  : "border-border-default hover:border-brand-primary hover:text-brand-primary"
              }
              data-ui-id="qa-dashboard-trends-tab"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Coverage Trends
            </Button>
            <Button
              variant={selectedView === "reliability" ? "default" : "outline"}
              onClick={() => setSelectedView("reliability")}
              className={
                selectedView === "reliability"
                  ? "bg-brand-primary hover:bg-brand-primary/80 text-black"
                  : "border-border-default hover:border-brand-primary hover:text-brand-primary"
              }
              data-ui-id="qa-dashboard-reliability-tab"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Reliability
            </Button>
          </div>

          {/* Content based on selected view */}
          {selectedView === "overview" && (
            <TestRunsList projectId={projectId || undefined} />
          )}

          {selectedView === "live" && (
            <LiveTestExecution
              testRunId={liveTestRunId || undefined}
              workflowName={liveWorkflowName || undefined}
              onComplete={(data) => {
                console.log("Test execution completed:", data);
                // Optionally switch back to overview after completion
                // setTimeout(() => setSelectedView("overview"), 3000);
              }}
            />
          )}

          {selectedView === "trends" && projectId && (
            <CoverageTrendChart projectId={projectId} />
          )}

          {selectedView === "trends" && !projectId && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="p-12 text-center">
                <div className="text-text-muted">
                  Please select a project from the dashboard to view coverage
                  trends
                </div>
              </CardContent>
            </Card>
          )}

          {selectedView === "reliability" && projectId && (
            <ReliabilityStats projectId={projectId} />
          )}

          {selectedView === "reliability" && !projectId && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="p-12 text-center">
                <div className="text-text-muted">
                  Please select a project from the dashboard to view reliability
                  statistics
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </RequireProject>
  );
}
