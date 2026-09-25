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
 * Phases 1, 2, 3 and 5a. **The derivation is the backend's** — one wire field
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
 * only the render is suppressed. The spawn guard below inherits that
 * suppression, for the same reason.
 *
 * ## The spawn guard (Phase 3)
 *
 * The badges make bodylessness visible on the registry; they do not stop the
 * one-click path that caused the incident. {@link deriveSpawnBodyConfirm} is
 * the single predicate BOTH spawn entry points read — `/plans`' row action and
 * `/spawn`'s modal — so "does this deserve a confirm?" is decided once rather
 * than twice, differently. {@link seedSpawnPrompt} is the other half:
 * `initial_prompt` is REQUIRED by coord, and it being blank is what let an
 * operator hand-write *"implement this plan"* at a slug with no plan.
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

/**
 * Unanimity or nothing: the one value every block stated, else `null`.
 *
 * Blocks that state nothing are ignored (they were not asked). Two blocks
 * stating DIFFERENT values means the walk made two measurements and got two
 * answers, so there is no single value to report — and reporting either one
 * would be picking a winner the reads did not.
 */
function agreedValue<T>(values: ReadonlyArray<T | null | undefined>): T | null {
  let settled: T | null = null;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (settled === null) settled = v;
    else if (settled !== v) return null;
  }
  return settled;
}

/**
 * Fold one answer's worth of `body_signal` blocks into one.
 *
 * The corpus walk (`planWalk.ts`) reads the list over SEVERAL requests, and
 * the proxy computes a block per request — the capture dial and the artifact
 * surface are read once per page, not once per walk — so one answer on screen
 * can be backed by several blocks that do not have to agree. A page whose dial
 * read failed mid-walk is a real state, and the console is the only place that
 * knows which pages belonged to one answer.
 *
 * The rules, and why each one:
 *
 * - `capture_readable` / `artifact_surface_readable` are ANDed. These gate
 *   whether a miss is evidence, and a walk in which ONE page could not read
 *   the dial did not establish that for the rows on that page. Claiming
 *   readable because most pages were is how a `false` on the wire becomes an
 *   accusation nothing measured.
 * - `miss_reason` is the FIRST arm any page reported. It explains why some
 *   rows read `unknown`; each row still carries its own reason, so this is the
 *   headline, not the per-row answer.
 * - `miss_scope` is the other half of that headline, and it exists because the
 *   copy cannot be written without it. A walk's pages are read at different
 *   moments against a dial an operator can flip between them, so "page 1
 *   missed" and "every page missed" are DIFFERENT facts: with the first, pages
 *   2-4 settled `has_body` for every row they could join, and a sentence
 *   saying this read established nothing is false about most of the list.
 *   `all_pages` means every block that stated anything reported a miss (so
 *   also the single-page case, where the two readings coincide);
 *   `some_pages` means at least one did and at least one did not; `null`
 *   means none did.
 * - `capture_level`, `capture_resolved_scope` and `org_plan_artifact_count`
 *   are unanimous-or-`null` ({@link agreedValue}). For the count, `null` is
 *   NOT MEASURED — which is exactly what a walk that measured two different
 *   numbers has: no one number to report.
 *
 * Returns `null` when no page carried a block at all: an empty page has
 * nothing to explain, and a backend predating the signals says nothing — and
 * neither of those is a block full of falses.
 */
export function foldBodySignalBlocks(
  blocks: ReadonlyArray<PlanBodySignalBlock | null | undefined>
): FoldedBodySignal | null {
  const stated = blocks.filter((b): b is PlanBodySignalBlock => !!b);
  if (stated.length === 0) return null;
  const missed = stated.filter((b) => b.miss_reason);
  return {
    capture_level: agreedValue(stated.map((b) => b.capture_level)),
    capture_resolved_scope: agreedValue(
      stated.map((b) => b.capture_resolved_scope)
    ),
    capture_readable: stated.every((b) => b.capture_readable),
    artifact_surface_readable: stated.every((b) => b.artifact_surface_readable),
    org_plan_artifact_count: agreedValue(
      stated.map((b) => b.org_plan_artifact_count)
    ),
    miss_reason: missed[0]?.miss_reason ?? null,
    miss_scope:
      missed.length === 0
        ? null
        : missed.length === stated.length
          ? "all_pages"
          : "some_pages",
  };
}

/**
 * How much of a read a miss covers: every page of it, or only some.
 *
 * `null` is no miss at all. The two non-null arms are not a nuance — they are
 * the difference between "nothing could be established" and "these rows could
 * not", and only the fold can tell them apart. See
 * {@link foldBodySignalBlocks}.
 */
export type BodyMissScope = "all_pages" | "some_pages";

/**
 * A folded block: the wire shape plus the one thing only the fold knows.
 *
 * `PlanBodySignalBlock` mirrors what the proxy serves for ONE page, so the
 * scope of a miss cannot live on it — a single page has no scope to report.
 * This is what a consumer holding one answer on screen actually has.
 */
