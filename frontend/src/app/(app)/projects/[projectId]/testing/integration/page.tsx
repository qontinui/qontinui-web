"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IntegrationTestResults } from "@/components/testing/IntegrationTestResults";
import { VisualPlayback } from "@/components/testing/VisualPlayback";
import { integrationTestingService } from "@/services/integration-testing";
import { formatTimestampLocal } from "@/lib/time-utils";
import {
  ArrowLeft,
  Play,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  FileText,
  AlertCircle,
  Activity,
} from "lucide-react";
import type {
  IntegrationTestResponse,
  IntegrationTestRunSummary,
  WorkflowConfig,
} from "@/types/integration-testing";

type ViewMode = "list" | "detail" | "visual";

export default function IntegrationTestPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  const [runs, setRuns] = useState<IntegrationTestRunSummary[]>([]);
  const [selectedRun, setSelectedRun] =
    useState<IntegrationTestResponse | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [runningTest, setRunningTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);

  // Check API health on mount
  useEffect(() => {
    const checkHealth = async () => {
      const healthy = await integrationTestingService.checkApiHealth();
      setApiHealthy(healthy);
    };
    checkHealth();
  }, []);

  // Fetch integration test runs
  const fetchRuns = useCallback(async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError(null);
      const response =
        await integrationTestingService.getIntegrationTestRuns(projectId);
      setRuns(response.runs);
    } catch (err) {
      console.error("Failed to fetch integration test runs:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    } else if (user) {
      fetchRuns();
    }
  }, [user, authLoading, router, fetchRuns]);

  // Load run details
  const loadRunDetails = async (runId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result =
        await integrationTestingService.getIntegrationTestResult(runId);
      setSelectedRun(result);
      setViewMode("detail");
    } catch (err) {
      console.error("Failed to load run details:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load run details"
      );
    } finally {
      setLoading(false);
    }
  };

  // Run integration test (placeholder - would need workflow config)
  const runIntegrationTest = async () => {
    if (!projectId) return;

    // This is a placeholder - in a real implementation, you would:
    // 1. Select a workflow from the project
    // 2. Build WorkflowConfig from the workflow definition
    // 3. Call the integration test endpoint

    const mockWorkflowConfig: WorkflowConfig = {
      workflow_id: "placeholder",
      workflow_name: "Integration Test",
      states: [],
      transitions: [],
    };

    try {
      setRunningTest(true);
      setError(null);
      const result = await integrationTestingService.runIntegrationTest(
        projectId,
        mockWorkflowConfig,
        {
          include_historical_stats: true,
          record_screenshots: true,
        }
      );
      setSelectedRun(result);
      setViewMode("detail");
      // Refresh the runs list
      fetchRuns();
    } catch (err) {
      console.error("Failed to run integration test:", err);
      setError(
        err instanceof Error ? err.message : "Failed to run integration test"
      );
    } finally {
      setRunningTest(false);
    }
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "detail" ? "visual" : "detail"));
  };

  const goBackToList = () => {
    setSelectedRun(null);
    setViewMode("list");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => {
                if (viewMode !== "list" && selectedRun) {
                  goBackToList();
                } else {
                  router.push(`/projects/${projectId}/testing`);
                }
              }}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {viewMode !== "list" && selectedRun
                ? "Back to List"
                : "Testing Dashboard"}
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#0099CC] bg-clip-text text-transparent">
              Integration Testing
            </h1>
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
              Mock Mode
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {/* API Health Indicator */}
            {apiHealthy !== null && (
              <Badge
                className={
                  apiHealthy
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-red-500/20 text-red-400 border-red-500/30"
                }
              >
                {apiHealthy ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    API Connected
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mr-1" />
                    API Offline
                  </>
                )}
              </Badge>
            )}

            {/* View Mode Toggle (when viewing details) */}
            {selectedRun && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleViewMode}
                className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
              >
                {viewMode === "visual" ? (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Details View
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Visual View
                  </>
                )}
              </Button>
            )}

            {/* Refresh Button */}
            {viewMode === "list" && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRuns}
                disabled={loading}
                className="border-gray-700 hover:border-gray-600"
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            )}

            {/* Run Test Button */}
            <Button
              onClick={runIntegrationTest}
              disabled={runningTest || !apiHealthy}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
            >
              {runningTest ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Test
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* Error Display */}
        {error && (
          <Card className="bg-red-500/10 border-red-500/30 mb-6">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setError(null)}
                  className="ml-auto text-red-400 hover:text-red-300"
                >
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API Offline Warning */}
        {apiHealthy === false && viewMode === "list" && (
          <Card className="bg-yellow-500/10 border-yellow-500/30 mb-6">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertCircle className="w-5 h-5" />
                <span>
                  qontinui-api is not reachable at{" "}
                  {process.env.NEXT_PUBLIC_QONTINUI_API_URL ||
                    "http://localhost:8001"}
                  . Start the API to run integration tests.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Content based on view mode */}
        {viewMode === "list" && (
          <>
            {/* Welcome Section */}
            <div className="mb-8">
              <h2 className="text-3xl font-bold mb-2">Integration Test Runs</h2>
              <p className="text-gray-400">
                Run workflows in mock mode using historical data. No live GUI
                required.
              </p>
            </div>

            {/* Runs List */}
            {loading && runs.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#00D9FF]" />
              </div>
            ) : runs.length === 0 ? (
              <EmptyState
                onRunTest={runIntegrationTest}
                runningTest={runningTest}
                apiHealthy={apiHealthy}
              />
            ) : (
              <IntegrationTestRunsList
                runs={runs}
                onSelectRun={loadRunDetails}
              />
            )}
          </>
        )}

        {viewMode === "detail" && selectedRun && (
          <IntegrationTestResults
            run={selectedRun}
            showPlaybackToggle={true}
            onToggleVisualMode={toggleViewMode}
          />
        )}

        {viewMode === "visual" && selectedRun && (
          <VisualPlayback
            run={selectedRun}
            onToggleVisualMode={toggleViewMode}
          />
        )}
      </main>
    </div>
  );
}

