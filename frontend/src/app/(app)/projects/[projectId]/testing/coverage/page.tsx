"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverageTrendChart } from "@/components/testing/CoverageTrendChart";
import {
  TrendingUp,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export default function ProjectCoveragePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

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
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Test Coverage</h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/testing`)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Test Runs
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/projects/${projectId}/testing/deficiencies`)
            }
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
                    No data available
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
                    No data available
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
                    No data available
                  </div>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        <CoverageTrendChart projectId={projectId} />
      </main>
    </div>
  );
}
