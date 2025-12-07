"use client";

import React from "react";
import {
  CheckCircle,
  XCircle,
  ArrowLeft,
  Activity,
  Timer,
  Target,
  Zap,
  AlertCircle,
  Play,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WorkflowTestResult, StepResult } from "@/types/integration-tests";

interface TestResultsDetailPanelProps {
  result: WorkflowTestResult;
  onBack: () => void;
  onPlayback?: (historicalResultIds: number[]) => void;
}

/**
 * Detailed view of a single workflow test result.
 * Shows step-by-step execution results with timing and status.
 */
export const TestResultsDetailPanel: React.FC<TestResultsDetailPanelProps> = ({
  result,
  onBack,
  onPlayback,
}) => {
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const successRate =
    result.totalSteps > 0
      ? Math.round((result.successfulSteps / result.totalSteps) * 100)
      : 0;

  const hasPlayback =
    result.historicalResultIds && result.historicalResultIds.length > 0;

  return (
    <Card className="bg-white border border-gray-200 h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                {result.workflowName}
              </CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                Test completed in {formatDuration(result.duration)}
              </p>
            </div>
          </div>
          {hasPlayback && onPlayback && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPlayback(result.historicalResultIds!)}
              className="gap-2"
            >
              <Play className="w-4 h-4" />
              Visual Playback
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div
            className={`p-3 rounded-lg border ${
              result.passed
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <p className="text-xs text-gray-600 font-medium">Status</p>
            <p
              className={`text-lg font-bold ${
                result.passed ? "text-green-700" : "text-red-700"
              }`}
            >
              {result.passed ? "PASSED" : "FAILED"}
            </p>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-gray-600 font-medium">Success Rate</p>
            <p className="text-lg font-bold text-blue-700">{successRate}%</p>
          </div>
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-xs text-gray-600 font-medium">Steps</p>
            <p className="text-lg font-bold text-gray-700">
              {result.successfulSteps}/{result.totalSteps}
            </p>
          </div>
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <p className="text-xs text-gray-600 font-medium">Duration</p>
            <p className="text-lg font-bold text-purple-700">
              {formatDuration(result.duration)}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              successRate >= 80
                ? "bg-green-500"
                : successRate >= 50
                  ? "bg-yellow-500"
                  : "bg-red-500"
            }`}
            style={{ width: `${successRate}%` }}
          />
        </div>

        {/* Error Message (if any) */}
        {result.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-xs text-red-700 mt-1">{result.error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Step Results Timeline */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Step-by-Step Results
            </h3>
            <span className="text-xs text-gray-500">
              {result.stepResults?.length || 0} steps executed
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            {result.stepResults && result.stepResults.length > 0 ? (
              <div className="space-y-2">
                {result.stepResults.map((step, index) => (
                  <StepResultCard
                    key={step.actionId || index}
                    step={step}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No step details available</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Individual step result card component
 */
const StepResultCard: React.FC<{ step: StepResult; index: number }> = ({
  step,
  index,
}) => {
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getActionTypeIcon = (actionType: string) => {
    const type = actionType.toLowerCase();
    if (type.includes("find") || type.includes("wait")) {
      return <Target className="w-3.5 h-3.5" />;
    }
    if (
      type.includes("click") ||
      type.includes("type") ||
      type.includes("key")
    ) {
      return <Zap className="w-3.5 h-3.5" />;
    }
    return <Activity className="w-3.5 h-3.5" />;
  };

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        step.success
          ? "bg-white border-gray-200 hover:border-green-300"
          : "bg-red-50 border-red-200 hover:border-red-300"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Step Number & Status */}
        <div className="flex flex-col items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step.success
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {index + 1}
          </div>
          {step.success ? (
            <CheckCircle className="w-4 h-4 text-green-500 mt-1" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500 mt-1" />
          )}
        </div>

        {/* Step Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`${step.success ? "text-gray-500" : "text-red-500"}`}
              >
                {getActionTypeIcon(step.actionType)}
              </span>
              <span className="font-medium text-sm text-gray-900 truncate">
                {step.actionName}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Timer className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-500 font-mono">
                {formatDuration(step.duration)}
              </span>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <span
              className={`px-2 py-0.5 rounded-full font-medium ${
                step.success
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {step.actionType.toUpperCase()}
            </span>
            {step.patternName && (
              <span className="text-gray-500 truncate">
                Pattern:{" "}
                <span className="text-gray-700">{step.patternName}</span>
              </span>
            )}
          </div>

          {/* Message */}
          <p
            className={`mt-2 text-xs ${
              step.success ? "text-gray-600" : "text-red-600"
            }`}
          >
            {step.message}
          </p>

          {/* Historical data indicator */}
          {step.historicalResultId && (
            <div className="mt-2 flex items-center gap-1 text-xs text-purple-600">
              <Activity className="w-3 h-3" />
              <span>Using historical data #{step.historicalResultId}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestResultsDetailPanel;
