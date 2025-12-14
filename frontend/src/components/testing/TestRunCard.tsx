"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";

interface TestRunCardProps {
  runId: string;
  workflowName: string;
  status: "running" | "completed" | "failed" | "pending";
  startTime: Date;
  duration?: number;
  coveragePercentage: number;
  statesCovered: number;
  totalStates: number;
  successfulTransitions: number;
  totalTransitions: number;
  deficienciesFound: number;
  onClick?: () => void;
}

export function TestRunCard({
  runId,
  workflowName,
  status,
  startTime,
  duration,
  coveragePercentage,
  statesCovered,
  totalStates,
  successfulTransitions,
  totalTransitions,
  deficienciesFound,
  onClick,
}: TestRunCardProps) {
  const getStatusIcon = () => {
    switch (status) {
      case "running":
        return <PlayCircle className="w-5 h-5 text-blue-500 animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "pending":
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
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
      case "pending":
        return (
          <Badge className="bg-gray-500/20 text-gray-500 border-gray-500/30">
            Pending
          </Badge>
        );
    }
  };

  const successRate =
    totalTransitions > 0
      ? ((successfulTransitions / totalTransitions) * 100).toFixed(1)
      : "0";

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Card
      className="bg-[#1A1A1B]/50 border-gray-800/50 hover:border-[#00D9FF]/50 transition-all cursor-pointer group"
      onClick={onClick}
    >
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0 mt-1">{getStatusIcon()}</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-medium text-white truncate group-hover:text-[#00D9FF] transition-colors">
                {workflowName}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">
                  {format(startTime, "MMM dd, yyyy HH:mm")}
                </span>
                <span className="text-gray-600">•</span>
                <span className="text-xs text-gray-500 font-mono">
                  {runId.substring(0, 8)}
                </span>
              </div>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* Duration */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Duration</span>
            </div>
            <div className="text-lg font-bold text-white">
              {formatDuration(duration)}
            </div>
          </div>

          {/* Coverage */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Coverage</span>
            </div>
            <div className="text-lg font-bold text-[#00D9FF]">
              {coveragePercentage.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">
              {statesCovered} / {totalStates} states
            </div>
          </div>

          {/* Success Rate */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Success</span>
            </div>
            <div className="text-lg font-bold text-green-500">{successRate}%</div>
            <div className="text-xs text-gray-500">
              {successfulTransitions} / {totalTransitions}
            </div>
          </div>

          {/* Deficiencies */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Issues</span>
            </div>
            <div
              className={`text-lg font-bold ${deficienciesFound > 0 ? "text-red-400" : "text-gray-500"}`}
            >
              {deficienciesFound}
            </div>
          </div>
        </div>

        {/* Progress Bar (for running tests) */}
        {status === "running" && totalTransitions > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Progress</span>
              <span className="text-white font-medium">
                {successfulTransitions + (totalTransitions - successfulTransitions)} /{" "}
                {totalTransitions} transitions
              </span>
            </div>
            <Progress
              value={
                totalTransitions > 0
                  ? (successfulTransitions / totalTransitions) * 100
                  : 0
              }
              className="h-1.5 bg-gray-800"
            />
          </div>
        )}

        {/* Coverage Progress Bar (for all tests) */}
        {status !== "running" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">State Coverage</span>
              <span className="text-white font-medium">
                {statesCovered} / {totalStates}
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] rounded-full transition-all"
                style={{ width: `${coveragePercentage}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
