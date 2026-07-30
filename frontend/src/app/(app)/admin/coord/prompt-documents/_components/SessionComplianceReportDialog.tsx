"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";
import {
  ATTRIBUTION_META,
  ITEM_STATE_LABEL,
  RECONCILE_RESULT_META,
  VERDICT_META,
  isReportAbsent,
  type ComplianceReportItem,
  type ReconciliationItem,
  type SessionComplianceRow,
} from "../compliance-types";

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` closes the view. */
  row: SessionComplianceRow | null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Pair each reported item with coord's verdict on it, keyed by `ref`. */
function pairItems(
  row: SessionComplianceRow
): { reported: ComplianceReportItem; checked: ReconciliationItem | null }[] {
  const checked = new Map(
    (row.reconciliation?.items ?? []).map((i) => [i.ref, i])
  );
  return (row.report?.items ?? []).map((reported) => ({
    reported,
    checked: checked.get(reported.ref) ?? null,
  }));
}

/**
 * The stored report for one session, side by side with what coord could
 * actually establish about each claim.
 *
 * The pairing is the honest part: the left column is what the session SAID, the
 * right is what coord CHECKED. An item coord could only shape-check, or a gate
 * it could only attribute heuristically, is labelled as such rather than shown
 * with the same weight as a confirmed one — a guessed attribution displayed as
 * proof is worse than no attribution at all.
 */
export function SessionComplianceReportDialog({
  open,
  onOpenChange,
  row,
}: ReportDialogProps) {
  const paired = row ? pairItems(row) : [];
  const absent = row ? isReportAbsent(row) : false;
  const verdictMeta = row ? VERDICT_META[row.verdict] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-hidden"
        data-testid="compliance-report-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Compliance report
          </DialogTitle>
          <DialogDescription>
            {row ? (
              <>
                Session <code>{row.claude_session_id}</code>, checked{" "}
                {formatWhen(row.checked_at)}
                {row.prompt_document_version != null
                  ? ` against policy version ${row.prompt_document_version}`
                  : ""}
                .
              </>
            ) : (
              "No session selected."
            )}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              {verdictMeta && (
                <Badge variant={verdictMeta.variant}>{verdictMeta.label}</Badge>
              )}
              {absent && (
                <span className="text-xs text-muted-foreground">
                  no report was emitted
                </span>
              )}
            </div>
            {verdictMeta && (
              <p className="text-sm text-muted-foreground">
                {verdictMeta.detail}
              </p>
            )}
            {row.finalized === false && (
              <p className="text-sm text-muted-foreground">
                This session is still running. The verdict is rewritten at every
                turn end and settles when the session closes, so what you see
                here is a snapshot — unfinished work may simply not be finished{" "}
                <em>yet</em>.
              </p>
            )}

            {absent ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                This session closed without emitting a POLICY_COMPLIANCE block,
                so there is nothing to reconcile. That is recorded as unverified
                with the reason <code>absent</code> — the same verdict as a
                report whose claims didn&apos;t hold up, because in both cases
                the work was not shown to be finished.
              </div>
            ) : paired.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                The report carried no enumerated items.
              </div>
            ) : (
              <ul className="space-y-2" data-testid="compliance-report-items">
                {paired.map(({ reported, checked }, idx) => {
                  const resultMeta = checked
                    ? RECONCILE_RESULT_META[checked.result]
                    : null;
                  const attribution =
                    checked?.attribution && checked.attribution !== "session"
                      ? ATTRIBUTION_META[checked.attribution]
                      : null;
                  return (
                    <li
                      key={`${reported.ref}-${idx}`}
                      className="rounded-lg border border-border px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {reported.ref}
                        </span>
                        <Badge variant="outline">
                          {ITEM_STATE_LABEL[reported.state] ?? reported.state}
                        </Badge>
                        {resultMeta ? (
                          <Badge variant={resultMeta.variant}>
                            {resultMeta.label}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Not checked</Badge>
                        )}
                        {attribution && (
                          <Badge
                            variant="outline"
                            title={attribution.detail}
                            data-testid="attribution-badge"
                          >
                            {attribution.label}
                          </Badge>
                        )}
                      </div>
                      {reported.reason && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Stated reason: {reported.reason}
                        </p>
                      )}
                      {checked?.detail && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Coord checked: {checked.detail}
                        </p>
                      )}
                      {checked?.signals && checked.signals.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Signals matched: {checked.signals.join(", ")}
                        </p>
                      )}
                      {checked?.gate_id && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Gate <code>{checked.gate_id}</code>
                        </p>
                      )}
                      {attribution && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {attribution.detail}
                        </p>
                      )}
                      {checked?.result === "shape_checked" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Nothing observable can confirm this one — coord only
                          checked that a reason was given.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* The raw stored report — the audit trail, verbatim. */}
            {row.report && (
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  Stored report (raw)
                </summary>
                <pre className="max-h-72 overflow-auto border-t border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
                  {JSON.stringify(row.report, null, 2)}
                </pre>
              </details>
            )}
            {row.reconciliation && (
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  Coord&apos;s reconciliation (raw)
                </summary>
                <pre className="max-h-72 overflow-auto border-t border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
                  {JSON.stringify(row.reconciliation, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
