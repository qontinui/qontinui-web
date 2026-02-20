"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { TestRunsList } from "@/components/testing/TestRunsList";
import { CoverageTrendChart } from "@/components/testing/CoverageTrendChart";
import { ReliabilityStats } from "@/components/testing/ReliabilityStats";
import { LiveTestExecution } from "@/components/testing/LiveTestExecution";
import {
  BarChart3,
  TrendingUp,
  PlayCircle,
  Activity,
  ArrowLeft,
  FlaskConical,
} from "lucide-react";

export default function ProjectTestingDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  const [selectedView, setSelectedView] = useState<
    "overview" | "live" | "trends" | "reliability"
  >("overview");

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
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/build/workflows")}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#F59E0B] to-[#EF4444] bg-clip-text text-transparent">
              Testing Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                router.push(`/projects/${projectId}/testing/coverage`)
              }
              className="border-border-default hover:border-[#F59E0B] hover:text-[#F59E0B]"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Coverage
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                router.push(`/projects/${projectId}/testing/deficiencies`)
              }
              className="border-border-default hover:border-[#EF4444] hover:text-[#EF4444]"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Deficiencies
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                router.push(`/projects/${projectId}/testing/integration`)
              }
              className="border-border-default hover:border-brand-primary hover:text-brand-primary"
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              Integration Tests
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
        <div className="flex items-center gap-2 mb-6">
          <Button
            variant={selectedView === "overview" ? "default" : "outline"}
            onClick={() => setSelectedView("overview")}
            className={
              selectedView === "overview"
                ? "bg-[#F59E0B] hover:bg-[#F59E0B]/80 text-black"
                : "border-border-default hover:border-[#F59E0B] hover:text-[#F59E0B]"
            }
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Test Runs
          </Button>
          <Button
            variant={selectedView === "live" ? "default" : "outline"}
            onClick={() => setSelectedView("live")}
            className={
              selectedView === "live"
                ? "bg-[#F59E0B] hover:bg-[#F59E0B]/80 text-black"
                : "border-border-default hover:border-[#F59E0B] hover:text-[#F59E0B]"
            }
          >
            <Activity className="w-4 h-4 mr-2" />
            Live Execution
          </Button>
          <Button
            variant={selectedView === "trends" ? "default" : "outline"}
            onClick={() => setSelectedView("trends")}
            className={
              selectedView === "trends"
                ? "bg-[#F59E0B] hover:bg-[#F59E0B]/80 text-black"
                : "border-border-default hover:border-[#F59E0B] hover:text-[#F59E0B]"
            }
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Coverage Trends
          </Button>
          <Button
            variant={selectedView === "reliability" ? "default" : "outline"}
            onClick={() => setSelectedView("reliability")}
            className={
              selectedView === "reliability"
                ? "bg-[#F59E0B] hover:bg-[#F59E0B]/80 text-black"
                : "border-border-default hover:border-[#F59E0B] hover:text-[#F59E0B]"
            }
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Reliability
          </Button>
        </div>

        {/* Content based on selected view */}
        {selectedView === "overview" && <TestRunsList projectId={projectId} />}

        {selectedView === "live" && (
          <LiveTestExecution
            onComplete={(data) => {
              console.log("Test execution completed:", data);
            }}
          />
        )}

        {selectedView === "trends" && (
          <CoverageTrendChart projectId={projectId} />
        )}

        {selectedView === "reliability" && (
          <ReliabilityStats projectId={projectId} />
        )}
      </main>
    </div>
  );
}
