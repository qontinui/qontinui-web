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

const VERDICT_TONE: Partial<Record<string, StatTone>> = {
  disagree: "attention",
  unknown: "warning",
  agree: "success",
};

const VERDICT_LABEL: Partial<Record<string, string>> = {
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
): ReadonlyArray<{ name: string; count: number | null }> {
  const seen = new Set<string>(RECONCILIATION_CLASS_ORDER);
  const extra = Object.keys(byClass)
    .filter((k) => !seen.has(k))
    .sort();
  return [...RECONCILIATION_CLASS_ORDER, ...extra].map((name) => ({
    name,
    count: byClass[name] ?? null,
  }));
}

/**
 * The verdict groups to render, union-ed with whatever the server served.
 *
 * The same rule as [`classRows`], and it was asymmetric at first: a class the
 * backend added became a visible row while a VERDICT it added was silently
 * dropped from the strip — which would make `sum(by_verdict) === denominator`
 * visibly stop holding on screen with nothing saying why.
 */
export function verdictRows(
  byVerdict: Record<string, number>
): readonly string[] {
  const known = new Set<string>(VERDICT_ORDER);
  const extra = Object.keys(byVerdict)
    .filter((k) => !known.has(k))
    .sort();
  return [...VERDICT_ORDER, ...extra];
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
 * A stable fragment of the backend's own off-page reason.
 *
 * `computed: false` does NOT mean "off page" — that was this panel's first
 * bug. The backend sets it on FOUR arms (`plan_library.py` `_reconcile_row`),
 * and three of them are rows ON the page: coord's work-unit list was
 * unreadable, the stem has no work unit, or coord was unreachable for that
 * row. Only the first arm is off-page, and the thing that distinguishes it is
 * the `unreadable_reason` the backend supplies, not the boolean.
 *
 * Matching a fragment rather than the whole sentence is deliberate: the prose
 * may be reworded, and a miss degrades to printing the reason verbatim — which
 * is still correct, just without the "page to it" remedy. A false POSITIVE
 * would be the harmful direction, and this fragment is specific enough that
 * no other arm's reason contains it.
 */
const AXIS_C_OFF_PAGE_MARKER = "computed only for the page";

/**
 * Axis C in one sentence, reading `evidence_complete` BEFORE `shipped`.
 *
 * This ordering is the whole contract. `shipped: false` under
 * `evidence_complete: false` is "coord could not establish delivery", which is
 * UNKNOWN — rendering it as "did not ship" is the defect the cascade's arm
 * order prevents on the server and that this function prevents on the screen.
 *
 * `shipped: null` is the same defect once more removed, and it is the reason
 * the last branch is not a ternary: a null under COMPLETE evidence still
 * establishes nothing, and `shipped ? … : …` would announce it as a definite
 * negative.
 */
export function axisCSentence(axis: ReconciliationAxisC): string {
  // Unreadable FIRST. Checking `computed` before this swallowed the
  // `unreadable_reason` the backend went to trouble to supply — the branch
  // that prints it was unreachable.
  if (!axis.readable) {
    const reason = axis.unreadable_reason ?? "";
    if (reason.includes(AXIS_C_OFF_PAGE_MARKER)) {
      return "Coord's delivery verdict was not asked for this row — it is outside the page this read established, so it is unknown rather than undelivered. Page to it to establish it.";
    }
    return `Coord's delivery verdict could not be read${
      reason ? ` (${reason})` : ""
    } — unknown, not undelivered.`;
  }
  if (!axis.present) {
    return "Coord holds no delivery verdict for this stem.";
  }
  const citations =
    axis.citation_count === null
      ? ""
      : ` ${axis.citation_count} citation${axis.citation_count === 1 ? "" : "s"}.`;
  if (axis.evidence_complete === false) {
    const gaps = axis.evidence_gaps?.length
      ? ` Gaps: ${axis.evidence_gaps.join("; ")}.`
      : "";
    return `Coord could not establish delivery — this is unknown, NOT “did not ship”.${gaps}${citations}`;
  }
  if (axis.evidence_complete === null) {
    return `Coord did not say whether its delivery evidence was complete, so its verdict cannot be read either way.${citations}`;
  }
  if (axis.shipped === null) {
    return `Coord's evidence is complete but it stated no delivery verdict, so whether this shipped is unknown — not “no”.${citations}`;
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
          {/* The SERVED source, not a hardcoded one. The field exists so a
              reader can tell which axis B they are looking at — the git-side
              reconciler in qontinui-dev-notes is the primary surface, and a
              panel asserting "artifact store" from a constant would keep
              saying it after the backend served something else. */}
          <dt className="inline font-medium">
            Document ({row.axis_b.source.replace(/_/g, " ")}):{" "}
          </dt>
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

/**
 * The blind-spot banner — rendered whenever the read was not whole.
 *
 * Two rules this got wrong at first, both of which made it render agreement:
 *
 * 1. **`corpus_complete` is the flag, and `corpus_incomplete_reasons` is only
 *    its explanation.** Keying the banner off the reasons array alone meant a
 *    response with `corpus_complete: false` and no reasons served rendered NO
 *    banner and the counts read as a whole corpus. `corpus_complete` is in the
 *    wire's `required` list; `corpus_incomplete_reasons` is NOT (it is
 *    `default_factory=list`), so the optional field was gating the required
 *    one.
 * 2. **The backend already appends a reason for most of these.** It covers the
 *    unreadable work-unit list, missing document bodies, a degraded coord read
 *    and a partial axis C. Adding our own sentence for each printed every
 *    blind spot twice in different words. So the served reasons are the
 *    primary text, and a local sentence is added only where nothing served
 *    already covers that flag.
 *
 * Every array read here is `?? []`: all three are defaulted rather than
 * required on the wire, so a deploy-skewed response that omits one must not
 * throw and take down the route segment.
 */
function BlindSpots({ data }: { data: ReconciliationResponse }) {
  const served = data.facets.corpus_incomplete_reasons ?? [];
  const reasons: { key: string; text: string }[] = served.map((text, i) => ({
    key: `served-${i}`,
    text,
  }));

  // Only ADD a sentence where the served list does not already speak to that
  // flag. `some(includes)` is a deliberately loose test: a near-duplicate is
  // worse than a missing gloss, because the flag itself is already visible.
  const covered = (needle: string) =>
    served.some((r) => r.toLowerCase().includes(needle));

  if (!data.coord_available && !covered("coord")) {
    reasons.push({
      key: "coord",
      text: "A coord read degraded on this page, so at least one coord axis is unknown for at least one row.",
    });
  }
  if (
    data.work_unit_population_state === "unavailable" &&
    !covered("work unit")
  ) {
    reasons.push({
      key: "population",
      text: `Coord's work-unit list could not be read, so the stored-status axis is unknown for EVERY row — not "coord has no work units"${
        data.work_unit_population_reason
          ? ` (${data.work_unit_population_reason})`
          : ""
      }.`,
    });
  }
  if (!data.document_axis_complete && !covered("document")) {
    reasons.push({
      key: "document",
      text: `The document layer is incomplete: ${data.document_present_count} of ${data.facets.denominator} stems in the denominator carry a body. A stem with no artifact is classified unknown, never agreement.`,
    });
  }

  // The REQUIRED flag decides whether the banner shows; the reasons only say
  // why. An incomplete corpus with nothing to show still gets a banner, and
  // says that the explanation itself is missing.
  const incomplete = !data.facets.corpus_complete || reasons.length > 0;
  if (!incomplete) return null;

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
        {reasons.length === 0 ? (
          <p
            className="mt-1"
            data-testid="reconciliation-blind-spots-unexplained"
          >
            The response reports the corpus read as incomplete but named no
            blind spot, so which part is missing is itself unknown.
          </p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {reasons.map((r) => (
              <li key={r.key}>{r.text}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * "Read at …" — the moment the numbers on screen were measured.
 *
 * This panel RETAINS the previous page across a page change and across a
 * failed read, which is the right behaviour and also the reason a stamp is
 * owed: without one, a retained page is indistinguishable from a fresh one.
 */
function ReadAt({ at }: { at: Date | null }) {
  if (!at) return null;
  return (
    <span
      className="ml-1 text-muted-foreground"
      data-testid="reconciliation-read-at"
    >
      Read at {at.toLocaleTimeString()}.
    </span>
  );
}

export function ReconciliationPanel() {
  const {
    data,
    fetchedAt,
    loading,
    error,
    reload,
    setOffset,
    includeCoord,
    setIncludeCoord,
    pageSize,
  } = useReconciliation();
  const [showRows, setShowRows] = useState(false);

  const facets = data?.facets ?? null;
  // `items.length`, NOT `offset + limit`. The route echoes `offset` and `limit`
  // back verbatim with no clamping, so a past-the-end offset rendered
  // "901-900 of 900". This is also correct on a partial last page.
  const pageEnd = data ? data.offset + (data.items?.length ?? 0) : 0;
  // Both the label and the BUTTONS read the delivered response, never the
  // hook's `offset` state. `useRetainedRead` keeps the last good `data` when a
  // read fails, so driving `disabled` from one and the arithmetic from the
  // other stranded Previous and skipped a page after any failed page read.
  const shownOffset = data?.offset ?? 0;

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
            this class&rdquo; is a fact worth stating. The document axis is
            whatever the response names — today the artifact store, not a git
            ref.
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
      ) : data == null ? null : facets == null ? (
        <p
          className="mt-3 text-xs text-amber-700 dark:text-amber-300"
          data-testid="reconciliation-no-facets"
        >
          The response carried no facet block, so nothing about agreement is
          established here. The facet block IS this surface&apos;s answer —
          without it an item list is a page, not a verdict.
          <ReadAt at={fetchedAt} />
        </p>
      ) : (
        <>
          <BlindSpots data={data} />

          <StatCluster
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid="reconciliation-verdicts"
            stats={verdictRows(facets.by_verdict).map((v) => ({
              key: v,
              label: `${VERDICT_LABEL[v] ?? v} `,
              // `?? null` renders an em dash, never `0` — `StatCluster`'s own
              // absence rule, and this panel's whole thesis.
              value: facets.by_verdict[v] ?? null,
              tone: VERDICT_TONE[v] ?? "muted",
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
            <ReadAt at={fetchedAt} />
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
                tone: count ? classTone(name) : "muted",
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
                onChange={(e) => setIncludeCoord(e.target.checked)}
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
                  {data.total === 0 || data.items.length === 0
                    ? `No rows on this page, of ${data.total}`
                    : `${shownOffset + 1}–${pageEnd} of ${data.total}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-xs"
                  disabled={loading || shownOffset === 0}
                  onClick={() => setOffset(Math.max(0, shownOffset - pageSize))}
                  data-testid="reconciliation-prev"
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={loading || pageEnd >= data.total}
                  onClick={() => setOffset(shownOffset + pageSize)}
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
