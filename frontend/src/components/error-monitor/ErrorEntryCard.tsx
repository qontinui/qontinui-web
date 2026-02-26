"use client";

import { useState } from "react";
import type { ErrorMonitorEntry } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Loader2,
  AlertCircle,
  Info,
  Clock,
  ChevronDown,
  ChevronUp,
  Eye,
  CheckCircle2,
  Bug,
  X,
} from "lucide-react";

// =============================================================================
// Helpers
// =============================================================================

export function getSeverityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "error":
      return <Bug className="w-4 h-4 text-red-400" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "info":
      return <Info className="w-4 h-4 text-blue-400" />;
    default:
      return <Info className="w-4 h-4 text-text-muted" />;
  }
}

export function getSeverityBadgeVariant(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
    case "error":
      return "destructive" as const;
    case "warning":
      return "warning" as const;
    case "info":
      return "info" as const;
    default:
      return "secondary" as const;
  }
}

export function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case "new":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "acknowledged":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "in_progress":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "resolved":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "ignored":
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    case "recurring":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

export function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

export function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// =============================================================================
// ErrorEntryCard Component
// =============================================================================

export interface ErrorEntryCardProps {
  entry: ErrorMonitorEntry;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number, notes?: string) => void;
  acknowledging?: boolean;
  resolving?: boolean;
}

export function ErrorEntryCard({
  entry,
  onAcknowledge,
  onResolve,
  acknowledging,
  resolving,
}: ErrorEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [showResolveForm, setShowResolveForm] = useState(false);

  const isActionable =
    entry.status !== "resolved" && entry.status !== "ignored";
  const isNew = entry.status === "new";

  return (
    <div
      className={`rounded-lg border transition-colors ${
        entry.severity.toLowerCase() === "critical"
          ? "border-red-500/40 bg-red-950/15"
          : entry.severity.toLowerCase() === "error"
            ? "border-red-500/30 bg-red-950/10"
            : entry.severity.toLowerCase() === "warning"
              ? "border-amber-500/20 bg-amber-950/5"
              : "border-border-subtle/50 bg-surface-canvas/50"
      }`}
    >
      {/* Main row */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {getSeverityIcon(entry.severity)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge
                  variant={getSeverityBadgeVariant(entry.severity)}
                  className="text-[10px] px-1.5 py-0"
                >
                  {entry.severity.toUpperCase()}
                </Badge>
                {entry.error_type && (
                  <span className="text-xs text-text-muted font-mono">
                    {entry.error_type}
                  </span>
                )}
                <Badge
                  className={`text-[10px] px-1.5 py-0 border ${getStatusColor(entry.status)}`}
                >
                  {formatStatusLabel(entry.status)}
                </Badge>
                {entry.occurrence_count > 1 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    x{entry.occurrence_count}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-text-primary break-words line-clamp-2">
                {entry.message}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-text-muted font-mono">
                  {entry.log_source_name}
                </span>
                {entry.location && entry.location.file && (
                  <span className="text-xs text-text-muted font-mono">
                    {entry.location.file}
                    {entry.location.line ? `:${entry.location.line}` : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(entry.captured_at)}
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 space-y-3 bg-surface-canvas/10">
          {/* Full message */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-1">Message</p>
            <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono bg-surface-canvas/30 rounded p-2">
              {entry.message}
            </pre>
          </div>

          {/* Stack trace */}
          {entry.stack_trace && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Stack Trace
              </p>
              <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {entry.stack_trace}
              </pre>
            </div>
          )}

          {/* Context lines */}
          {entry.context_lines && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Context
              </p>
              <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                {entry.context_lines}
              </pre>
            </div>
          )}

          {/* Resolution notes */}
          {entry.resolution_notes && (
            <div className="bg-green-950/20 border border-green-500/30 rounded-lg p-3">
              <p className="text-xs font-medium text-green-400 mb-1">
                Resolution Notes
              </p>
              <p className="text-sm text-green-300">{entry.resolution_notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-xs text-text-muted">
            <span>First seen: {formatTimestamp(entry.first_seen_at)}</span>
            <span>Last seen: {formatTimestamp(entry.last_seen_at)}</span>
            <span>Occurrences: {entry.occurrence_count}</span>
            {entry.error_code && <span>Code: {entry.error_code}</span>}
            {entry.signature_hash && (
              <span className="font-mono">
                Hash: {entry.signature_hash.slice(0, 12)}...
              </span>
            )}
          </div>

          {/* Action buttons */}
          {isActionable && (
            <div className="flex items-center gap-2 pt-1">
              {isNew && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcknowledge(entry.id);
                  }}
                  disabled={acknowledging}
                >
                  {acknowledging ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 mr-1" />
                  )}
                  Acknowledge
                </Button>
              )}
              {!showResolveForm ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowResolveForm(true);
                  }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Mark Resolved
                </Button>
              ) : (
                <div
                  className="flex-1 flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Textarea
                    placeholder="Resolution notes (optional)..."
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    rows={1}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1 resize-none"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                    disabled={resolving}
                    onClick={() => {
                      onResolve(entry.id, resolveNotes || undefined);
                      setShowResolveForm(false);
                      setResolveNotes("");
                    }}
                  >
                    {resolving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-text-muted"
                    onClick={() => setShowResolveForm(false)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
