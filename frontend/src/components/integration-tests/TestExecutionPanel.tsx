"use client";

import React from "react";
import { Play, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { TestExecutionPanelProps } from "@/types/integration-tests";

export const TestExecutionPanel: React.FC<TestExecutionPanelProps> = ({
  execution,
  totalWorkflows,
  completedWorkflows,
}) => {
  const getStatusIcon = () => {
    if (!execution) return <Play className="w-4 h-4" />;

    switch (execution.status) {
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
      case "passed":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Play className="w-4 h-4" />;
    }
  };

  const getStatusText = () => {
    if (!execution) return "Ready to run";

    switch (execution.status) {
      case "pending":
        return "Waiting to start";
      case "running":
        return "Running";
      case "passed":
        return "Completed successfully";
      case "failed":
        return "Failed";
      default:
        return "Unknown status";
    }
  };

  const getProgressPercentage = (): number => {
    if (!execution || !execution.totalActions) return 0;
    if (!execution.currentAction) return 0;
    return Math.floor((execution.currentAction / execution.totalActions) * 100);
  };

  const getOverallProgress = (): number => {
    if (totalWorkflows === 0) return 0;
    return Math.floor((completedWorkflows / totalWorkflows) * 100);
  };

  return (
    <Card className="bg-white border border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {getStatusIcon()}
          Execution
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!execution ? (
          <div className="text-center py-8 text-gray-500">
            <Play className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No test running</p>
            <p className="text-xs mt-1">
              Select workflows and click Run All to start
            </p>
          </div>
        ) : (
          <>
            {/* Current Workflow */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">
                  Current Workflow
                </span>
                <span className="text-xs text-gray-500">
                  {completedWorkflows + 1} of {totalWorkflows}
                </span>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-2">
                  {execution.status === "running" && (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-blue-900 truncate">
                      {execution.workflowName}
                    </p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      {getStatusText()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Current Action */}
            {execution.status === "running" &&
              execution.currentAction &&
              execution.totalActions && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-medium">
                      Current Action
                    </span>
                    <span className="text-xs text-gray-500">
                      Action {execution.currentAction} of {execution.totalActions}
                    </span>
                  </div>
                  <Progress value={getProgressPercentage()} className="h-2" />
                </div>
              )}

            {/* Overall Progress */}
            {totalWorkflows > 1 && (
              <div className="pt-3 border-t space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium">
                    Overall Progress
                  </span>
                  <span className="text-xs text-gray-500">
                    {getOverallProgress()}%
                  </span>
                </div>
                <Progress value={getOverallProgress()} className="h-2" />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TestExecutionPanel;
