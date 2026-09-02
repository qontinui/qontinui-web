/**
 * "Plans" that have no plan — the two body signals, and the copy for them.
 *
 * `/admin/coord/plans` renders `coord.work_units`. A work unit is a slug, a
 * status and free-form metadata; it has no body. Measured 2026-09-02, 52 dated
 * plan-shaped work units had no plan `.md` on any machine and 31 of those were
 * still non-terminal — so an operator could pick a bodyless row off this
 * console and send a session at a plan that does not exist. That happened.
 *
 * Plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`,
 * Phases 1, 2 and 5a. **The derivation is the backend's** — one wire field
 * that the list, the detail route and the Phase 3 spawn guard all read, rather
 * than three consumers each re-implementing "is `metadata.source_path`
 * present" and disagreeing the first time a value is added to it. This module
 * owns only what a wire field cannot: the operator-facing words, the tone, and
 * the two client-side filters.
 *
 * ## The two signals answer DIFFERENT questions, and the UI must not blur them
 *
 * `body_provenance` is a **screen**. It says whether a scanner has ever seen a
 * file for this unit, from coord's metadata alone — no corpus, no join, no
 * query, so it survives every outage the verdict does not. Measured on ONE
 * device on 2026-09-02 (this is a one-device fleet): **recall 90.4%, precision
 * 27.6%** — of the 170 units it flags, 47 are truly bodyless. Every marker it
 * produces states that in its tooltip, because a screen rendered as a verdict
 * is worse than no screen: it spends the badge's credibility and teaches
 * operators to ignore it.
 *
 * The converse is why `scanned` renders NOTHING at all here (see
 * {@link describeBodyProvenance}): 5 of those 52 bodyless units carried a
 * `source_path` pointing at a file that exists on no machine, so a "document
 * seen" chip would be a claim the data does not support.
 *
 * `has_body` is the **verdict**, and it is three-valued on purpose. The
 * document corpus is not yet populated at scale, so a boolean would have
 * rendered ~1351 false accusations on its first deploy. `"unknown"` gets its
 * own chip — never a blank, never a tick, never folded into "fine" — and its
 * reason is carried in the tooltip so the operator can tell "nobody ever
 * turned capture on" from "your organization is not the one the body sync
 * writes under".
 *
 * ## Why terminal units are suppressed
 *
 * A `shipped` / `landed` / closed work unit that never had a document is not a
 * defect. `plan-discipline` is explicit that the closeout ritual is *cite the
 * PRs, stamp the status, archive the artifact*, and that with no plan files the
 * first two steps ARE the ritual. Badging all 21 of them would spend the
 * signal on correctly-closed work. See {@link showsBodySignal} — the FIELDS are
 * still computed and still on the wire, so a later consumer is not blocked;
 * only the render is suppressed.
 */

import { INERT, UNKNOWN_AMBER } from "@/components/console/statusRow";
import { isTerminalPlanStatus, type CoordPlanRow } from "./planStatus";

/** What a scanner has seen for this work unit, if anything. */
export type BodyProvenance = "scanned" | "scanned_locally" | "never_scanned";

/** `true` | `false` | `"unknown"` — see the module doc for why three. */
export type HasBody = boolean | "unknown";

/** Which arm produced an `"unknown"`. Mirrors the backend's closed set. */
export type BodyUnknownReason =
  | "artifact_surface_unavailable"
  | "capture_unreadable"
  | "capture_never_configured"
  | "capture_off"
  | "empty_corpus_for_org"
  | "unjoinable_row"
  | "no_org_principal";

/**
 * The once-per-page explanation the `/plans` envelope carries.
 *
 * Absent when the page had no rows to annotate — nothing to explain, so no
 * coord round trip was spent saying so.
 */
export interface PlanBodySignalBlock {
  capture_level: string | null;
  capture_resolved_scope: string | null;
  capture_readable: boolean;
  artifact_surface_readable: boolean;
  /** `null` means NOT MEASURED. `0` is a measurement — do not conflate them. */
  org_plan_artifact_count: number | null;
  miss_reason: BodyUnknownReason | null;
}

