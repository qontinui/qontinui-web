"use client";

/**
 * ReconciliationPanel — does each plan's record agree with reality?
 *
 * Three writers share one fact ("is this plan done?") and none reads the
 * others: coord's STORED `work_units.status` (axis A), the plan document's
 * status stamp (axis B — here the ARTIFACT STORE, not a git ref), and coord's
 * DERIVED delivery verdict (axis C). `GET /plan-library/reconciliation` reads
 * all three and classifies the disagreement through a first-match-wins cascade
 * of twelve members whose ORDER is part of the spec.
 *
 * ## Why this panel exists
 *
 * The route shipped on 2026-09-04 with **no frontend consumer at all**. Plan
 * `2026-09-15-captured-vs-authored-coverage-is-a-set-difference` named that in
 * its own "out of scope, and handed on" list, in the words of the dossier it
 * remediates: *"A shipped surface with zero readers is indistinguishable from
 * an unshipped one — the same class as this dossier."* It handed the item on
 * rather than absorbing it; this is that hand-off collected.
 *
 * ## The facet block is the answer, not the item list
 *
 * That is the route's own D3, and it is the rule this panel is built around.
 * The opening signal is `facets`, rendered with **every class including the
 * zeros** in cascade order — "no rows of class X" is a stated fact here, and
 * iterating the served object's keys would silently drop exactly the classes
 * an operator most wants to see read zero. The denominator is the WHOLE
 * population, not the page, and `sum(by_class) === sum(by_verdict) ===
 * denominator` is asserted by the backend, so the panel names the denominator
 * beside the counts rather than implying it from the rows on screen.
 *
 * ## Three ways this surface could lie, each answered on screen
 *
 * 1. **An unread axis reading as agreement.** The cascade prevents it
 *    mechanically (the two AGREE members are LAST), but a panel can undo that
 *    by rendering `unknown` the way it renders a low number. So `unknown` is a
 *    tone of its own here, `corpus_complete: false` raises a banner naming
 *    every blind spot verbatim, and a degraded coord read
 *    (`coord_available: false`) says so above the counts rather than beside
 *    them.
 * 2. **`shipped: false` read as "did not ship".** When `evidence_complete` is
 *    false it means coord COULD NOT ESTABLISH delivery. The two demand
 *    opposite responses, so axis C is never rendered as a bare `shipped` —
 *    [`axisCSentence`] reads `evidence_complete` first and says UNKNOWN, and
 *    `evidence_gaps` is printed verbatim rather than counted.
 * 3. **The document layer looking complete when it is frozen.** Axis B is
 *    `agent.work_artifacts`, which is sparse and can be silently FROZEN by a
 *    runner whose body sync is off. `document_axis_complete` and the
 *    present/missing split are rendered in the header, and the panel states
 *    that axis B is the artifact store — never "the plan file" — because the
 *    git-side reconciler in qontinui-dev-notes is the primary surface and a
 *    reader must know which one they are looking at.
 *
 * ## Axis C is per-page, and the off-page rows are counted, not dropped
 *
 * Coord has no bulk delivery door, so a corpus-wide axis C is ~4.5 minutes and
 * no request can pay it. Every row outside the page is classified
 * `UNKNOWN_AXIS_UNREADABLE` and STAYS in the denominator. That makes
 * `UNKNOWN_AXIS_UNREADABLE` structurally the largest class on any single page,
 * which would read as alarming drift if the panel did not say why — so it
 * does, next to `axis_c_computed_count`, and paging is presented as the way to
 * establish more of it rather than as scrolling.
 */

import { useState } from "react";
import { AlertTriangle, RefreshCw, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCluster, type StatTone } from "@/components/console";
import { useReconciliation } from "../_hooks/usePlanLibrary";
import { RECONCILIATION_CLASS_ORDER } from "../types";
import type {
  ReconciliationAxisA,
  ReconciliationAxisB,
  ReconciliationAxisC,
  ReconciliationResponse,
  ReconciliationRow,
  ReconciliationVerdict,
} from "../types";

/** The three verdict groups, in the order the facets are read in. */
const VERDICT_ORDER: readonly ReconciliationVerdict[] = [
  "disagree",
  "unknown",
  "agree",
] as const;

const VERDICT_TONE: Record<ReconciliationVerdict, StatTone> = {
  disagree: "attention",
  unknown: "warning",
  agree: "success",
};

const VERDICT_LABEL: Record<ReconciliationVerdict, string> = {
  disagree: "Disagree",
  unknown: "Unknown",
  agree: "Agree",
};

