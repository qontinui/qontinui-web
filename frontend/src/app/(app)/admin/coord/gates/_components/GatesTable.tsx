"use client";

/**
 * GatesTable — one row per gate.
 *
 * Columns: Title · Measures · Progress (bar + current/target text) ·
 * Expected finish (eta, confidence-aware) · Verdict (colored) · Age ·
 * Last evaluated (+ stale badge) · Mute/Snooze badges.
 *
 * Controls: filter by verdict, filter by progress basis (kind), sort by
 * age / fraction / eta.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  GateOverviewRow,
  ProgressBasis,
} from "@/services/admin-dev-service";

// ---- formatting helpers --------------------------------------------------

/** Human-readable duration from seconds (e.g. "3h 12m", "45s", "2d 4h"). */
function formatAge(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "—";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

/** Relative time from an ISO timestamp to now (past → "ago", future → "in"). */
function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const deltaSecs = (t - Date.now()) / 1000;
  const abs = Math.abs(deltaSecs);
  const mag = formatAge(abs);
  if (mag === "—") return "—";
  return deltaSecs >= 0 ? `in ${mag}` : `${mag} ago`;
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

/** Expected-finish cell text honoring eta_confidence. */
function formatEta(g: GateOverviewRow): string {
  const { eta, eta_confidence } = g.progress;
  if (eta_confidence === "none" || !eta) return "—";
  const rel = formatRelative(eta);
  if (rel === "—") return "—";
  return eta_confidence === "estimate" ? `~${rel}` : rel;
}

type VerdictTone = "default" | "secondary" | "destructive" | "outline";

function verdictTone(verdict: string): VerdictTone {
  const v = verdict.toLowerCase();
  if (v === "pass" || v === "passed" || v === "cleared" || v === "ready")
    return "default";
  if (v === "fail" || v === "failed" || v === "error" || v === "veto")
    return "destructive";
  if (v === "pending" || v === "queued" || v === "evaluating")
    return "secondary";
  return "outline";
}

function progressVariant(
  g: GateOverviewRow
): "default" | "success" | "warning" | "error" {
  const v = g.verdict.toLowerCase();
  if (v === "fail" || v === "failed" || v === "error" || v === "veto")
    return "error";
  const f = g.progress.fraction;
  if (f !== null && f >= 1) return "success";
  if (g.stale) return "warning";
  return "default";
}

// ---- progress cell -------------------------------------------------------

function ProgressCell({ gate }: { gate: GateOverviewRow }) {
  const { fraction, current, target, unit, basis } = gate.progress;

  const detail =
    current !== null && target !== null
      ? `${current}/${target}${unit ? ` ${unit}` : ""}`
      : current !== null
        ? `${current}${unit ? ` ${unit}` : ""}`
        : null;

  if (fraction === null) {
    return (
      <div className="min-w-[8rem]">
        <div className="text-sm text-muted-foreground">—</div>
        <div className="text-[11px] text-muted-foreground/70">
          {basis === "indeterminate" ? "indeterminate" : detail ?? basis}
        </div>
      </div>
    );
  }

  const pct = Math.min(Math.max(fraction * 100, 0), 100);
  return (
    <div className="min-w-[8rem]">
      <Progress
        value={pct}
        variant={progressVariant(gate)}
        className="h-2"
        aria-label={`progress ${Math.round(pct)}%`}
      />
      <div className="text-[11px] text-muted-foreground mt-1 flex justify-between gap-2">
        <span>{Math.round(pct)}%</span>
        {detail && <span className="truncate">{detail}</span>}
      </div>
    </div>
  );
}

// ---- table ---------------------------------------------------------------

type SortKey = "age" | "fraction" | "eta";

const ALL = "__all__";

export function GatesTable({ gates }: { gates: GateOverviewRow[] }) {
  const [verdictFilter, setVerdictFilter] = useState<string>(ALL);
  const [basisFilter, setBasisFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("age");

  const verdictOptions = useMemo(
    () => Array.from(new Set(gates.map((g) => g.verdict))).sort(),
    [gates]
  );
  const basisOptions = useMemo(
    () => Array.from(new Set(gates.map((g) => g.progress.basis))).sort(),
    [gates]
  );

  const rows = useMemo(() => {
    let r = gates;
    if (verdictFilter !== ALL)
      r = r.filter((g) => g.verdict === verdictFilter);
    if (basisFilter !== ALL)
      r = r.filter((g) => g.progress.basis === (basisFilter as ProgressBasis));

    const sorted = [...r];
    sorted.sort((a, b) => {
      if (sortKey === "age") return b.age_secs - a.age_secs;
      if (sortKey === "fraction") {
        const fa = a.progress.fraction ?? -1;
        const fb = b.progress.fraction ?? -1;
        return fb - fa;
      }
      // eta — soonest first; nulls / "none" confidence sort last.
      const ea = etaSortValue(a);
      const eb = etaSortValue(b);
      return ea - eb;
    });
    return sorted;
  }, [gates, verdictFilter, basisFilter, sortKey]);

  return (
    <div className="space-y-3" data-testid="gates-table">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Verdict
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value)}
            data-testid="gates-filter-verdict"
          >
            <option value={ALL}>All</option>
            {verdictOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Kind (basis)
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={basisFilter}
            onChange={(e) => setBasisFilter(e.target.value)}
            data-testid="gates-filter-basis"
          >
            <option value={ALL}>All</option>
            {basisOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Sort by
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            data-testid="gates-sort"
          >
            <option value="age">Age (oldest first)</option>
            <option value="fraction">Progress (most first)</option>
            <option value="eta">Expected finish (soonest first)</option>
          </select>
        </label>

        <div className="ml-auto text-xs text-muted-foreground self-center">
          {rows.length} of {gates.length} gates
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gate</TableHead>
              <TableHead>Measures</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Expected finish</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Last evaluated</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-sm text-muted-foreground italic py-6"
                >
                  No gates match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((g) => (
                <TableRow key={g.gate_id} data-testid="gates-table-row">
                  <TableCell className="max-w-[16rem]">
                    <div className="font-medium text-sm truncate" title={g.title}>
                      {g.title}
                    </div>
                    {(g.plan_slug || g.phase_name) && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {g.plan_slug}
                        {g.plan_slug && g.phase_name ? " · " : ""}
                        {g.phase_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={g.measures}
                    >
                      {g.measures}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProgressCell gate={g} />
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatEta(g)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={verdictTone(g.verdict)}
                      title={g.verdict_reason ?? undefined}
                    >
                      {g.verdict}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap tabular-nums">
                    {formatAge(g.age_secs)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {g.evaluated_at ? (
                      <span
                        className="text-sm text-muted-foreground"
                        title={formatAbsolute(g.evaluated_at)}
                      >
                        {formatRelative(g.evaluated_at)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        never
                      </span>
                    )}
                    {g.stale && (
                      <Badge variant="destructive" className="ml-1.5">
                        stale
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {g.muted && <Badge variant="secondary">muted</Badge>}
                      {g.snoozed_until && (
                        <Badge
                          variant="outline"
                          title={`until ${formatAbsolute(g.snoozed_until)}`}
                        >
                          snoozed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Sort weight for ETA: soonest future first; missing/none → +Infinity. */
function etaSortValue(g: GateOverviewRow): number {
  if (g.progress.eta_confidence === "none" || !g.progress.eta)
    return Number.POSITIVE_INFINITY;
  const t = new Date(g.progress.eta).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
