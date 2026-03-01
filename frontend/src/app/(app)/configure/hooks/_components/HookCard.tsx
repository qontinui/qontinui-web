"use client";

import { useState } from "react";
import { type Hook, type TestHookResponse } from "@/lib/runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Trash2,
  GripVertical,
  Pencil,
  Play,
  Pause,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  getTriggerInfo,
  getActionTypeInfo,
  getTriggerBadgeVariant,
  getActionSummary,
} from "../_lib";

interface HookCardProps {
  hook: Hook;
  onEdit: (hook: Hook) => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTest: (id: string) => void;
  testResult?: TestHookResponse | null;
  testing?: boolean;
  deleting?: boolean;
}

export function HookCard({
  hook,
  onEdit,
  onDelete,
  onToggleEnabled,
  onTest,
  testResult,
  testing,
  deleting,
}: HookCardProps) {
  const [expanded, setExpanded] = useState(false);
  const triggerInfo = getTriggerInfo(hook.trigger);
  const actionInfo = getActionTypeInfo(hook.action_type);
  const ActionIcon = actionInfo.icon;

  return (
    <div
      className={`rounded-lg border transition-all ${
        hook.enabled
          ? "border-border-subtle/50 bg-surface-canvas/30"
          : "border-border-subtle/30 bg-surface-canvas/10 opacity-60"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <GripVertical className="w-4 h-4 text-text-muted/40 mt-1 flex-shrink-0 cursor-grab" />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-semibold text-text-primary">
                {hook.name}
              </p>
              <Badge
                variant={getTriggerBadgeVariant(hook.trigger)}
                className="text-[10px] px-1.5 py-0"
              >
                {triggerInfo.label}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 flex items-center gap-1"
              >
                <ActionIcon className={`w-3 h-3 ${actionInfo.color}`} />
                {actionInfo.label}
              </Badge>
              {!hook.enabled && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Disabled
                </Badge>
              )}
              {!hook.continue_on_failure && (
                <Badge
                  variant="destructive"
                  className="text-[10px] px-1.5 py-0"
                >
                  Critical
                </Badge>
              )}
              {hook.conditions.length > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {hook.conditions.length} condition
                  {hook.conditions.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {hook.description && (
              <p className="text-xs text-text-muted italic truncate mb-1">
                {hook.description}
              </p>
            )}
            <p className="text-xs text-text-muted font-mono truncate">
              {getActionSummary(hook.action_type, hook.action_config)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => onToggleEnabled(hook.id, !hook.enabled)}
              title={hook.enabled ? "Disable" : "Enable"}
            >
              {hook.enabled ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-brand-primary hover:text-brand-primary/80"
              onClick={() => onTest(hook.id)}
              disabled={testing}
              title="Test Hook"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => onEdit(hook)}
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-red-400"
              onClick={() => onDelete(hook.id)}
              disabled={deleting}
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Test Result Toast */}
        {testResult && (
          <div
            className={`mt-3 p-3 rounded-lg border ${
              testResult.success
                ? "bg-green-950/20 border-green-500/30"
                : "bg-red-950/20 border-red-500/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span
                className={`text-sm font-medium ${testResult.success ? "text-green-400" : "text-red-400"}`}
              >
                {testResult.success ? "Test Passed" : "Test Failed"}
              </span>
              <span className="text-xs text-text-muted">
                ({testResult.duration_ms}ms)
              </span>
            </div>
            {testResult.output && (
              <pre className="text-xs text-text-muted font-mono mt-1 overflow-x-auto max-h-24 overflow-y-auto">
                {testResult.output}
              </pre>
            )}
            {testResult.error && (
              <p className="text-xs text-red-400 mt-1">{testResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 space-y-3 bg-surface-canvas/10">
          <div>
            <p className="text-xs font-medium text-text-muted mb-1">
              Action Configuration
            </p>
            <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
              {JSON.stringify(hook.action_config, null, 2)}
            </pre>
          </div>
          {hook.conditions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Conditions
              </p>
              <div className="space-y-1">
                {hook.conditions.map((c, i) => (
                  <p key={i} className="text-xs text-text-muted font-mono">
                    {c.variable} {c.operator} {JSON.stringify(c.value)}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-6 text-xs text-text-muted">
            <span>Order: {hook.execution_order}</span>
            <span>
              Created: {new Date(hook.created_at).toLocaleDateString()}
            </span>
            <span>
              Updated: {new Date(hook.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
