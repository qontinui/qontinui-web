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
 *
 * ## Console style (Phase 3 Wave 4) — D2, on a shadcn `<Table>`
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` keeps the
 * table: nine columns of gate state are a legitimate dense form and the
 * column comparison is the job this page exists for. `GatesTable` had **zero**
 * tooltips and its only per-record affordance was the Actions column, so the
 * gap D2 fills here is simply *absent detail*.
 *
 * **What moved off the row and into the expansion** — this is the density
 * work, and it is what took a row from ~4 stacked lines to ~2:
 *
 * | was | now |
 * |---|---|
 * | `GateAnchor` — a third line under the title | `<RecordDetail>` `why` |
 * | `ShadowReapEvidence` — a fourth line under the title | `<RecordDetail>` `problems` |
 * | `ProgressFreshness` — an "as of Xs ago" third line in the Progress cell | `<RecordDetail>` `history` |
 * | `ClearanceProvenanceLine` — a second line under the verdict badge | `<RecordDetail>` `history` |
 * | the gate id, on its own line | inline beside the title (it is the SEARCH HANDLE, so it stays on the collapsed row) plus the full id in `raw` |
 *
 * **The Actions cell stops propagation.** Its buttons open dialogs; a click
 * there must not toggle the row underneath.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { summarizeClearanceProvenance } from "@/components/operations/utils";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  clearanceBandIndex,
  lookupClearanceBand,
  type ClearanceRuleBand,
} from "../../_shared/clearanceRuleBand";
import { ShadowReapEvidence } from "./ShadowReap";
import { GateActions } from "./GateActions";
import {
  RecordDetail,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import { deriveGateStatus, GATE_STATUS_PALETTE } from "../gateStatus";

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

// The verdict→tone map MOVED to `../gateStatus.ts` (R8 — status derivation
// lives in a pure, unit-tested module; R3 — one audited kind→attention table
// decides the hue). Two of its readings were wrong and are corrected there:
// `withdrawn` was destructive red (a registrant cancelling its own request
// costs nobody anything), and `stale` was a red ornament beside a calm badge
// rather than part of the verdict.

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

  // `<ProgressFreshness>` used to render a THIRD line here on every row. It is
  // support material — "when did coord last compute this?" — so it moved into
  // the expansion (R5's `history` slot). Dropping it is what lets the Progress
  // cell stop being the tallest thing in the table.
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

// ---- anchor ---------------------------------------------------------------
//
// `GateAnchor` (the work-anchor sub-line, generic over plan vs work-unit) is
// gone as a component: its content is now the second line of `<GateDetail>`'s
// `why` slot, which is where R5 puts "what is this row about". It stayed
// generic over both anchor kinds — a gate may anchor to a plan
// (`plan_slug`/`plan_id`) or to a generic work unit (`work_unit_id`, plan
// fields null) — and still never assumes a plan-specific field exists.

// ---- gate-id cell --------------------------------------------------------

/**
 * The gate's id on a muted sub-line under the title/anchor: short form (first 8
 * chars, `tabular-nums`) with the full id on hover, plus a copy-to-clipboard
 * affordance. The short form is exactly what the search box's prefix match keys
 * on, so pasting an 8-char id (e.g. `2aeadf7c`) lands on this gate's row.
 */
function GateIdCell({ gate }: { gate: GateOverviewRow }) {
  const short = gate.gate_id.slice(0, 8);
  const copy = async (e: React.MouseEvent) => {
    // The copy button lives inside a clickable row: copying must not also
    // toggle the expansion under the operator's cursor.
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(gate.gate_id);
      toast.success("Gate id copied");
    } catch {
      toast.error("Failed to copy — select and copy manually");
    }
  };
  return (
    <div
      className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70"
      data-testid="gates-gate-id"
    >
      <span className="tabular-nums" title={gate.gate_id}>
        {short}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-4 text-muted-foreground/70 hover:text-foreground"
        onClick={copy}
        aria-label={`Copy gate id ${gate.gate_id}`}
        data-testid="gates-gate-id-copy"
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}

// ---- clearance provenance cell -------------------------------------------

/**
 * Sub-line under the verdict badge: who moved the gate to a terminal verdict,
 * via which door, under which rule — e.g. "attested by agent <id> on <device>
 * under tenant rule <id>" (plan
 * `2026-07-27-configurable-gate-clearance-authority` Phase 6; the BAND half is
 * plan `2026-08-10-agent-gate-management-must-ship-in-the-product` P3).
 * Renders nothing when coord doesn't emit the provenance columns yet
 * (pre-deploy), so the cell stays byte-identical to today.
 *
 * The band is NOT on the gates wire — coord returns the deciding rule's id and
 * nothing else about it — so it is derived by looking that id up in the
 * workspace's current `gate_clearance` rule set (`bandIndex`). When the set was
 * READ and no longer carries the id, the line says "band unknown"; when the set
 * was never read the line simply names no band. Neither ever picks the likely
 * answer.
 */
function ClearanceProvenanceLine({
  gate,
  bandIndex,
}: {
  gate: GateOverviewRow;
  bandIndex: ReadonlyMap<string, ClearanceRuleBand> | null;
}) {
  const summary = summarizeClearanceProvenance(gate, {
    ruleBand: lookupClearanceBand(gate.cleared_under_rule, bandIndex),
    noteAudienceDefault: true,
  });
  if (!summary) return null;
  return (
    <div
      className="text-[11px] text-muted-foreground/70 mt-1 max-w-[14rem] truncate"
      title={summary}
      data-testid="gates-clearance-provenance"
    >
      {summary}
    </div>
  );
}

// ---- table ---------------------------------------------------------------

type SortKey = "age" | "fraction" | "eta";

const ALL = "__all__";

export function GatesTable({
  gates,
  onActed,
  clearanceRules = null,
}: {
  gates: GateOverviewRow[];
  /** Refetch the overview after a successful gate action (coord is the source
   *  of truth — the page re-fetches rather than optimistically mutating). */
  onActed: () => void;
  /**
   * The workspace's `gate_clearance` rules, used ONLY to name the band of a
   * gate's deciding rule. `null` — the default — means "not loaded", and the
   * provenance line then names no band at all, exactly as before bands
   * existed.
   */
  clearanceRules?: readonly CoordPolicyRow[] | null;
}) {
  const [search, setSearch] = useState("");
  // R5 — one row open at a time, the same model `<RecordList>` holds for a row
  // list, spelled out here because a `<TableBody>` cannot host that primitive.
  const [openGate, setOpenGate] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<string>(ALL);
  const [basisFilter, setBasisFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("age");

  // Deep link: `/admin/coord/gates?gate=<id>` arrives with the search box
  // pre-filled with that id, so a link from elsewhere in the console (the
  // outstanding-work ledger under /admin/coord/prompt-documents links gated
  // items this way) lands on the gate rather than on an unfiltered list.
  // Read once on mount from `window.location` rather than `useSearchParams`,
  // which would force this client subtree behind a Suspense boundary for a
  // one-shot read. The box stays editable — this only seeds it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const gate = new URLSearchParams(window.location.search).get("gate");
    if (gate) setSearch(gate);
  }, []);

  // `policy_id -> band` for the provenance sub-line. Stays `null` (= no band
  // claim) when the caller did not supply a rule set.
  const bandIndex = useMemo(
    () => clearanceBandIndex(clearanceRules),
    [clearanceRules]
  );

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

    // Free-text search — first narrowing step so it composes with the
    // verdict/basis dropdowns and the sort below. Case-insensitive substring
    // match across the gate's identifying fields; `gate_id` matches on both its
    // full value and its 8-char short form (what the table renders), so pasting
    // a short id lands on its row. Each field is guarded for null/undefined.
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((g) => {
        const haystacks = [
          g.title,
          g.gate_id,
          g.gate_id ? g.gate_id.slice(0, 8) : null,
          g.plan_slug,
          g.work_unit_slug,
          g.work_unit_id,
          g.phase_name,
          g.measures,
          g.verdict,
        ];
        return haystacks.some(
          (h) => h != null && h.toLowerCase().includes(q)
        );
      });
    }

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
  }, [gates, search, verdictFilter, basisFilter, sortKey]);

  return (
    <div className="space-y-3" data-testid="gates-table">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Search
          <input
            type="text"
            className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            placeholder="title, gate id, anchor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="gates-search"
          />
        </label>

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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-muted-foreground italic py-6"
                >
                  No gates match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((g) => {
                const expanded = openGate === g.gate_id;
                const status = deriveGateStatus(g);
                const Chevron = expanded ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={g.gate_id}>
                    <TableRow
                      data-testid="gates-table-row"
                      data-expanded={expanded ? "true" : "false"}
                      onClick={() =>
                        setOpenGate(expanded ? null : g.gate_id)
                      }
                      // R4 — a 2px left border, not a coloured row: the body
                      // stays neutral so 40 rows read when 6 are red.
                      className={`cursor-pointer ${rowAccentClass(status)}`}
                    >
                      <TableCell className="max-w-[18rem]">
                        <div className="flex items-center gap-1.5">
                          <Chevron
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span
                            className="truncate text-sm font-medium"
                            title={g.title}
                          >
                            {g.title}
                          </span>
                          {/* The short gate id stays on the COLLAPSED row: it
                              is the handle the search box prefix-matches on,
                              so folding it away would hide the thing a
                              deep-linked operator pastes. It rides inline
                              rather than on a line of its own. */}
                          <GateIdCell gate={g} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={g.measures}
                        >
                          {g.measures}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ProgressCell gate={g} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatEta(g)}
                      </TableCell>
                      <TableCell>
                        {/* R3 — one audited badge where there used to be a
                            verdict badge PLUS a separate red "stale" word in
                            the next column. */}
                        <StatusBadge
                          status={status}
                          palette={GATE_STATUS_PALETTE}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
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
                          {/* Gate-class chip — registrant self-classification
                              (free vocabulary; NULL/absent = unclassified → no
                              chip, identical to today). */}
                          {g.gate_class && (
                            <Badge
                              variant="outline"
                              className="font-mono"
                              data-testid="gates-gate-class"
                            >
                              {g.gate_class}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        // The action buttons open dialogs; a click here must
                        // not toggle the row underneath them.
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GateActions gate={g} onActed={onActed} />
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      // D2 — a full-width cell spanning all nine columns.
                      <TableRow
                        data-testid="gates-table-row-detail"
                        className="hover:bg-transparent"
                      >
                        <TableCell colSpan={9} className="p-0">
                          <GateDetail gate={g} bandIndex={bandIndex} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * R5's detail, in the shared host and the fixed slot order.
 *
 * Every slot here previously rendered as an extra stacked line on the
 * collapsed row (see the table in this file's header). `raw` carries the full
 * gate id, the anchor ids and the audience — R8's rule that raw ids appear in
 * the expansion and nowhere else.
 */
function GateDetail({
  gate,
  bandIndex,
}: {
  gate: GateOverviewRow;
  bandIndex: ReadonlyMap<string, ClearanceRuleBand> | null;
}) {
  const status = deriveGateStatus(gate);
  const anchorId =
    gate.plan_slug ?? gate.work_unit_slug ?? gate.work_unit_id ?? null;
  const computedAt = gate.progress.computed_at ?? null;
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="gates-row-detail"
      why={
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {status.reason ?? gate.measures}
          </p>
          {(anchorId || gate.phase_name) && (
            <p className="text-xs text-muted-foreground/80">
              Anchored to{" "}
              <span className="font-medium text-foreground">
                {anchorId ?? "an unnamed unit"}
              </span>
              {gate.phase_name ? ` · ${gate.phase_name}` : ""}
            </p>
          )}
        </div>
      }
      problems={<ShadowReapEvidence gate={gate} />}
      history={
        <div className="space-y-1">
          {computedAt && (
            <p
              className={`text-[11px] ${gate.stale ? "text-red-200" : "text-muted-foreground/70"}`}
              title={`progress computed ${formatAbsolute(computedAt)}`}
              data-testid="gates-progress-freshness"
            >
              Progress computed {formatRelative(computedAt)}
              {gate.stale ? " — coord's sweep is overdue on this gate." : "."}
            </p>
          )}
          <ClearanceProvenanceLine gate={gate} bandIndex={bandIndex} />
        </div>
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          gate_id: {gate.gate_id} · verdict: {gate.verdict} · audience:{" "}
          {gate.clearance_audience}
          {gate.claim_kind ? ` · claim: ${gate.claim_kind}` : ""}
          {gate.resource_key ? `:${gate.resource_key}` : ""}
          {gate.plan_id ? ` · plan_id: ${gate.plan_id}` : ""}
          {gate.work_unit_id ? ` · work_unit_id: ${gate.work_unit_id}` : ""}
        </div>
      }
    />
  );
}

/** Sort weight for ETA: soonest future first; missing/none → +Infinity. */
function etaSortValue(g: GateOverviewRow): number {
  if (g.progress.eta_confidence === "none" || !g.progress.eta)
    return Number.POSITIVE_INFINITY;
  const t = new Date(g.progress.eta).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
