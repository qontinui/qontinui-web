"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText } from "lucide-react";
import { ComplianceStateNotice } from "./ComplianceStateNotice";
import { SessionComplianceReportDialog } from "./SessionComplianceReportDialog";
import {
  COMPLIANCE_VERDICTS,
  VERDICT_META,
  isReportAbsent,
  shapeCheckedCount,
  unreconciledCount,
  type ComplianceVerdict,
  type SessionComplianceRow,
} from "../compliance-types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface SessionsProps {
  rows: SessionComplianceRow[] | null;
  loading: boolean;
  unavailable: boolean;
  degraded: string | null;
  error: string | null;
  verdictFilter: ComplianceVerdict | "all";
  onVerdictFilterChange: (v: ComplianceVerdict | "all") => void;
  nextCursor: string | null;
  atFirstPage: boolean;
  onCursorChange: (cursor: string | null) => void;
}

/**
 * Recent per-session verdicts.
 *
 * Three verdicts and only three. A session that emitted no report is
 * `unverified` carrying the reason `absent` — rendered as an unverified chip
 * with that reason beside it, never as a fourth "no report" state, so the page
 * never implies that a missing report and a failed one are different kinds of
 * outcome.
 *
 * Verdicts are written at turn end and rewritten as a session goes on, so a row
 * is a running snapshot until the session closes. That distinction is marked:
 * an unverified verdict on a LIVE session may just mean the work isn't done
 * yet, and reading it as a failure would be wrong.
 */
export function SessionComplianceSessions({
  rows,
  loading,
  unavailable,
  degraded,
  error,
  verdictFilter,
  onVerdictFilterChange,
  nextCursor,
  atFirstPage,
  onCursorChange,
}: SessionsProps) {
  const [selected, setSelected] = useState<SessionComplianceRow | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const openReport = (row: SessionComplianceRow) => {
    setSelected(row);
    setReportOpen(true);
  };

  return (
    <section className="space-y-3" data-testid="compliance-sessions">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Recent sessions</h3>
          <p className="text-xs text-muted-foreground">
            What each session claimed, and how much of it coord could confirm. A
            verdict updates at every turn end and settles when the session
            closes, so rows marked <em>in progress</em> are still moving.
          </p>
        </div>
        <Select
          value={verdictFilter}
          onValueChange={(v) =>
            onVerdictFilterChange(v as ComplianceVerdict | "all")
          }
        >
          <SelectTrigger
            className="w-[13rem]"
            data-testid="compliance-verdict-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verdicts</SelectItem>
            {COMPLIANCE_VERDICTS.map((v) => (
              <SelectItem key={v} value={v}>
                {VERDICT_META[v].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ComplianceStateNotice
        unavailable={unavailable}
        degraded={degraded}
        error={error}
        what="session verdicts"
      />

      {loading && !rows ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading session verdicts…
        </p>
      ) : rows && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No sessions have been checked yet
            {verdictFilter === "all" ? "" : " with this verdict"}.
          </p>
        </div>
      ) : rows ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">
                  Unconfirmed claims
                </TableHead>
                <TableHead>Checked</TableHead>
                <TableHead className="w-24 text-right">Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const meta = VERDICT_META[row.verdict] ?? {
                  label: row.verdict,
                  variant: "outline" as const,
                  detail: "",
                };
                const unreconciled = unreconciledCount(row);
                const shaped = shapeCheckedCount(row);
                const absent = isReportAbsent(row);
                return (
                  <TableRow
                    key={row.id}
                    data-testid={`compliance-session-${row.claude_session_id}`}
                  >
                    <TableCell className="max-w-[18rem]">
                      <code className="truncate text-xs">
                        {row.claude_session_id}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={meta.variant} title={meta.detail}>
                          {meta.label}
                        </Badge>
                        {/* Only claimed when coord actually carries the flag —
                            absent means unknown, and unknown is not "final". */}
                        {row.finalized === false && (
                          <span
                            className="text-[11px] text-muted-foreground"
                            title="This session is still running. The verdict is rewritten at each turn end and settles when the session closes."
                            data-testid="verdict-in-progress"
                          >
                            in progress — not final
                          </span>
                        )}
                        {row.finalized === true && (
                          <span className="text-[11px] text-muted-foreground">
                            final
                          </span>
                        )}
                        {absent && (
                          <span className="text-[11px] text-muted-foreground">
                            no report emitted
                          </span>
                        )}
                        {!absent && row.reason && (
                          <span className="text-[11px] text-muted-foreground">
                            {row.reason}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          unreconciled > 0
                            ? "text-sm font-medium text-warning"
                            : "text-sm text-muted-foreground"
                        }
                      >
                        {absent ? "—" : unreconciled}
                      </span>
                      {shaped > 0 && (
                        <p
                          className="text-[11px] text-muted-foreground"
                          title="Deferred and surfaced items can't be machine-checked; coord only confirmed a reason was given."
                        >
                          +{shaped} shape-checked
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatWhen(row.checked_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2"
                        onClick={() => openReport(row)}
                        data-testid={`compliance-open-report-${row.claude_session_id}`}
                      >
                        <FileText className="size-4" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {(nextCursor || !atFirstPage) && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={atFirstPage}
            onClick={() => onCursorChange(null)}
          >
            First page
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor}
            onClick={() => onCursorChange(nextCursor)}
            data-testid="compliance-sessions-next"
          >
            Older
          </Button>
        </div>
      )}

      <SessionComplianceReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        row={selected}
      />
    </section>
  );
}