/** A rendered marker: the words, the hue, and the honest tooltip. */
export interface BodyMarker {
  label: string;
  /** Tailwind classes for the chip. */
  className: string;
  /** The tooltip. Always states what the signal can and cannot prove. */
  title: string;
  /** Stable hook for tests and page specs. */
  testId: string;
}

/**
 * A quiet green, spelled here rather than imported.
 *
 * §4.1's "nothing outside `statusRow` mints a red or an amber" governs the two
 * hues that carry severity; a positive chip is neither, and this is the same
 * green `planStatus`' `ready` tone already uses.
 */
const CONFIRMED_GREEN =
  "bg-green-500/5 text-green-300 border-green-500/25";

/** The dated observation both provenance tooltips carry. Stated, never asserted. */
const SCREEN_CAVEAT =
  "This is a SCREEN, not a verdict — measured 2026-09-02 on one device it " +
  "has 27.6% precision (and 90.4% recall), so most rows it flags do turn out " +
  "to have a document somewhere.";

/**
 * The marker for the screen, or `null` when there is nothing honest to say.
 *
 * `scanned` deliberately renders NOTHING. A "document seen" chip would read as
 * proof of a body, and it is not one: 5 of the 52 measured bodyless units
 * carried a `source_path` naming a file that exists on no machine. Silence is
 * the accurate render for "a scanner saw something once".
 */
export function describeBodyProvenance(
  provenance: BodyProvenance | null | undefined
): BodyMarker | null {
  if (provenance === "never_scanned") {
    return {
      label: "no document seen",
      className: INERT,
      title:
        "coord's work unit carries no source_path, so no plan scanner has " +
        `ever seen a file for it. ${SCREEN_CAVEAT}`,
      testId: "coord-plan-provenance-never-scanned",
    };
  }
  if (provenance === "scanned_locally") {
    return {
      label: "document seen on one machine only",
      className: INERT,
      title:
        "A scanner saw a file for this unit, but under a session worktree " +
        "or outside a canonical plans/ directory — provenance no other " +
        `machine can resolve. ${SCREEN_CAVEAT}`,
      testId: "coord-plan-provenance-scanned-locally",
    };
  }
  return null;
}

/** Operator-facing copy for each `"unknown"` arm. */
const UNKNOWN_REASON_COPY: Record<BodyUnknownReason, string> = {
  artifact_surface_unavailable:
    "the plan-library could not be read at all for this request, so absence " +
    "proves nothing",
  capture_unreadable:
    "the plan_capture dial could not be read, so we cannot tell whether the " +
    "corpus is being kept current",
  capture_never_configured:
    "no plan_capture policy row has ever been written for this tenant — " +
    "nobody turned capture off, nobody turned it on",
  capture_off:
    "plan capture is switched off for this tenant, so the corpus is not " +
    "being filled and a missing document proves nothing",
  empty_corpus_for_org:
    "your organization holds no plan artifacts at all, so a miss here means " +
    "you are not the principal the body sync writes under — not that the " +
    "document is missing",
  unjoinable_row:
    "coord served this row without a usable slug, so there is no join key to " +
    "look the document up by",
  no_org_principal:
    "this request carried no credential the plan library can derive an " +
    "organization from, so there is no corpus to look in — the list itself " +
    "is gated on a wider door than the library is",
};

/**
 * The verdict chip.
 *
 * All three values render. `"unknown"` is amber and says so in words — the one
 * thing it must never be is a blank cell or a green tick, which is the
 * unprovable-answer-rendered-as-proven defect this whole plan exists to close.
 */
