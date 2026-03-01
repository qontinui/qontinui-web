"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { TestRunsList } from "@/components/testing/TestRunsList";
import nextDynamic from "next/dynamic";

const CoverageTrendChart = nextDynamic(
  () =>
    import("@/components/testing/CoverageTrendChart").then((m) => ({
      default: m.CoverageTrendChart,
    })),
  { ssr: false }
);
import { ReliabilityStats } from "@/components/testing/ReliabilityStats";
import { RequireProject } from "@/components/require-project";
import { BarChart3, FileText, TrendingUp, PlayCircle } from "lucide-react";

function TestingDashboardContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [selectedView, setSelectedView] = useState<
    "overview" | "trends" | "reliability"
  >("overview");

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
    <RequireProject pageName="Test Runs">
      <div
        className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
        data-ui-id="testing-page-dashboard"
      >
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            Testing Dashboard
          </h1>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/testing/runs")}
              data-ui-id="testing-page-all-runs-btn"
            >
              <FileText className="w-4 h-4 mr-2" />
              All Runs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/testing/deficiencies")}
              data-ui-id="testing-page-deficiencies-btn"
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
            data-ui-id="testing-page-view-selector"
          >
            {(
              [
                { key: "overview", label: "Test Runs", icon: PlayCircle },
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
                data-ui-id={`testing-page-${key}-tab`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {selectedView === "overview" && (
            <TestRunsList projectId={projectId || undefined} />
          )}

          {selectedView === "trends" && projectId && (
            <CoverageTrendChart projectId={projectId} />
          )}

          {selectedView === "trends" && !projectId && (
            <div
              className="p-12 text-center text-muted-foreground"
              data-content-role="status"
            >
              Please select a project from the dashboard to view coverage trends
            </div>
          )}

          {selectedView === "reliability" && projectId && (
            <ReliabilityStats projectId={projectId} />
          )}

          {selectedView === "reliability" && !projectId && (
            <div
              className="p-12 text-center text-muted-foreground"
              data-content-role="status"
            >
              Please select a project from the dashboard to view reliability
              statistics
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}

export default function TestingDashboard() {
  return (
    <Suspense fallback={null}>
      <TestingDashboardContent />
    </Suspense>
  );
}
