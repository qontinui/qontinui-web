"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminDevService,
  type BackfillReport,
} from "@/services/admin-dev-service";

interface RunSweepDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fired after a successful "Run for real" so the page can refresh the table. */
  onCleared: () => void;
}

/**
 * "Run land-backfill sweep" dialog — the dashboard trigger for coord's
 * `POST /coord/gates/doctor/sweep` (`land_backfill` mode), which re-clears
 * `failed` `pr_merged`-on-coord gates whose work actually landed.
 *
 * Dry-run-first: on open it immediately runs `dryRun: true` and renders the
 * would-clear report. Only an explicit "Run for real" click fires the live
 * `dryRun: false` sweep, which mutates prod `coord.gates` and then triggers the
 * page's refresh via `onCleared`. Coord errors (e.g. a 403 when the operator
 * bearer lacks the `admin` role) are surfaced verbatim, never swallowed.
 */
export function RunSweepDialog({
  open,
  onOpenChange,
  onCleared,
}: RunSweepDialogProps) {
  const [report, setReport] = useState<BackfillReport | null>(null);
  // `loading` = the on-open dry run; `running` = the "Run for real" call.
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const r = await adminDevService.runGateDoctorSweep({ dryRun: true });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Kick off the dry run each time the dialog opens; reset on close so a
  // reopen always starts from a fresh dry-run preview.
  useEffect(() => {
    if (open) {
      runDryRun();
    } else {
      setReport(null);
      setError(null);
      setLoading(false);
      setRunning(false);
    }
  }, [open, runDryRun]);

  const runForReal = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await adminDevService.runGateDoctorSweep({ dryRun: false });
      setReport(r);
      toast.success(
        `Sweep complete — ${r.backfilled} cleared, ${r.left_failed} left failed`,
      );
      onCleared();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Sweep failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }, [onCleared]);

  const busy = loading || running;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="gates-run-sweep-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-5" />
            Run land-backfill sweep
          </DialogTitle>
          <DialogDescription>
            Re-clears <code className="font-mono">failed</code> gates whose{" "}
            <code className="font-mono">pr_merged</code> work actually landed on
            coord. A dry run previews the effect; &ldquo;Run for real&rdquo;
            mutates the live gates.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap break-words"
            data-testid="gates-run-sweep-error"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground"
            data-testid="gates-run-sweep-report"
          >
            <Loader2 className="size-4 animate-spin" />
            Running dry-run preview…
          </div>
        ) : report ? (
          <div className="space-y-3" data-testid="gates-run-sweep-report">
            <div className="flex items-center gap-2">
              <span className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                {report.dry_run ? "Dry run" : "Live run"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border px-2 py-2">
                <div className="text-lg font-semibold tabular-nums">
                  {report.examined}
                </div>
                <div className="text-xs text-muted-foreground">examined</div>
              </div>
              <div className="rounded-md border border-border px-2 py-2">
                <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {report.backfilled}
                </div>
                <div className="text-xs text-muted-foreground">
                  {report.dry_run ? "would clear" : "cleared"}
                </div>
              </div>
              <div className="rounded-md border border-border px-2 py-2">
                <div className="text-lg font-semibold tabular-nums">
                  {report.left_failed}
                </div>
                <div className="text-xs text-muted-foreground">left failed</div>
              </div>
            </div>

            {report.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground italic px-1 py-2">
                No gates to clear.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {report.entries.map((entry) => (
                  <div
                    key={entry.gate_id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs"
                  >
                    <span
                      className="font-mono tabular-nums text-muted-foreground"
                      title={entry.gate_id}
                    >
                      {entry.gate_id.slice(0, 8)}
                    </span>
                    <span className="font-mono text-foreground">
                      {entry.repo}#{entry.pr_number}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {entry.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={runForReal}
            disabled={busy || loading || !report}
            data-testid="gates-run-sweep-confirm"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wrench className="size-4" />
            )}
            Run for real
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
