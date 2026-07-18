"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  GitCompareArrows,
  History,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DevenvApiError,
  getConfigHistory,
  getConfigHistoryDiff,
  type ConfigHistoryDiff,
  type ConfigHistoryEntry,
  type KeyDelta,
  type SectionDrift,
  type Severity,
} from "@/services/devenv-api";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

function severityVariant(severity: Severity): BadgeVariant {
  switch (severity) {
    case "critical":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
    default:
      return "secondary";
  }
}

function formatCapturedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

interface MachineConfigHistoryProps {
  environmentId: string;
  machineId: string;
}

/**
 * Compact per-machine config-history panel: the capture timeline (newest
 * first — each entry is an actual change point, consecutive duplicates are
 * deduplicated server-side) with two-point selection and a self-drift diff
 * ("what changed going from → to") rendered as section → key deltas with
 * severity badges, mirroring the DriftMatrix visual language.
 */
export function MachineConfigHistory({
  environmentId,
  machineId,
}: MachineConfigHistoryProps) {
  const [entries, setEntries] = useState<ConfigHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [diff, setDiff] = useState<ConfigHistoryDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getConfigHistory(environmentId, machineId);
        if (cancelled) return;
        setEntries(list);
        // Preselect the two most recent captures (from = older of the two).
        const [newest, previous] = list;
        if (newest && previous) {
          setToId(newest.id);
          setFromId(previous.id);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(errMessage(err, "Failed to load config history"));
          setEntries([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId, machineId]);

  const compare = useCallback(async () => {
    if (!fromId || !toId) return;
    setDiffLoading(true);
    setDiff(null);
    try {
      const report = await getConfigHistoryDiff(
        environmentId,
        machineId,
        fromId,
        toId
      );
      setDiff(report);
    } catch (err) {
      toast.error(errMessage(err, "Failed to diff captures"));
    } finally {
      setDiffLoading(false);
    }
  }, [environmentId, machineId, fromId, toId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="rounded-md border border-border p-4 text-center">
        <History className="size-5 mx-auto mb-1 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          No captures recorded yet. History accumulates as the agent reports
          config changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Capture timeline, newest first, with from/to pickers. */}
      <div className="rounded-md border border-border divide-y divide-border">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="w-16 shrink-0">Compare</span>
          <span className="flex-1">Captured</span>
          <span className="shrink-0">Source</span>
          <span className="w-20 shrink-0 text-right">Hash</span>
        </div>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 px-3 py-2 text-xs"
          >
            <span className="w-16 shrink-0 flex items-center gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`history-from-${machineId}`}
                  checked={fromId === entry.id}
                  onChange={() => setFromId(entry.id)}
                  aria-label={`Diff from ${formatCapturedAt(entry.captured_at)}`}
                />
                <span className="text-muted-foreground">A</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`history-to-${machineId}`}
                  checked={toId === entry.id}
                  onChange={() => setToId(entry.id)}
                  aria-label={`Diff to ${formatCapturedAt(entry.captured_at)}`}
                />
                <span className="text-muted-foreground">B</span>
              </label>
            </span>
            <span className="flex-1 truncate">
              {formatCapturedAt(entry.captured_at)}
            </span>
            <Badge variant="secondary" className="shrink-0">
              {entry.source}
            </Badge>
            <span className="w-20 shrink-0 text-right font-mono text-muted-foreground">
              {entry.content_hash.slice(0, 8)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={compare}
          disabled={!fromId || !toId || fromId === toId || diffLoading}
        >
          {diffLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GitCompareArrows className="size-4" />
          )}
          Diff A → B
        </Button>
        {fromId === toId && fromId !== null && (
          <span className="text-xs text-muted-foreground">
            Pick two different captures to diff.
          </span>
        )}
      </div>

      {diff && <HistoryDiffView diff={diff} />}
    </div>
  );
}

function HistoryDiffView({ diff }: { diff: ConfigHistoryDiff }) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {formatCapturedAt(diff.from_captured_at)} →{" "}
          {formatCapturedAt(diff.to_captured_at)}
        </span>
        <Badge
          variant={diff.in_sync ? "success" : severityVariant(diff.severity)}
        >
          {diff.in_sync ? "no changes" : diff.severity}
        </Badge>
      </div>

      {diff.schema_version_mismatch && (
        <p className="text-xs text-warning">
          Schema version changed:{" "}
          <span className="font-mono">
            {diff.expected_schema_version ?? "?"}
          </span>{" "}
          →{" "}
          <span className="font-mono">{diff.actual_schema_version ?? "?"}</span>
        </p>
      )}

      {diff.in_sync ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="size-4 text-success" />
          These two captures are identical.
        </p>
      ) : (
        diff.sections.map((section) => (
          <HistorySectionDiff key={section.section} section={section} />
        ))
      )}
    </div>
  );
}

function HistorySectionDiff({ section }: { section: SectionDrift }) {
  return (
    <div className="rounded-sm border border-border">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-muted/30">
        <span className="text-xs font-mono truncate">{section.section}</span>
        <Badge variant={severityVariant(section.severity)}>
          {section.severity}
        </Badge>
      </div>
      <div className="divide-y divide-border">
        {section.deltas.map((delta) => (
          <HistoryDeltaRow key={delta.key} delta={delta} />
        ))}
      </div>
    </div>
  );
}

function HistoryDeltaRow({ delta }: { delta: KeyDelta }) {
  return (
    <div className="px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-medium truncate">{delta.key}</span>
        <Badge variant={severityVariant(delta.severity)}>{delta.status}</Badge>
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <span className="text-muted-foreground">was: </span>
          <span className="font-mono break-all">{delta.expected ?? "—"}</span>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">now: </span>
          <span className="font-mono break-all">{delta.actual ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