/**
 * A class's tone, derived from its NAME rather than a second hand-kept map.
 *
 * The backend's own groupings are exactly these prefixes (`UNKNOWN_*` are the
 * unknown classes, `AGREE_*` the agreeing ones, the rest disagreements), so
 * deriving keeps a thirteenth member correctly toned instead of silently
 * defaulting — and a new class is a new row here rather than an untoned one.
 */
function classTone(name: string): StatTone {
  if (name.startsWith("UNKNOWN_")) return "warning";
  if (name.startsWith("AGREE_")) return "success";
  return "attention";
}

/** Human words for a class, falling back to the wire name for a new member. */
const CLASS_LABEL: Record<string, string> = {
  UNKNOWN_AXIS_UNREADABLE: "An axis could not be read",
  UNKNOWN_NO_BODY_ON_MAIN: "No document body",
  UNKNOWN_NO_UNIT: "No coord work unit",
  UNKNOWN_UNIT_STATUS_EMPTY: "Unit status is empty",
  EVIDENCE_INCOMPLETE: "Delivery evidence incomplete",
  NO_CITATIONS_CAPTURED: "Landed, but no citations captured",
  UNIT_STATUS_CONTRADICTS_DELIVERY: "Stored status contradicts delivery",
  DOC_STAMP_UNREADABLE_BY_ADAPTER: "Stamp unreadable by the adapter",
  DOC_OVERSTATES: "Document overstates",
  DOC_UNDERSTATES: "Document understates",
  AGREE_TERMINAL: "Agree — terminal",
  AGREE_OPEN: "Agree — open",
};

function classLabel(name: string): string {
  return CLASS_LABEL[name] ?? name;
}

/**
 * Every class the panel should render, in cascade order, with the served
 * counts filled in — including the ones the server reports as zero, and
 * including any member the server knows about that this build does not.
 *
 * The union is the point. Taking only `RECONCILIATION_CLASS_ORDER` would hide
 * a thirteenth class the backend added; taking only the served keys would drop
 * the zeros, which are the facts D3 exists to state.
 */
export function classRows(
  byClass: Record<string, number>
): ReadonlyArray<{ name: string; count: number }> {
  const seen = new Set<string>(RECONCILIATION_CLASS_ORDER);
  const extra = Object.keys(byClass)
    .filter((k) => !seen.has(k))
    .sort();
  return [...RECONCILIATION_CLASS_ORDER, ...extra].map((name) => ({
    name,
    count: byClass[name] ?? 0,
  }));
}

/** Axis A in one sentence — never a bare status word. */
export function axisASentence(axis: ReconciliationAxisA): string {
  if (!axis.readable) {
    return `Coord's stored status could not be read${
      axis.unreadable_reason ? ` (${axis.unreadable_reason})` : ""
    } — unknown, not absent.`;
  }
  if (!axis.present) return "Coord holds no work unit for this stem.";
  if (axis.status === null || axis.status === "") {
    // Coord accepts an empty status silently, and it detaches the unit from
    // every status query — so an empty string is a finding, not a blank.
    return "Coord's stored status is empty, which detaches the unit from every status query.";
  }
  return `Coord's stored status is “${axis.status}”.`;
}

/** Axis B in one sentence — and it always names the artifact store. */
export function axisBSentence(axis: ReconciliationAxisB): string {
  if (!axis.readable) {
    return `The document layer could not be read${
      axis.unreadable_reason ? ` (${axis.unreadable_reason})` : ""
    } — unknown, not absent.`;
  }
  if (!axis.complete) {
    return `The artifact store holds no body for this stem (${axis.document_state}), so there is nothing to compare — unknown, never agreement.`;
  }
  const variants =
    axis.variant_count > 1
      ? ` ${axis.variant_count} artifact rows share this stem; the newest was compared.`
      : "";
  // `adapter_readable === false` is the only finding here; `null` is UNKNOWN
  // and stays silent, because the field is computed for the page only.
  const adapter =
    axis.adapter_readable === false
      ? " The runner adapter cannot read this stamp, so it substitutes `draft` and pushes that over coord's row."
      : "";
  const classification =
    axis.classification && axis.classification !== "ok"
      ? ` (${axis.classification})`
      : "";
  return `The stored document stamps “${axis.status ?? "—"}”${classification}.${variants}${adapter}`;
}

/**
 * Axis C in one sentence, reading `evidence_complete` BEFORE `shipped`.
 *
 * This ordering is the whole contract. `shipped: false` under
 * `evidence_complete: false` is "coord could not establish delivery", which is
 * UNKNOWN — rendering it as "did not ship" is the defect the cascade's arm
 * order prevents on the server and that this function prevents on the screen.
 */
