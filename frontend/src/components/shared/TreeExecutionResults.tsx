"use client";

/**
 * TreeExecutionResults - Displays execution results from real TreeEvents
 *
 * This component is designed to display live or historical execution data
 * from qontinui-runner TreeEvents. It can be used by:
 * - Integration testing page (historical execution view)
 * - Monitor page (live execution view)
 *
 * Uses the UnifiedStepCard for consistent display across all execution views.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Route,
  Activity,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { UnifiedStepCard } from "./UnifiedStepCard";
import type {
  DisplayNode,
  TreeEvent,
  NodeStatus,
} from "@/types/tree-events";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import {
  treeEventsToUnifiedSteps,
  displayNodesToUnifiedSteps,
} from "@/lib/tree-event-adapter";

interface TreeExecutionResultsProps {
  /** Display nodes from the execution tree (hierarchical view) */
  displayNodes?: DisplayNode[];
  /** Raw TreeEvents (chronological view) */
  treeEvents?: TreeEvent[];
  /** Pre-converted unified steps (if already converted) */
  unifiedSteps?: UnifiedExecutionStep[];
  /** Workflow name for the header */
  workflowName?: string;
  /** Overall execution status */
  status?: NodeStatus | "running" | "completed" | "failed" | "pending";
  /** Total duration in milliseconds */
  durationMs?: number;
  /** Initial states */
  initialStates?: string[];
  /** Final states */
  finalStates?: string[];
  /** Whether this is a live execution (shows "Live" badge) */
  isLive?: boolean;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
  /** Callback when a step is clicked */
  onStepClick?: (step: UnifiedExecutionStep, index: number) => void;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

export function TreeExecutionResults({
  displayNodes,
  treeEvents,
  unifiedSteps: providedSteps,
  workflowName = "Execution",
  status = "pending",
  durationMs = 0,
  initialStates = [],
  finalStates = [],
  isLive = false,
  nameMap,
  onStepClick,
}: TreeExecutionResultsProps) {
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);

  // Convert data to unified steps
  const unifiedSteps = useMemo(() => {
    if (providedSteps) return providedSteps;
    if (treeEvents && treeEvents.length > 0) {
      return treeEventsToUnifiedSteps(treeEvents);
    }
    if (displayNodes && displayNodes.length > 0) {
      return displayNodesToUnifiedSteps(displayNodes);
    }
    return [];
  }, [providedSteps, treeEvents, displayNodes]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalActions = unifiedSteps.filter(s => s.nodeType === "action").length;
    const successfulActions = unifiedSteps.filter(
      s => s.nodeType === "action" && s.status === "success"
    ).length;
    const failedActions = unifiedSteps.filter(
      s => s.nodeType === "action" && s.status === "failed"
    ).length;

    return {
      totalSteps: unifiedSteps.length,
      totalActions,
      successfulActions,
      failedActions,
    };
  }, [unifiedSteps]);

  const handleStepToggle = (index: number) => {
    setExpandedStepIndex(expandedStepIndex === index ? null : index);
    if (onStepClick && unifiedSteps[index]) {
      onStepClick(unifiedSteps[index], index);
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case "success":
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
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl text-white">{workflowName}</CardTitle>
              {getStatusBadge()}
              {isLive && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 animate-pulse">
                  <Activity className="w-3 h-3 mr-1" />
                  Live
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Statistics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBadge
              icon={<Route className="w-4 h-4" />}
              label="Total Steps"
              value={String(stats.totalSteps)}
              color="blue"
            />
            <StatBadge
              icon={<Activity className="w-4 h-4" />}
              label="Actions"
              value={`${stats.successfulActions}/${stats.totalActions}`}
              color={stats.failedActions > 0 ? "yellow" : "green"}
            />
            <StatBadge
              icon={<Clock className="w-4 h-4" />}
              label="Duration"
              value={formatDuration(durationMs)}
              color="gray"
            />
            <StatBadge
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Failed"
              value={String(stats.failedActions)}
              color={stats.failedActions > 0 ? "red" : "gray"}
            />
          </div>

          {/* Initial and Final States */}
          {(initialStates.length > 0 || finalStates.length > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-800/50">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-400 mb-2">Initial States</div>
                  <div className="flex flex-wrap gap-1">
                    {initialStates.length > 0 ? (
                      initialStates.map((state) => (
                        <Badge
                          key={state}
                          variant="outline"
                          className="text-xs border-blue-500/30 text-blue-400"
                        >
                          {nameMap?.get(state) ?? state}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500">None</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-2">Final States</div>
                  <div className="flex flex-wrap gap-1">
                    {finalStates.length > 0 ? (
                      finalStates.map((state) => (
                        <Badge
                          key={state}
                          variant="outline"
                          className="text-xs border-green-500/30 text-green-400"
                        >
                          {nameMap?.get(state) ?? state}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500">None</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Steps List */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Route className="w-5 h-5" />
              Execution Steps
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {unifiedSteps.length} steps
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {unifiedSteps.length === 0 ? (
            <div className="py-12 text-center">
              <Route className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                No Execution Steps
              </h3>
              <p className="text-sm text-gray-500">
                {isLive
                  ? "Waiting for execution events..."
                  : "No execution data available."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {unifiedSteps.map((step, index) => (
                <UnifiedStepCard
                  key={step.nodeId || `step-${index}`}
                  step={step}
                  isExpanded={expandedStepIndex === index}
                  onToggle={() => handleStepToggle(index)}
                  isCurrent={isLive && index === unifiedSteps.length - 1}
                  nameMap={nameMap}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Stat badge component for the summary header
 */
interface StatBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "blue" | "purple" | "green" | "yellow" | "red" | "gray";
}

function StatBadge({ icon, label, value, color }: StatBadgeProps) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    gray: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${colorClasses[color]}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    </div>
  );
}

export default TreeExecutionResults;