export function describeHasBody(
  hasBody: HasBody | null | undefined,
  reason: BodyUnknownReason | null | undefined
): BodyMarker | null {
  if (hasBody === true) {
    return {
      label: "plan document",
      className: CONFIRMED_GREEN,
      title:
        "A plan artifact exists for this work unit in the plan library. This " +
        "is a join hit, so it holds whatever the capture dial says.",
      testId: "coord-plan-has-body-true",
    };
  }
  if (hasBody === false) {
    return {
      label: "no plan document",
      className: INERT,
      title:
        "No plan artifact exists for this work unit, and capture is live for " +
        "a populated corpus — so this absence IS evidence. A session sent at " +
        "this unit will have to author the plan.",
      testId: "coord-plan-has-body-false",
    };
  }
  if (hasBody === "unknown") {
    const why = reason ? UNKNOWN_REASON_COPY[reason] : null;
    return {
      label: "document unknown",
      className: UNKNOWN_AMBER,
      title:
        "Whether this work unit has a plan document could not be " +
        `established${why ? `: ${why}.` : "."} This is UNKNOWN, not "no ` +
        'document" — the screen beside it is the only signal available here.',
      testId: "coord-plan-has-body-unknown",
    };
  }
  // The field is absent: a coord/web build that predates the signals. Not
  // "no document" and not "unknown" either — this page simply was not told.
  return null;
}

/**
 * Whether this row's body signals should RENDER.
 *
 * False for a terminal work unit — see the module doc. The fields stay on the
 * wire either way; this governs pixels only.
 *
 * An UNRECOGNISED status is not treated as terminal. Work-unit status is
 * opaque text in coord, so suppression has to be earned by a status this page
 * actually recognises as done; guessing the other way would silently hide the
 * signal on exactly the rows nobody has a vocabulary for.
 */
export function showsBodySignal(plan: Pick<CoordPlanRow, "status">): boolean {
  return !isTerminalPlanStatus(plan.status);
}

// ============================================================================
// The two client-side filters.
// ============================================================================

/**
 * Provenance filter values. `scanned` is offered even though it renders no
 * marker — "show me the rows a scanner HAS seen" is a real question, and a
 * filter whose vocabulary is a strict subset of the data's is its own trap.
 */
export const PROVENANCE_FILTERS: ReadonlyArray<{
  value: BodyProvenance;
  label: string;
}> = [
  { value: "never_scanned", label: "no document seen" },
  { value: "scanned_locally", label: "one machine only" },
  { value: "scanned", label: "scanned" },
];

export type HasBodyFilter = "yes" | "no" | "unknown";

export const HAS_BODY_FILTERS: ReadonlyArray<{
  value: HasBodyFilter;
  label: string;
}> = [
  { value: "yes", label: "has document" },
  { value: "no", label: "no document" },
  { value: "unknown", label: "unknown" },
];

/** Fold a row's `has_body` onto its filter value, or `null` when unstated. */
export function hasBodyFilterValue(
  hasBody: HasBody | null | undefined
): HasBodyFilter | null {
  if (hasBody === true) return "yes";
  if (hasBody === false) return "no";
  if (hasBody === "unknown") return "unknown";
  return null;
}

/**
 * Apply both chip strips. An EMPTY selection is no filter, never "match
 * nothing" — the `FilterChips` contract, and the reason neither strip mints an
 * `"any"` member.
 *
 * A row whose signal the backend did not state matches neither strip's
 * selection: it is excluded by an active filter rather than swept into one of
 * the buckets, because "not told" is not a value.
 */
export function filterPlansByBodySignal(
  rows: readonly CoordPlanRow[],
  {
    provenance,
    hasBody,
  }: {
    provenance: readonly BodyProvenance[];
    hasBody: readonly HasBodyFilter[];
  }
): CoordPlanRow[] {
  return rows.filter((row) => {
    if (provenance.length > 0) {
      const value = row.body_provenance;
      if (!value || !provenance.includes(value)) return false;
    }
    if (hasBody.length > 0) {
      const value = hasBodyFilterValue(row.has_body);
      if (!value || !hasBody.includes(value)) return false;
    }
    return true;
  });
}
