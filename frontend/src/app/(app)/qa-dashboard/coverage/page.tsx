"use client";

export const dynamic = "force-dynamic";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import nextDynamic from "next/dynamic";

const CoverageTrendChart = nextDynamic(
  () =>
    import("@/components/testing/CoverageTrendChart").then((m) => ({
      default: m.CoverageTrendChart,
    })),
  { ssr: false }
);
import { RequireProject } from "@/components/require-project";
import {
  TrendingUp,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

function CoveragePageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

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
    <RequireProject pageName="Test Coverage">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            Test Coverage
          </h1>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/qa-dashboard")}
              data-testid="qa-coverage-runs-btn"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Test Runs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/qa-dashboard/deficiencies")}
              data-testid="qa-coverage-deficiencies-btn"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Deficiencies
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">
              Track test coverage trends and identify gaps in your testing
              strategy
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="bg-muted border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overall Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-foreground">--</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Passing Tests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-green-500">--</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-green-500/50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Failing Tests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-red-500">--</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-red-500/50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {projectId ? (
            <CoverageTrendChart projectId={projectId} />
          ) : (
            <div className="p-12 text-center">
              <TrendingUp className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-muted-foreground mb-2">
                No Project Selected
              </h3>
              <p className="text-muted-foreground">
                Please select a project from the dashboard to view coverage
                trends
              </p>
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}

export default function CoveragePage() {
  return (
    <Suspense fallback={null}>
      <CoveragePageContent />
    </Suspense>
  );
}