// =============================================================================
// Empty State Component
// =============================================================================

interface EmptyStateProps {
  onRunTest: () => void;
  runningTest: boolean;
  apiHealthy: boolean | null;
}

function EmptyState({ onRunTest, runningTest, apiHealthy }: EmptyStateProps) {
  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardContent className="py-12 text-center">
        <Activity className="w-16 h-16 mx-auto mb-4 text-gray-600" />
        <h3 className="text-xl font-medium text-white mb-2">
          No Integration Tests Yet
        </h3>
        <p className="text-gray-400 mb-6 max-w-md mx-auto">
          Run your first integration test to validate workflow behavior using
          historical execution data. Tests run in mock mode without needing a
          live GUI.
        </p>
        <Button
          onClick={onRunTest}
          disabled={runningTest || !apiHealthy}
          className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
        >
          {runningTest ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run First Test
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Runs List Component
// =============================================================================

interface IntegrationTestRunsListProps {
  runs: IntegrationTestRunSummary[];
  onSelectRun: (runId: string) => void;
}

function IntegrationTestRunsList({
  runs,
  onSelectRun,
}: IntegrationTestRunsListProps) {
  const getStatusBadge = (status: IntegrationTestRunSummary["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      case "timeout":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Timeout
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            {status}
          </Badge>
        );
    }
  };

  const formatDate = (dateStr: string) => {
    return formatTimestampLocal(dateStr);
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return "0ms";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <Card
          key={run.id}
          className="bg-[#1A1A1B]/50 border-gray-800/50 hover:border-gray-700/50 transition-colors cursor-pointer"
          onClick={() => onSelectRun(run.id)}
        >
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white">
                      {run.workflow_name}
                    </span>
                    {getStatusBadge(run.status)}
                  </div>
                  <div className="text-sm text-gray-400">
                    {formatDate(run.started_at)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <div className="text-gray-400">Coverage</div>
                  <div
                    className={`font-bold ${
                      run.coverage_percentage >= 80
                        ? "text-green-400"
                        : run.coverage_percentage >= 50
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {run.coverage_percentage.toFixed(0)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-400">Success</div>
                  <div
                    className={`font-bold ${
                      run.success_rate >= 90
                        ? "text-green-400"
                        : run.success_rate >= 70
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {run.success_rate}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-400">Actions</div>
                  <div className="font-bold text-white">
                    {run.total_actions}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-400">Duration</div>
                  <div className="font-bold text-white">
                    {formatDuration(run.duration_ms)}
                  </div>
                </div>
                {run.issues_count > 0 && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    {run.issues_count} issue{run.issues_count > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
