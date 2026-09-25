"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTranscriptSyncPolicy } from "../_hooks/useTranscriptSyncPolicy";

/**
 * The tenant's transcript-sync consent (`coord.tenant_policies.transcript_sync_enabled`).
 *
 * Three states the panel keeps apart, because collapsing any of them into a
 * plain on/off would misreport what coord enforces:
 *
 * * `transcript_sync_enabled: null` — coord did not report the flag. UNKNOWN.
 * * `column_missing` — coord is refusing output only because the column is not
 *   provisioned yet (fail closed). Nobody chose "off".
 * * a failed read-back after a write — the write landed; what coord now
 *   enforces is UNKNOWN until a refresh.
 */
export function TranscriptSyncPanel() {
  const [pending, setPending] = useState<boolean | null>(null);
  const { policy, loading, saving, error, readbackError, reload, setEnabled } =
    useTranscriptSyncPolicy();

  const current = policy?.transcript_sync_enabled ?? null;
  const canEdit = policy?.can_edit === true;
  const columnMissing = policy?.column_missing === true;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="transcript-sync-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ScrollText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Transcript sync</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Whether coord accepts session output — terminal (PTY) output and
              agent transcripts — from this tenant&apos;s runners. Accepted
              output is redacted on the runner, kept in a warm tier, then
              archived to a cold tier that expires after 90 days. Turning this
              off makes coord refuse every chunk on both streams; runners stop
              publishing for a session once refused.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              This is one of three gates, and all three must allow it: the
              runner&apos;s own cloud-sync setting and each session&apos;s
              share-output choice still apply. Turning this on does not by
              itself start capturing anything.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="transcript-sync-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {([true, false] as const).map((value) => (
              <Button
                key={String(value)}
                size="sm"
                variant={current === value ? "default" : "outline"}
                disabled={saving || !canEdit}
                onClick={() => {
                  setPending(value);
                  setEnabled(value).finally(() => setPending(null));
                }}
                data-testid={`transcript-sync-${value ? "on" : "off"}`}
              >
                {/* Only the value being written spins. */}
                {saving && pending === value && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {value ? "On" : "Off"}
              </Button>
            ))}
            <div className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Coord enforces</span>
              <Badge
                variant={current === true ? "default" : "outline"}
                data-testid="transcript-sync-effective"
              >
                {current === null ? "unknown" : current ? "on" : "off"}
              </Badge>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="transcript-sync-readonly"
            >
              {policy
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {policy && current === null && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="transcript-sync-unreported"
            >
              Coord did not report this setting, so whether it accepts session
              output for this tenant is unknown.
            </p>
          )}

          {columnMissing && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="transcript-sync-column-missing"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Coord is refusing session output because this setting&apos;s
                database column has not been provisioned yet. It fails closed
                until the migration lands. Nobody turned it off.
              </p>
            </div>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="transcript-sync-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                After the last write, {readbackError}. The value above is the
                last one confirmed and may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="transcript-sync-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the transcript sync setting: {error}.{" "}
                {policy
                  ? "Showing the last value read, which may be out of date."
                  : "The current value is unknown."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
