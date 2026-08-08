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
  NUDGE_FLOOR_CAVEAT,
  NUDGE_ZERO_AMBIGUITY,
  VERDICT_META,
  isReportAbsent,
  readNudges,
  resultBadge,
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
  const nudges = row
    ? readNudges(row)
    : ({ known: false, reason: "not_carried" } as const);

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
              <div
                className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
                data-testid="absent-explanation"
              >
                {/*
                  Whether the session CLOSED is a separate fact from whether a
                  report is absent, and only coord's `finalized` flag carries
                  it. This paragraph used to assert "This session closed"
                  for every absent row — which, for a still-running session,
                  contradicted the "still running" notice directly above it and
                  claimed an ending that had not happened.

                  It was unreachable until enforcement was switched on: while
                  every verdict was `not_applicable`, `absent` never rendered.
                  Under `mode: nudge` a verdict is rewritten at EVERY turn end,
                  so the mid-session absent row is now the common case, not the
                  edge one.

                  Three states, because `finalized` absent means UNKNOWN and
                  unknown may not be reported as either — the same rule the
                  sessions table applies to the "not final" marker.
                */}
                {row.finalized === true
                  ? "This session closed without emitting a POLICY_COMPLIANCE block, so there was nothing to reconcile."
                  : row.finalized === false
                    ? "This session has not emitted a POLICY_COMPLIANCE block as of this turn end, so there is nothing to reconcile yet — it may still emit one before it closes."
                    : "No POLICY_COMPLIANCE block has been recorded for this session, so there is nothing to reconcile."}{" "}
                That is recorded as unverified with the reason{" "}
                <code>absent</code> — the same verdict as a report whose claims
                didn&apos;t hold up, because in both cases the work was not
                shown to be finished.
                {/*
                  Whether the session was ASKED is the other half of an absent
                  row, and the half that says whether the mechanism is working:
                  a session that was never nudged and one that ignored three
                  nudges are the same verdict but completely different
                  problems. Only a positive count is stated as fact — see
                  `readNudges`.
                */}
                <p className="mt-2" data-testid="nudge-summary">
                  {nudges.known ? (
                    <>
                      Coord asked for the missing report{" "}
                      <strong>{nudges.atLeast}×</strong> ({NUDGE_FLOOR_CAVEAT})
                      {nudges.lastAt
                        ? `, most recently ${formatWhen(nudges.lastAt)}`
                        : ""}
                      .
                    </>
                  ) : nudges.reason === "none_recorded" ? (
                    NUDGE_ZERO_AMBIGUITY
                  ) : (
                    "Whether coord asked this session for the report isn't recorded — this view didn't receive the nudge counter."
                  )}
                </p>
              </div>
            ) : row.report == null ? (
              /* Not the same claim as "no report": coord said nothing about
                 absence here, and this row came from the list route, which may
                 simply not carry the report body. Saying "the report carried no
                 items" would invent a fact about the session. */
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                The stored report isn&apos;t included in this view — coord&apos;s
                session list didn&apos;t return its contents. That means it
                can&apos;t be shown here, not that the session emitted nothing.
              </div>
            ) : paired.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                The report carried no enumerated items.
              </div>
            ) : (
              <ul className="space-y-2" data-testid="compliance-report-items">
                {paired.map(({ reported, checked }, idx) => {
                  // Attribution is folded into the badge, so a guessed or
                  // absent attribution can never wear the green chip.
                  const resultMeta = checked
                    ? resultBadge(checked.result, checked.attribution)
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