export interface FoldedBodySignal extends PlanBodySignalBlock {
  miss_scope: BodyMissScope | null;
}

/**
 * The tooltip over the `document` chip strip: what this READ could establish.
 *
 * Worded off {@link FoldedBodySignal.miss_scope}, because the claim has to
 * match the evidence. The failure this closes: a 4-page walk whose first
 * dial read landed while `plan_capture` was off, the operator flipping it to
 * `record`, and pages 2-4 settling `has_body` for 1,350 rows — while the
 * tooltip still told the operator nothing could be established.
 *
 * **Neither arm says the read established NOTHING, because that was never
 * true — not even of the one-request page this console used to be.**
 * `BodyKnowledge.has_body` (`backend/app/services/plan_body_signal.py`)
 * answers `True` for a slug it found an artifact for BEFORE it consults
 * `miss_reason`, so one page read with capture off over a populated corpus
 * still settles every hit and renders a green "plan document" chip. A miss is
 * the only thing the reason covers, so both arms scope the claim to the rows a
 * page could not match to a document.
 *
 * Neither arm says anything about the rows it COULD match either, and that is
 * also deliberate: a page-level block is no evidence that its other rows
 * settled. A row whose slug is missing or empty answers UNKNOWN with the
 * per-row reason `unjoinable_row`, which `_miss_reason` cannot produce, so it
 * can never appear in the block the fold reads — a `some_pages` walk whose
 * clean page carries one such row would have had the old parenthetical
 * ("the rest of the rows were settled") contradicted by that row's own chip.
 *
 * An UNRECOGNISED `miss_reason` (a backend arm this build has no sentence for)
 * drops the clause rather than printing the wire enum at an operator: the
 * scope sentence still stands on its own, and `capture_never_configured` is
 * not English.
 */
