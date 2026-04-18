"use client";

/**
 * ExecutionHistoryView
 *
 * Displays historical execution data for a specific run using TreeEvents.
 * This component fetches data from the REST API and displays it using
 * the shared TreeExecutionResults component.
 */

import { useTreeEvents } from "@/hooks/useTreeEvents";
import { TreeExecutionResults } from "@/components/shared/TreeExecutionResults";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, History, ArrowLeft } from "lucide-react";
import type { DisplayNode, NodeStatus, NodeType } from "@/types/tree-events";

interface ExecutionHistoryViewProps {
  /** Execution run ID to display */
  runId: string;
  /** Callback when back button is clicked */
  onBack?: () => void;
  /** Whether to show the back button */
  showBackButton?: boolean;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
}

/**
 * Convert API display nodes to the format expected by TreeExecutionResults
 */
interface ApiNode {
  id: string;
  node_type: string;
  name: string;
  timestamp: number;
  end_timestamp?: number | null;
  duration?: number | null;
  status: string;
  metadata: Record<string, unknown>;
  error?: string | null;
  children: unknown[];
  is_expanded: boolean;
  level: number;
}

function convertApiNodes(apiNodes: ApiNode[]): DisplayNode[] {
  function convert(node: ApiNode): DisplayNode {
    return {
      id: node.id,
      nodeType: node.node_type as NodeType,
      name: node.name,
      timestamp: node.timestamp,
      endTimestamp: node.end_timestamp ?? null,
      duration: node.duration ?? null,
      status: node.status as NodeStatus,
      metadata: { isExpandable: false, isInline: false, ...node.metadata },
      error: node.error ?? null,
      children: (node.children as ApiNode[]).map(convert),
      isExpanded: node.is_expanded,
      level: node.level,
    };
  }

  return apiNodes.map(convert);
}

export function ExecutionHistoryView({
  runId,
  onBack,
  showBackButton = true,
  nameMap,
}: ExecutionHistoryViewProps) {
  const {
    tree,
    rootNodes,
    isLoading,
    error,
    workflowName,
    status,
    durationMs,
    initialStateIds,
    stateNameMap,
    refresh,
  } = useTreeEvents({ runId, autoFetch: true });

  // Convert API nodes to DisplayNode format
  const displayNodes = convertApiNodes(rootNodes);

  // Use initial states from API (stored when workflow started), fall back to extracting from tree
  const { initialStates: extractedInitialStates, finalStates } =
    extractStates(displayNodes);
  const initialStates =
    initialStateIds.length > 0 ? initialStateIds : extractedInitialStates;

  if (error) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle">
        <CardContent className="py-12">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h3 className="text-lg font-medium text-white mb-2">
              Failed to Load Execution
            </h3>
            <p className="text-sm text-text-muted mb-4">{error.message}</p>
            <Button
              variant="outline"
              onClick={refresh}
              className="border-border-default"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading && !tree) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <Card className="bg-surface-raised/50 border-border-subtle">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-7 w-48 bg-surface-raised" />
                <Skeleton className="h-6 w-20 bg-surface-raised" />
              </div>
              <Skeleton className="h-9 w-24 bg-surface-raised" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20 bg-surface-raised" />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Steps skeleton */}
        <Card className="bg-surface-raised/50 border-border-subtle">
          <CardHeader>
            <Skeleton className="h-6 w-32 bg-surface-raised" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 bg-surface-raised" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showBackButton && onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-text-muted" />
            <span className="text-sm text-text-muted">Run ID:</span>
            <Badge variant="outline" className="font-mono text-xs">
              {runId.slice(0, 8)}...
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
          className="border-border-default"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Execution Results */}
      {tree ? (
        <TreeExecutionResults
          displayNodes={displayNodes}
          workflowName={workflowName || "Execution"}
          status={(status as NodeStatus) || "pending"}
          durationMs={durationMs || 0}
          initialStates={initialStates}
          finalStates={finalStates}
          isLive={false}
          nameMap={
            // Merge parent nameMap with stateNameMap from API (API takes precedence)
            nameMap
              ? new Map([...nameMap, ...stateNameMap])
              : stateNameMap.size > 0
                ? stateNameMap
                : undefined
          }
        />
      ) : (
        <Card className="bg-surface-raised/50 border-border-subtle">
          <CardContent className="py-12">
            <div className="text-center">
              <History className="w-12 h-12 mx-auto mb-4 text-text-muted" />
              <h3 className="text-lg font-medium text-text-muted mb-2">
                No Execution Data
              </h3>
              <p className="text-sm text-text-muted">
                No tree events found for this execution run.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Extract initial and final states from the execution tree
 */
function extractStates(nodes: DisplayNode[]): {
  initialStates: string[];
  finalStates: string[];
} {
  const initialStates = new Set<string>();
  const finalStates = new Set<string>();

  function traverse(node: DisplayNode) {
    const stateContext = node.metadata?.state_context as
      | {
          active_before?: string[];
          active_after?: string[];
        }
      | undefined;

    if (stateContext?.active_before) {
      // First node's "before" states are initial states
      if (initialStates.size === 0) {
        stateContext.active_before.forEach((s) => initialStates.add(s));
      }
    }

    if (stateContext?.active_after) {
      // Keep updating final states as we traverse
      finalStates.clear();
      stateContext.active_after.forEach((s) => finalStates.add(s));
    }

    node.children?.forEach(traverse);
  }

  nodes.forEach(traverse);

  return {
    initialStates: Array.from(initialStates),
    finalStates: Array.from(finalStates),
  };
}

export default ExecutionHistoryView;
