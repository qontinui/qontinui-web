"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  PlayCircle,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useTestStream } from "@/hooks/useTestStream";
import { TestStepTimeline } from "./TestStepTimeline";
import { CoverageHeatmap } from "./CoverageHeatmap";

interface LiveTestDashboardProps {
  testRunId?: string;
  onComplete?: (data: { success: boolean; duration: number }) => void;
}

export function LiveTestDashboard({
  testRunId,
  onComplete,
}: LiveTestDashboardProps) {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    state,
    workflowName,
    startTime,
    elapsedTime,
    currentStep,
    steps,
    totalSteps,
    completedSteps,
    failedSteps,
    coverage,
    deficiencies,
    isConnected,
  } = useTestStream({
    testRunId,
    enabled: !!testRunId,
    onConnect: () => {
      console.log("[LiveTestDashboard] Connected to test stream");
      setConnectionError(null);
    },
    onDisconnect: () => {
      console.log("[LiveTestDashboard] Disconnected from test stream");
    },
    onError: (error) => {
      console.error("[LiveTestDashboard] Stream error:", error);
      setConnectionError(error.message);
    },
    onTestComplete: (data) => {
      console.log("[LiveTestDashboard] Test completed:", data);
      if (onComplete) {
        onComplete(data);
      }
    },
  });

  const formatElapsedTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgressPercentage = () => {
    if (totalSteps === 0) return 0;
    return Math.round(((completedSteps + failedSteps) / totalSteps) * 100);
  };

  const getSuccessRate = () => {
    const total = completedSteps + failedSteps;
    if (total === 0) return 0;
    return Math.round((completedSteps / total) * 100);
  };

  const getStateIcon = () => {
    switch (state) {
      case "running":
        return <PlayCircle className="w-5 h-5 text-blue-500 animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "connecting":
      case "connected":
        return <Activity className="w-5 h-5 text-yellow-500 animate-pulse" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStateBadge = () => {
    switch (state) {
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30">
            Running
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30">
            Failed
          </Badge>
        );
      case "connecting":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
            Connecting
          </Badge>
        );
      case "connected":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Connected
          </Badge>
        );
      case "disconnected":
        return (
          <Badge className="bg-gray-500/20 text-gray-500 border-gray-500/30">
            Disconnected
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-500 border-gray-500/30">
            Idle
          </Badge>
        );
    }
  };

  if (!testRunId) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-white mb-2">
            No Active Test
          </h3>
          <p className="text-gray-400">
            Start a test execution to see live results here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStateIcon()}
              <div>
                <CardTitle className="text-xl">
                  {workflowName || "Test Execution"}
                </CardTitle>
                {startTime && (
                  <p className="text-sm text-gray-400 mt-1">
                    Started {startTime.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {getStateBadge()}
              <Badge
                variant="outline"
                className={
                  isConnected
                    ? "border-green-500/30 text-green-500"
                    : "border-red-500/30 text-red-500"
                }
              >
                {isConnected ? (
                  <Wifi className="w-3 h-3 mr-1" />
                ) : (
                  <WifiOff className="w-3 h-3 mr-1" />
                )}
                {isConnected ? "Live" : "Offline"}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsExpanded(!isExpanded)}
                className="ml-2"
              >
                {isExpanded ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Connection Error */}
          {connectionError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-red-400">
                  Connection Error
                </div>
                <div className="text-xs text-red-300 mt-1">
                  {connectionError}
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Elapsed Time */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded-lg border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-[#00D9FF]" />
                <div className="text-xs text-gray-400">Elapsed Time</div>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatElapsedTime(elapsedTime)}
              </div>
            </div>

            {/* Current Step */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded-lg border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-[#BD00FF]" />
                <div className="text-xs text-gray-400">Current Step</div>
              </div>
              <div className="text-sm font-medium text-white truncate">
                {currentStep?.actionType || "-"}
              </div>
              {currentStep && (
                <div className="text-xs text-gray-500 mt-1">
                  Step {currentStep.stepNumber}
                </div>
              )}
            </div>

            {/* Success Rate */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded-lg border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <div className="text-xs text-gray-400">Success Rate</div>
              </div>
              <div className="text-2xl font-bold text-white">
                {getSuccessRate()}%
              </div>
            </div>

            {/* Coverage */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded-lg border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-[#00D9FF]" />
                <div className="text-xs text-gray-400">Coverage</div>
              </div>
              <div className="text-2xl font-bold text-[#00D9FF]">
                {coverage?.coveragePercentage.toFixed(1) || "0"}%
              </div>
              {coverage && (
                <div className="text-xs text-gray-500 mt-1">
                  {coverage.statesCovered} / {coverage.totalStates} states
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {totalSteps > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-400">Test Progress</div>
                <div className="text-white font-medium">
                  {completedSteps + failedSteps} / {totalSteps} steps
                </div>
              </div>
              <Progress
                value={getProgressPercentage()}
                className="h-2 bg-gray-800"
              />
              <div className="flex items-center justify-between text-xs text-gray-400">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span>{completedSteps} passed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-500" />
                    <span>{failedSteps} failed</span>
                  </div>
                </div>
                <div>{getProgressPercentage()}% complete</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div
        className={`grid ${isExpanded ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3"} gap-6`}
      >
        {/* Timeline - Takes 2 columns in grid view */}
        <div className={isExpanded ? "col-span-1" : "lg:col-span-2"}>
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-lg">Step Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[700px] overflow-y-auto pr-2">
                <TestStepTimeline
                  steps={steps}
                  currentStepId={currentStep?.id}
                  autoScroll={state === "running"}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar - Coverage and Issues */}
        <div className={`space-y-6 ${isExpanded ? "" : "lg:col-span-1"}`}>
          {/* Coverage Heatmap */}
          <CoverageHeatmap coverage={coverage} />

          {/* Deficiency List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Issues Detected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {deficiencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No issues detected
                  </p>
                ) : (
                  deficiencies.map((deficiency, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 p-2 rounded-lg border border-border"
                    >
                      <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{deficiency.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {deficiency.description}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
