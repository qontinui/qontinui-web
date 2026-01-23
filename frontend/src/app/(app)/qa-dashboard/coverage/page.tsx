"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverageTrendChart } from "@/components/testing/CoverageTrendChart";
import { RequireProject } from "@/components/require-project";
import {
  ArrowLeft,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export default function CoveragePage() {
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
    <RequireProject pageName="Test Coverage">
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white" data-ui-id="qa-coverage-page">
        {/* Header */}
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push("/qa-dashboard")}
                className="text-text-muted hover:text-white"
                data-ui-id="qa-coverage-back-btn"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-warning to-error bg-clip-text text-transparent">
                Test Coverage
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/qa-dashboard")}
                className="border-border-default hover:border-warning hover:text-warning"
                data-ui-id="qa-coverage-runs-btn"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Test Runs
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/qa-dashboard/deficiencies")}
                className="border-border-default hover:border-error hover:text-error"
                data-ui-id="qa-coverage-deficiencies-btn"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Deficiencies
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Coverage Analysis</h2>
            <p className="text-text-muted">
              Track test coverage trends and identify gaps in your testing
              strategy
            </p>
          </div>

          {/* Coverage Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-text-muted">
                  Overall Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-warning">--</div>
                    <div className="text-xs text-text-muted mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <TrendingUp className="w-8 h-8 text-warning/50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-text-muted">
                  Passing Tests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-brand-success">
                      --
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-brand-success/50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-text-muted">
                  Failing Tests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-3xl font-bold text-error">--</div>
                    <div className="text-xs text-text-muted mt-1">
                      Requires project selection
                    </div>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-error/50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Coverage Trends Chart */}
          {projectId ? (
            <CoverageTrendChart projectId={projectId} />
          ) : (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="p-12 text-center">
                <TrendingUp className="w-16 h-16 text-text-muted mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-text-secondary mb-2">
                  No Project Selected
                </h3>
                <p className="text-text-muted">
                  Please select a project from the dashboard to view coverage
                  trends
                </p>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </RequireProject>
  );
}
