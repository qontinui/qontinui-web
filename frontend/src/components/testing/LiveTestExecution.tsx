"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
  Activity,
  TrendingUp,
  Wifi,
  WifiOff,
  AlertCircle,
} from "lucide-react";
import { TransitionTimeline } from "./TransitionTimeline";
import { useTestingWebSocket } from "@/hooks/useTestingWebSocket";

interface LiveTestExecutionProps {
  testRunId?: string;
  workflowName?: string;
  onComplete?: (data: { success: boolean; duration: number }) => void;
}

export function LiveTestExecution({
  testRunId,
  workflowName,
  onComplete,
}: LiveTestExecutionProps) {
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const {
    state,
    currentState,
    currentAction,
    elapsedTime,
    transitions,
    totalTransitions,
    successfulTransitions,
    failedTransitions,
    isConnected,
  } = useTestingWebSocket({
    testRunId,
    enabled: !!testRunId,
    onConnect: () => {
      console.log("[LiveTestExecution] Connected to WebSocket");
      setConnectionError(null);
    },
    onDisconnect: () => {
      console.log("[LiveTestExecution] Disconnected from WebSocket");
    },
    onError: (error) => {
      console.error("[LiveTestExecution] WebSocket error:", error);
      setConnectionError(error.message);
    },
    onTestComplete: (data) => {
      console.log("[LiveTestExecution] Test complete:", data);
      if (onComplete) {
        onComplete(data);
      }
    },
  });

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgressPercentage = () => {
    if (totalTransitions === 0) return 0;
    return Math.round(
      ((successfulTransitions + failedTransitions) / totalTransitions) * 100
    );
  };

  const getSuccessRate = () => {
    const total = successfulTransitions + failedTransitions;
    if (total === 0) return 0;
    return Math.round((successfulTransitions / total) * 100);
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
          <Clock className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <div className="text-gray-400">
            No active test execution. Start a test to see live updates.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStateIcon()}
              <CardTitle className="text-xl">Live Test Execution</CardTitle>
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
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
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

          {/* Workflow Name */}
          {workflowName && (
            <div className="mb-4 text-sm text-gray-400">
              <span className="font-medium">Workflow:</span>{" "}
              <span className="text-white">{workflowName}</span>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Elapsed Time */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-[#00D9FF]" />
                <div className="text-xs text-gray-400">Elapsed Time</div>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatElapsedTime(elapsedTime)}
              </div>
            </div>

            {/* Current State */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-[#BD00FF]" />
                <div className="text-xs text-gray-400">Current State</div>
              </div>
              <div className="text-sm font-medium text-white truncate">
                {currentState || "-"}
              </div>
            </div>

            {/* Current Action */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <PlayCircle className="w-4 h-4 text-green-500" />
                <div className="text-xs text-gray-400">Current Action</div>
              </div>
              <div className="text-sm font-medium text-white truncate">
                {currentAction || "-"}
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-[#0A0A0B]/50 p-4 rounded border border-gray-800/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-yellow-500" />
                <div className="text-xs text-gray-400">Success Rate</div>
              </div>
              <div className="text-2xl font-bold text-white">
                {getSuccessRate()}%
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="text-gray-400">Progress</div>
              <div className="text-white font-medium">
                {successfulTransitions + failedTransitions} / {totalTransitions}{" "}
                transitions
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
                  <span>{successfulTransitions} passed</span>
                </div>
                <div className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-red-500" />
                  <span>{failedTransitions} failed</span>
                </div>
              </div>
              <div>{getProgressPercentage()}% complete</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transition Timeline */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="text-lg">Transition Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            <TransitionTimeline
              transitions={transitions}
              currentTransitionId={
                transitions.find((t) => t.status === "running")?.id
              }
              autoScroll={state === "running"}
            />
          </div>
        </CardContent>
      </Card>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 217, 255, 0.3);
          border-radius: 4px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 217, 255, 0.5);
        }
      `}</style>
    </div>
  );
}