export function hasBodyFilterTooltip(
  signal: FoldedBodySignal | null | undefined
): string {
  if (!signal?.miss_scope) {
    return "Whether a plan artifact exists for this work unit.";
  }
  const why = describeBodyUnknownReason(signal.miss_reason);
  const claim =
    signal.miss_scope === "all_pages"
      ? "This read could not establish whether a document exists for the " +
        "rows it could not match to one"
      : "Some pages of this read could not establish whether a document " +
        "exists for the rows they could not match to one";
  return (
    `${claim}${why ? ` — ${why}` : ""}. ` +
    "Every miss is reported unknown rather than as a missing document."
  );
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
 * The sentence for one `"unknown"` arm, or `null` when there is none to say.
 *
 * The map above is deliberately NOT exported: every surface that shows an
 * operator why a body signal is unknown goes through this, so no caller can
 * index it with a value the backend added since this build and interpolate
 * `undefined` — or, worse, print the wire enum. `null` here means "say nothing
 * about the reason", never "there was no reason".
 */
export function describeBodyUnknownReason(
  reason: BodyUnknownReason | null | undefined
): string | null {
  if (!reason) return null;
  return UNKNOWN_REASON_COPY[reason] ?? null;
}

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
    const why = describeBodyUnknownReason(reason);
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
// The spawn guard (Phase 3) — the incident this plan was written for.
// ============================================================================

/**
 * Which arm of the spawn confirm fired, and at what strength.
 *
 * The two are DIFFERENT claims and must never be worded alike. `absent` is a
 * statement of fact the corpus supports; `unproven` is a statement of
 * ignorance. Rendering the second in the words of the first is exactly the
 * unprovable-answer-as-proven defect this plan exists to close, so the arm is
 * carried as data and the copy is derived from it — never inferred from the
 * prose later.
 */
export type SpawnBodyRisk = "absent" | "unproven";

/** The work-unit fields the guard reads. Nothing else about the row matters. */
export type SpawnBodySubject = Pick<
  CoordPlanRow,
  "status" | "has_body" | "body_provenance" | "body_unknown_reason"
>;

/** The words a spawn surface puts in front of the operator before spawning. */
export interface SpawnBodyConfirm {
  risk: SpawnBodyRisk;
  /** One line, stated at exactly the strength the evidence supports. */
  headline: string;
  /** What the spawn will actually cost, and why we can say so. */
  detail: string;
  /** The label on the control that proceeds anyway. */
  acknowledge: string;
  /** Why the initial prompt arrived pre-filled — see {@link seedSpawnPrompt}.
   *  A seeded field with no explanation reads as a field the operator must
   *  not touch, and this one they should. */
  promptNote: string;
  /** Stable hook for tests and page specs. */
  testId: string;
}

/**
 * Should this spawn be confirmed first — and if so, on which arm?
 *
 * `null` means spawn exactly as the surface always did. The six inputs and
 * their answers, all deliberate:
 *
 * | `has_body` | `body_provenance` | verdict |
 * |---|---|---|
 * | `true` | anything | `null` — there is a document |
 * | `false` | anything | `absent` — a join miss against a populated corpus |
 * | `"unknown"` | `never_scanned` | `unproven` — two weak signals AGREEING |
 * | `"unknown"` | `scanned` / `scanned_locally` | `null` — they disagree |
 * | anything | anything, TERMINAL status | `null` — see {@link showsBodySignal} |
 * | absent | anything | `null` — this build was not told |
 *
 * The two `null`s at the bottom are the ones worth defending. Two weak
 * signals that DISAGREE are not grounds to interrupt an operator: a scanner
 * saw a file, the corpus cannot confirm it, and neither of those is evidence
 * of absence. And a MISSING field is unknown about the field — not evidence
 * of a body, but not evidence against one either — so it must not mint a new
 * interruption on a path that never had one.
 *
 * This is **not a block** in any arm. Spawning a session *to author* the plan
 * from good metadata is a legitimate and common move — it is how the
 * originating incident was actually resolved. The goal is to make
 * bodylessness visible, never to make the cheap path unavailable (§9).
 */
export function deriveSpawnBodyConfirm(
  plan: SpawnBodySubject | null | undefined
): SpawnBodyConfirm | null {
  if (!plan) return null;
  // A `shipped` unit that never had a document is not a defect, so it is not
  // a spawn worth interrupting either. Same rule as the badges, same reason.
  if (!showsBodySignal(plan)) return null;

  if (plan.has_body === false) {
    return {
      risk: "absent",
      headline: "This work unit has no plan document.",
      detail:
        "The plan library holds no artifact for this slug, and capture is " +
        "live for a populated corpus — so this absence is evidence, not a " +
        "gap in what we can see. The session you are about to spawn will " +
        "have to author the plan before it can implement anything.",
      acknowledge: "I understand — spawn a session to author the plan",
      promptNote:
        "Seeded because this work unit has no plan document: it tells the " +
        "session to author one from the unit's metadata rather than to " +
        "implement a plan that does not exist. Edit it freely.",
      testId: "coord-spawn-body-confirm-absent",
    };
  }

  if (plan.has_body === "unknown" && plan.body_provenance === "never_scanned") {
    const why = describeBodyUnknownReason(plan.body_unknown_reason);
    return {
      risk: "unproven",
      headline: "No plan document could be confirmed for this work unit.",
      detail:
        `The plan library could not settle it${why ? ` — ${why}` : ""}, and ` +
        "no plan scanner has ever seen a file for this unit either. That is " +
        "UNPROVEN, not proof of absence: the document may exist and be " +
        `invisible from here. ${SCREEN_CAVEAT} The session may find a plan; ` +
        "it may instead have to author one.",
      acknowledge: "I understand — spawn a session that may have to author it",
      promptNote:
        "Seeded because no plan document could be confirmed for this work " +
        "unit: it tells the session to look for the plan first and to author " +
        "one only if there is none. Edit it freely.",
      testId: "coord-spawn-body-confirm-unproven",
    };
  }

  return null;
}

/**
 * The initial prompt a spawn surface seeds when the plan may not exist.
 *
 * `initial_prompt` is REQUIRED by coord, so the operator writes one either
 * way; the only question is what the blank one says. The originating incident
 * was an operator hand-writing *"implement this plan"* at a slug with no plan,
 * and the session working out for itself that it had to author one instead.
 * The console should not require that.
 *
 * The two arms differ in the same way {@link deriveSpawnBodyConfirm}'s do —
 * `absent` sends the session straight to authoring, `unproven` sends it to
 * look first — because a prompt that asserts absence we cannot prove would
 * make the session skip a plan that is really there.
 *
 * Only metadata the caller actually HAS reaches the text: the title line is
 * omitted rather than invented, and no phase, status or finding is restated
 * here. The session is pointed AT the work unit's metadata instead, which is
 * the copy that survives the metadata changing.
 */
export function seedSpawnPrompt(
  risk: SpawnBodyRisk,
  workUnit: { slug: string; title?: string }
): string {
  const slug = workUnit.slug.trim();
  const title = (workUnit.title ?? "").trim();
  const header = [
    `Work unit: ${slug}`,
    ...(title === "" ? [] : [`Title: ${title}`]),
  ].join("\n");

  if (risk === "absent") {
    return (
      `${header}\n\n` +
      "There is NO plan document for this work unit — the plan library holds " +
      "no artifact for it. Do not spend the session hunting for one.\n\n" +
      "Your job is to AUTHOR the plan from the work unit's own metadata: " +
      "read the unit in coord (its metadata carries the findings of whoever " +
      "filed it), then write the plan from that. Vet it before any code is " +
      "written."
    );
  }

  return (
    `${header}\n\n` +
    "Whether a plan document exists for this work unit is UNKNOWN — no plan " +
    "scanner has ever seen a file for it, and the plan library could not " +
    "settle it either way.\n\n" +
    "Look for the plan FIRST, by this exact slug, in the plan library and in " +
    "the plan corpus. If you find one, work it. If you do not, AUTHOR it " +
    "from the work unit's own metadata in coord (its metadata carries the " +
    "findings of whoever filed it) rather than reporting the plan as missing."
  );
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
