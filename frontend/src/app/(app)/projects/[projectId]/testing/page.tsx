"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { LiveTestExecution } from "@/components/testing/LiveTestExecution";
import { createLogger } from "@/lib/logger";

const log = createLogger("TestingDashboard");
import {
  BarChart3,
  TrendingUp,
  PlayCircle,
  Activity,
  FlaskConical,
} from "lucide-react";

export default function ProjectTestingDashboard() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  const [selectedView, setSelectedView] = useState<
    "overview" | "live" | "trends" | "reliability"
  >("overview");

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">
          Testing Dashboard
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/projects/${projectId}/testing/coverage`)
            }
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
          >
            <FlaskConical className="w-4 h-4 mr-2" />
            Integration Tests
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

        <div className="flex items-center gap-2 mb-6">
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
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {selectedView === "overview" && <TestRunsList projectId={projectId} />}

        {selectedView === "live" && (
          <LiveTestExecution
            onComplete={(data) => {
              log.debug("Test execution completed:", data);
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
