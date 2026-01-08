"use client";

/**
 * VariableHistory - Timeline view of variable changes
 *
 * Features:
 * - Timeline visualization of variable changes
 * - Shows old → new value transitions
 * - Timestamps with relative time
 * - Action that caused the change
 * - Highlights changed values
 * - Diff view for complex objects
 * - Filter by variable name
 * - Change type badges (created/updated/deleted)
 */

import { useState, useMemo } from "react";
import { useVariableHistory } from "@/hooks/useWorkflowVariables";
import type { VariableChange, VariableScope } from "@/types/workflow-variables";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  Clock,
  ArrowRight,
  Plus,
  Edit,
  Trash2,
  Activity,
  Database,
  Globe,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface VariableHistoryProps {
  /** Workflow run ID */
  runId: string;

  /** Auto-refresh interval in milliseconds (default: 1000ms, 0 = disabled) */
  refreshInterval?: number;
}

/**
 * Get icon for variable scope
 */
function getScopeIcon(scope: VariableScope) {
  switch (scope) {
    case "execution":
      return <Activity className="w-3 h-3" />;
    case "workflow":
      return <Database className="w-3 h-3" />;
    case "global":
      return <Globe className="w-3 h-3" />;
  }
}

/**
 * Get icon and color for change type
 */
function getChangeTypeInfo(changeType: string): {
  icon: React.ReactNode;
  color: string;
  label: string;
} {
  switch (changeType) {
    case "created":
      return {
        icon: <Plus className="w-3 h-3" />,
        color: "text-green-500",
        label: "Created",
      };
    case "updated":
      return {
        icon: <Edit className="w-3 h-3" />,
        color: "text-brand-primary",
        label: "Updated",
      };
    case "deleted":
      return {
        icon: <Trash2 className="w-3 h-3" />,
        color: "text-red-500",
        label: "Deleted",
      };
    default:
      return {
        icon: <Edit className="w-3 h-3" />,
        color: "text-text-muted",
        label: "Changed",
      };
  }
}

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 1) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

/**
 * Detect if value is complex (object or array)
 */
function isComplexValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * ChangeItem - Single change entry in the timeline
 */
function ChangeItem({ change }: { change: VariableChange }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const changeInfo = getChangeTypeInfo(change.change_type);
  const hasComplexValue =
    isComplexValue(change.old_value) || isComplexValue(change.new_value);

  return (
    <div className="relative pb-8 last:pb-0">
      {/* Timeline line */}
      <div className="absolute left-4 top-8 bottom-0 w-px bg-surface-raised" />

      {/* Change card */}
      <div className="flex gap-4">
        {/* Timeline dot */}
        <div
          className={`relative flex-shrink-0 w-8 h-8 rounded-full bg-surface-raised border-2 ${changeInfo.color.replace("text-", "border-")} flex items-center justify-center`}
        >
          {changeInfo.icon}
        </div>

        {/* Change content */}
        <div className="flex-1 bg-surface-raised/50 rounded-lg p-4 border border-border-default">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant="outline"
                  className={`${changeInfo.color} gap-1`}
                >
                  {changeInfo.icon}
                  {changeInfo.label}
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  {getScopeIcon(change.scope)}
                  {change.scope}
                </Badge>
              </div>
              <h4 className="text-white font-mono font-semibold">
                {change.variable_name}
              </h4>
              {change.action_name && (
                <p className="text-sm text-text-muted mt-1">
                  by action:{" "}
                  <span className="text-text-secondary">
                    {change.action_name}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-xs text-text-muted">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(change.timestamp)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {new Date(change.timestamp).toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {hasComplexValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-6 w-6 p-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Value change */}
          {change.change_type === "created" && (
            <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded">
              <div className="text-xs text-green-400 mb-1">New value:</div>
              <div className="font-mono text-sm text-white">
                {isExpanded || !hasComplexValue ? (
                  <pre className="overflow-x-auto">
                    {formatValue(change.new_value)}
                  </pre>
                ) : (
                  <div className="truncate">
                    {formatValue(change.new_value)}
                  </div>
                )}
              </div>
            </div>
          )}

          {change.change_type === "deleted" && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded">
              <div className="text-xs text-red-400 mb-1">Previous value:</div>
              <div className="font-mono text-sm text-white line-through opacity-50">
                {isExpanded || !hasComplexValue ? (
                  <pre className="overflow-x-auto">
                    {formatValue(change.old_value)}
                  </pre>
                ) : (
                  <div className="truncate">
                    {formatValue(change.old_value)}
                  </div>
                )}
              </div>
            </div>
          )}

          {change.change_type === "updated" && (
            <div className="mt-3 space-y-2">
              {/* Old value */}
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded">
                <div className="text-xs text-red-400 mb-1">Previous value:</div>
                <div className="font-mono text-sm text-text-secondary">
                  {isExpanded || !hasComplexValue ? (
                    <pre className="overflow-x-auto">
                      {formatValue(change.old_value)}
                    </pre>
                  ) : (
                    <div className="truncate">
                      {formatValue(change.old_value)}
                    </div>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ArrowRight className="w-4 h-4 text-text-muted" />
              </div>

              {/* New value */}
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded">
                <div className="text-xs text-green-400 mb-1">New value:</div>
                <div className="font-mono text-sm text-white">
                  {isExpanded || !hasComplexValue ? (
                    <pre className="overflow-x-auto">
                      {formatValue(change.new_value)}
                    </pre>
                  ) : (
                    <div className="truncate">
                      {formatValue(change.new_value)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Change metadata */}
          {change.action_id && (
            <div className="mt-3 text-xs text-text-muted">
              Action ID: {change.action_id}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VariableHistory({
  runId,
  refreshInterval = 1000,
}: VariableHistoryProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, error } = useVariableHistory(runId, refreshInterval);

  // Filter changes
  const filteredChanges = useMemo(() => {
    if (!data?.history?.changes) return [];

    return data.history.changes.filter((change) => {
      if (
        searchTerm &&
        !change.variable_name.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [data, searchTerm]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
        <span className="ml-3 text-text-muted">Loading change history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mr-3" />
        <div>
          <p className="text-red-500 font-medium">
            Failed to load change history
          </p>
          <p className="text-sm text-text-muted mt-2">
            {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            placeholder="Search by variable name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-surface-canvas border-border-default"
          />
        </div>
      </div>

      {/* Timeline */}
      <ScrollArea className="h-[500px]">
        {filteredChanges.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-16 h-16 mx-auto text-text-muted mb-4" />
            <h3 className="text-xl font-semibold text-text-secondary mb-2">
              {searchTerm ? "No matching changes" : "No changes yet"}
            </h3>
            <p className="text-text-muted">
              {searchTerm
                ? "Try a different search term"
                : "Variable changes will appear here during workflow execution"}
            </p>
          </div>
        ) : (
          <div className="pl-4">
            {filteredChanges.map((change) => (
              <ChangeItem key={change.id} change={change} />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Stats footer */}
      {filteredChanges.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border-subtle text-sm text-text-muted">
          Showing {filteredChanges.length} of {data?.history?.total || 0}{" "}
          changes
        </div>
      )}
    </div>
  );
}