export function axisCSentence(axis: ReconciliationAxisC): string {
  if (!axis.computed) {
    return "Coord's delivery verdict was not computed for this row — it is outside the page this read established. Page to it to establish it.";
  }
  if (!axis.readable) {
    return `Coord's delivery verdict could not be read${
      axis.unreadable_reason ? ` (${axis.unreadable_reason})` : ""
    } — unknown, not undelivered.`;
  }
  if (!axis.present) return "Coord holds no delivery verdict for this stem.";
  const citations =
    axis.citation_count === null
      ? ""
      : ` ${axis.citation_count} citation${axis.citation_count === 1 ? "" : "s"}.`;
  if (axis.evidence_complete === false) {
    const gaps = axis.evidence_gaps.length
      ? ` Gaps: ${axis.evidence_gaps.join("; ")}.`
      : "";
    return `Coord could not establish delivery — this is unknown, NOT “did not ship”.${gaps}${citations}`;
  }
  if (axis.evidence_complete === null) {
    return `Coord did not say whether its delivery evidence was complete, so its verdict cannot be read either way.${citations}`;
  }
  return `Coord's evidence is complete and says ${
    axis.shipped ? "this shipped" : "this has not shipped"
  }.${citations}`;
}

function RowView({ row }: { row: ReconciliationRow }) {
  const id = (suffix: string) => `reconciliation-row-${row.slug}-${suffix}`;
  return (
    <div
      className="border-b border-border px-3 py-2 last:border-b-0"
      data-testid={id("root")}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge
          variant="outline"
          className={
            row.verdict === "agree"
              ? "border-green-500/25 text-green-300"
              : row.verdict === "disagree"
                ? "border-red-500/35 text-red-200"
                : "border-amber-500/30 text-amber-200"
          }
          data-testid={id("verdict")}
        >
          {VERDICT_LABEL[row.verdict]}
        </Badge>
        <code className="min-w-0 break-all font-mono" data-testid={id("slug")}>
          {row.slug}
        </code>
        <span
          className="ml-auto shrink-0 text-muted-foreground"
          data-testid={id("class")}
        >
          {classLabel(row.classification)}
        </span>
      </div>

      {row.title && (
        <p className="mt-1 text-[11px] text-muted-foreground">{row.title}</p>
      )}

      <p className="mt-1 text-[11px]" data-testid={id("reason")}>
        {row.reason}
      </p>

      <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <div data-testid={id("axis-a")}>
          <dt className="inline font-medium">Coord&apos;s stored status: </dt>
          <dd className="inline">{axisASentence(row.axis_a)}</dd>
        </div>
        <div data-testid={id("axis-b")}>
          <dt className="inline font-medium">Document (artifact store): </dt>
          <dd className="inline">{axisBSentence(row.axis_b)}</dd>
        </div>
        <div data-testid={id("axis-c")}>
          <dt className="inline font-medium">
            Coord&apos;s delivery verdict:{" "}
          </dt>
          <dd className="inline">{axisCSentence(row.axis_c)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The blind-spot banner — rendered whenever the read was not whole. */
function BlindSpots({ data }: { data: ReconciliationResponse }) {
  const reasons = [...data.facets.corpus_incomplete_reasons];
  if (!data.coord_available) {
    reasons.push(
      "A coord read degraded on this page, so at least one coord axis is unknown for at least one row."
    );
  }
  if (data.work_unit_population_state === "unavailable") {
    reasons.push(
      `Coord's work-unit list could not be read, so the stored-status axis is unknown for EVERY row — not "coord has no work units"${
        data.work_unit_population_reason
          ? ` (${data.work_unit_population_reason})`
          : ""
      }.`
    );
  }
  if (!data.document_axis_complete) {
    reasons.push(
      `The document layer is incomplete: ${data.document_present_count} of ${
        data.document_present_count + data.document_missing_count
      } stems in the denominator carry a body. A stem with no artifact is classified unknown, never agreement.`
    );
  }
  if (reasons.length === 0) return null;
  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
      data-testid="reconciliation-blind-spots"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-xs text-amber-800 dark:text-amber-200">
        <p className="font-medium">
          This read is not whole, so it is not agreement:
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ReconciliationPanel() {
  const {
    data,
    loading,
    error,
    reload,
    offset,
    setOffset,
    includeCoord,
    setIncludeCoord,
    pageSize,
  } = useReconciliation();
  const [showRows, setShowRows] = useState(false);

  const facets = data?.facets ?? null;
  const pageEnd = data ? Math.min(data.offset + data.limit, data.total) : 0;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="reconciliation"
    >
      <div className="flex items-start gap-3">
        <Scale className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Plan status reconciliation</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Three writers share one fact — is this plan done? — and none reads
            the others: coord&apos;s stored status, the plan document&apos;s
            stamp, and coord&apos;s derived delivery verdict. Every class is
            listed including the ones that are zero, because &ldquo;no rows of
            this class&rdquo; is a fact worth stating. The document axis here is
            the <strong>artifact store</strong>, not a git ref.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 px-2 text-xs"
          onClick={() => reload()}
          disabled={loading}
          data-testid="reconciliation-refresh"
        >
          <RefreshCw className="size-3" aria-hidden />
          Refresh
        </Button>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="reconciliation-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read the reconciliation: {error}.{" "}
            {data
              ? "The counts below are the last ones read and may be stale."
              : "Nothing could be read — whether the records agree is unknown, not agreement."}
          </p>
        </div>
      )}

      {loading && !data ? (
        <Skeleton
          className="mt-4 h-24 w-full"
          data-testid="reconciliation-loading"
        />
      ) : data == null || facets == null ? null : (
        <>
          <BlindSpots data={data} />

          <StatCluster
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid="reconciliation-verdicts"
            stats={VERDICT_ORDER.map((v) => ({
              key: v,
              label: `${VERDICT_LABEL[v]} `,
              value: facets.by_verdict[v] ?? 0,
              tone: VERDICT_TONE[v],
              title:
                v === "unknown"
                  ? "An axis could not be read, or the row is outside the page whose delivery verdict was computed. Not agreement."
                  : v === "disagree"
                    ? "The three writers do not agree about whether this plan is done."
                    : "Every axis was read and they agree.",
              "data-testid": `reconciliation-verdict-${v}`,
            }))}
          />

          <p
            className="mt-2 text-[11px] text-muted-foreground"
            data-testid="reconciliation-denominator"
          >
            Over {facets.denominator} plan stem
            {facets.denominator === 1 ? "" : "s"} — the whole population, not
            this page. Coord&apos;s delivery verdict was computed for{" "}
            {data.axis_c_computed_count} of them (it is read per page, so every
            row outside this page is counted as unknown rather than dropped);
            page through to establish more.
          </p>

          <div className="mt-3" data-testid="reconciliation-classes">
            <p className="text-[11px] font-medium text-muted-foreground">
              By class, in the cascade&apos;s own order — first match wins, and
              the two agreeing classes are last so an unread axis cannot fall
              through into agreement:
            </p>
            <StatCluster
              className="mt-1 flex flex-wrap items-center gap-2"
              stats={classRows(facets.by_class).map(({ name, count }) => ({
                key: name,
                label: `${classLabel(name)} `,
                value: count,
                tone: count === 0 ? "muted" : classTone(name),
                title: name,
                "data-testid": `reconciliation-class-${name}`,
              }))}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeCoord}
                onChange={(e) => {
                  setOffset(0);
                  setIncludeCoord(e.target.checked);
                }}
                data-testid="reconciliation-include-coord"
              />
              Read coord&apos;s two axes
            </label>
            {!includeCoord && (
              <span
                className="text-amber-700 dark:text-amber-300"
                data-testid="reconciliation-document-only"
              >
                Document-layer only: both coord axes report unknown for every
                row — never agreement.
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              onClick={() => setShowRows((s) => !s)}
              data-testid="reconciliation-toggle-rows"
            >
              {showRows ? "Hide rows" : `Show ${data.items.length} rows`}
            </Button>
          </div>

          {showRows && (
            <>
              <div
                className="mt-2 overflow-hidden rounded-md border border-border bg-background"
                data-testid="reconciliation-rows"
              >
                {data.items.length === 0 ? (
                  <p
                    className="px-3 py-2 text-[11px] text-muted-foreground"
                    data-testid="reconciliation-rows-empty"
                  >
                    This page carries no rows. That is a position in the
                    population, not a statement that the corpus is empty — the
                    denominator above is {facets.denominator}.
                  </p>
                ) : (
                  data.items.map((row) => <RowView key={row.slug} row={row} />)
                )}
              </div>

              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span data-testid="reconciliation-page">
                  {data.total === 0
                    ? "No rows"
                    : `${data.offset + 1}–${pageEnd} of ${data.total}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs"
                  disabled={loading || data.offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  data-testid="reconciliation-prev"
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={loading || pageEnd >= data.total}
                  onClick={() => setOffset(offset + pageSize)}
                  data-testid="reconciliation-next"
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
