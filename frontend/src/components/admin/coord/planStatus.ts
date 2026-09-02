/**
 * Plan (work-unit) status → operator-facing tag.
 *
 * Mirrors the PR pipeline's presentation contract
 * (`components/operations/prPipeline.ts`): the tag carries a **label**, never a
 * raw enum, and a **tone** that maps to the same colour vocabulary the merge
 * pipeline uses — so a SHIPPED plan reads green exactly like a merged PR.
 *
 * ## Why unknown statuses are surfaced rather than normalised
 *
 * `coord.work_units.status` is **opaque text by contract** — the column has no
 * CHECK, the runner's markdown parser keeps an unrecognised stamp verbatim
 * (`plan_workunit_adapter/parser.rs`: *"an unrecognized stamp is kept (opaque),
 * not dropped/rejected"*), and coord's own registry adds derived values over
 * time. Two consequences this module is built around:
 *
 * 1. The vocabulary below is a **display convenience, not a schema**. A status
 *    it does not recognise is rendered as its raw value under the `unknown`
 *    tone — visibly distinct, never silently painted as neutral. Showing an
 *    unrecognised status as if it were understood is the failure mode here;
 *    "I do not have a label for this" is the honest render.
 * 2. Real statuses exist that the page's filter list has never carried —
 *    `vetted_unattested` is written by `/vet-plan` whenever coord refuses the
 *    `vetted` attestation (separation of duties: an actor may not attest its
 *    own work unit). It is a normal, common state, not an error.
 *
 * ## The console contract (added by Phase 3 Wave 1)
 *
 * `/plans` renders through the console primitives
 * (`frontend/docs/console-ui-style-guide.md`), so this module now also carries
 * the two things R3 requires of a console surface, in the shape
 * `alertStatus.ts` established:
 *
 *   - {@link PLAN_ATTENTION_BY_TONE} — the audited tone → attention table,
 *     TOTAL over {@link PlanStatusTone}: red iff a human must act on the plan
 *     now, amber iff we are waiting on something (or do not know), calm
 *     otherwise;
 *   - {@link derivePlanStatus} — the pure row-status derivation the row
 *     component renders, so the copy an operator reads is testable without a
 *     DOM.
 *
 * `planStatus.test.ts` audits {@link PLAN_TONE_CLASS} against that table with
 * `paletteDisagreements`, so the hue and the severity can never drift apart.
 */

import type { Attention } from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
// Type-only, and that is what keeps the pair acyclic: `planBodySignal` imports
// VALUES from here (`isTerminalPlanStatus`), this imports only types from
// there, and a type import erases at build time.
import type {
  BodyProvenance,
  BodyUnknownReason,
  HasBody,
} from "./planBodySignal";

/**
 * One coord work-unit as the web proxy serves it.
 *
 * Declared HERE rather than beside a card component: it is the surface's data
 * shape, and it outlives any one rendering of it. `PlanCard` — which used to
 * re-export it — was DELETED in Phase 3 Wave 2 once `/history`, its last
 * renderer, moved onto `<PlanRow>`; `planSort`, `/spawn` and both list routes
 * now import the type from here directly.
 */
export interface CoordPlanRow {
  slug: string;
  title?: string;
  status?: string;
  current_phase?: string | null;
  /**
   * coord `work_units.authored_at` — when the plan was WRITTEN, derived from
   * the `YYYY-MM-DD` prefix of its slug (the runner's `authored_at_from_stem`
   * and the alembic backfill share that one derivation; plan
   * `2026-09-02-coord-work-units-carry-no-authoring-date`). NULL / absent
   * means coord holds none — an undated slug, a coord that predates the
   * column, or a unit created through the MCP upsert door by a caller that
   * omitted the argument (29 dated slugs were in that state on 2026-09-13).
   *
   * Never read this column directly to answer "when was this plan
   * authored?" — read {@link planAuthoredAt}, which consults the slug's own
   * date prefix first and this column second, so every consumer on the
   * surface (chip, row time, detail dates, sort, caveat count) agrees. It is
   * never coerced to `created_at`.
   */
  authored_at?: string | null;
  /**
   * coord `work_units.created_at` — when coord first INGESTED the row (the
   * INSERT default), NOT when the plan was authored: for most of the corpus
   * it is a bulk-backfill date. Rendered under the word "ingested" for that
   * reason; "created" is the label this field used to wear, and it was a lie.
   */
  created_at?: string | null;
  /**
   * coord `work_units.updated_at` — bumped by every scanner upsert (~68 s), so
   * it says when the row was last TOUCHED, not when anything happened to the
   * plan. Shown in the detail panel, labelled; never the row's time.
   */
  updated_at?: string | null;
  /**
   * coord `work_units.first_shipped_at` — derived from
   * `work_unit_status_history`: the first transition INTO `shipped`, NULL
   * until then. (A `shipped_at` field used to sit here; nothing ever served
   * it, so the row's time was silently `updated_at` for every plan.)
   */
  first_shipped_at?: string | null;
  /**
   * Does this "Plan" have a plan? The three fields below are derived
   * SERVER-SIDE by `operations.py` `list_coord_plans` (plan
   * `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`), not
   * by any component — one definition that this list, the detail route and
   * the spawn guard all read. Optional because a build predating them serves
   * none, and "not told" is not one of the values.
   *
   * The copy, the tones and the filters live in `planBodySignal.ts`; the types
   * are imported from there rather than restated, so the union cannot drift
   * from the one the wire actually carries.
   */
  body_provenance?: BodyProvenance;
  has_body?: HasBody;
  body_unknown_reason?: BodyUnknownReason | null;
}

/**
 * The explicit rendering for a row with NO time at all — no shipped, authored
 * or ingest timestamp — handed to `<RowTime absent>` so the cell says what it
 * knows instead of `relativeTime`'s generic "never" (a plan is not something
 * that has "never" happened).
 */
export const PLAN_TIME_ABSENT = {
  label: "no date recorded",
  title:
    "coord holds no shipped, authoring or ingestion time for this work unit.",
} as const;

/**
 * The timestamp a plan ROW reports: the semantically-right one for the plan's
 * state, never just "the newest column we have". Shared by `<PlanRow>` and
 * `<SpawnPlanRow>` so the two lists cannot disagree about what a plan's time
 * means.
 *
 * `updated_at` is deliberately NOT in this chain. The runner's scanner
 * re-upserts every on-disk plan roughly every 68 s, so `updated_at` is "when
 * the scanner last touched the row" — a four-month-old draft read "Updated 1m
 * ago" for as long as its file existed. A scanner touch is not a plan event;
 * the value stays in the detail panel, labelled, where it is honest.
 *
 * `created_at` is the INGESTION time, so it is named as such rather than under
 * "Created". An absent `authored_at` is UNKNOWN and falls through to the
 * ingest date under ITS name — never silently promoted to "authored".
 */
export function planRowTime(
  plan: Pick<
    CoordPlanRow,
    "slug" | "first_shipped_at" | "authored_at" | "created_at"
  >
): { at: string | null; verb: string } {
  if (plan.first_shipped_at) {
    return { at: plan.first_shipped_at, verb: "Shipped" };
  }
  // The EFFECTIVE authoring date — slug prefix, then coord's column — so a
  // dated slug whose column is NULL times the row on the date its identity
  // chip already shows, rather than on the ingest date beside a chip that
  // contradicts it. See `planAuthoredAt`.
  const authored = planAuthoredAt(plan);
  if (authored) return { at: authored, verb: "Authored" };
  if (plan.created_at) return { at: plan.created_at, verb: "Ingested" };
  return { at: null, verb: "Authored" };
}

/** Colour families, shared with the merge pipeline's status vocabulary. */
export type PlanStatusTone =
  | "shipped"
  | "ready"
  | "active"
  | "pending"
  | "blocked"
  | "closed"
  | "unknown";

/**
 * Tone → Tailwind classes. `shipped` deliberately reuses the merge pipeline's
 * merged-PR green (`MergePipeline.tsx`, `merged:`) so the two surfaces agree.
 *
 * The red and the ambers are IMPORTED, not spelled (§4.1: nothing outside
 * `statusRow` mints a red or an amber). They were spelled here originally, and
 * `blocked` had already drifted an opacity step off `AUTHOR_RED`
 * (`border-red-500/30` against `/35`) — silently, because
 * `paletteDisagreements` only tests for the `bg-red-` prefix. That is the
 * whole argument for importing: the audit cannot see this class of drift.
 * The greens and blues stay spelled; the rule governs red and amber, which are
 * the two hues that carry meaning.
 */
export const PLAN_TONE_CLASS: Record<PlanStatusTone, string> = {
  shipped: "bg-green-500/15 text-green-200 border-green-500/30",
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  active: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  pending: INERT,
  blocked: AUTHOR_RED,
  closed: "bg-muted/40 text-muted-foreground/70 border-border",
  unknown: UNKNOWN_AMBER,
};

export interface PlanStatusTag {
  /** Operator-facing text. For an unrecognised status this IS the raw value. */
  label: string;
  tone: PlanStatusTone;
  /** False when the status is not in the known vocabulary. */
  recognised: boolean;
  /** Tooltip copy; explains the unrecognised case rather than hiding it. */
  title: string;
}

const KNOWN: Record<string, { label: string; tone: PlanStatusTone }> = {
  draft: { label: "Draft", tone: "pending" },
  vetted: { label: "Vetted", tone: "pending" },
  // Not an error state: coord refuses `vetted` when the attester equals the
  // unit's owner, so a self-vetted plan legitimately lands here.
  vetted_unattested: { label: "Vetted (unattested)", tone: "pending" },
  in_progress: { label: "In progress", tone: "active" },
  "in-progress": { label: "In progress", tone: "active" },
  // Not canonical (plan-discipline's Free category is `draft`, `in_progress`,
  // `blocked` — not this), but a real, recurring free-text stamp: 13 of the
  // ~70 work units this page could not label on 2026-09-02 carried one of
  // these two spellings. Same active bucket as `in_progress` — both mean
  // "started, not done".
  partial: { label: "Partial", tone: "active" },
  partially: { label: "Partial", tone: "active" },
  ready: { label: "Ready", tone: "ready" },
  shipped: { label: "Shipped", tone: "shipped" },
  blocked: { label: "Blocked", tone: "blocked" },
  superseded: { label: "Superseded", tone: "closed" },
  obsolete: { label: "Obsolete", tone: "closed" },
  archived: { label: "Archived", tone: "closed" },
};

/** Statuses coord computes rather than accepting a direct write for. */
const DERIVED = new Set(["ready", "shipped"]);

export function describePlanStatus(raw?: string | null): PlanStatusTag {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) {
    return {
      label: "No status",
      tone: "unknown",
      recognised: false,
      title:
        "coord returned no status for this work unit. That is unknown, not draft.",
    };
  }
  const hit = KNOWN[key];
  if (!hit) {
    return {
      label: raw as string,
      tone: "unknown",
      recognised: false,
      title:
        `"${raw}" is not in this page's display vocabulary. Work-unit status ` +
        `is opaque text in coord, so this is shown verbatim rather than ` +
        `guessed at.`,
    };
  }
  return {
    label: hit.label,
    tone: hit.tone,
    recognised: true,
    title: DERIVED.has(key)
      ? `${hit.label} — derived by coord from a predicate (not directly settable).`
      : hit.label,
  };
}

// ============================================================================
// The console contract — R3's audited severity table, and the row status.
// ============================================================================

/**
 * The audited tone -> attention table. TOTAL over {@link PlanStatusTone},
 * and `planStatus.test.ts` asserts {@link PLAN_TONE_CLASS} agrees with it.
 *
 * Only two tones are loud, and each earns it:
 *
 * - `blocked` is `author` — a blocked work unit is blocked ON A HUMAN. Nothing
 *   downstream clears it; that is what the status means.
 * - `unknown` is `waiting`, which is `attentionOf`'s floor rather than
 *   a claim. Work-unit status is opaque text in coord, so an unrecognised
 *   value is a statement of ignorance, and rendering ignorance as calm is the
 *   `silent-empty-is-unknown` mistake with a badge attached.
 *
 * Everything else is calm on purpose. `shipped`, `ready`, `active`, `pending`
 * and `closed` are all states where the next move belongs to a process, not to
 * the operator reading the list — and a red badge nobody must act on is what
 * trains the eye to ignore red.
 */
export const PLAN_ATTENTION_BY_TONE: Record<PlanStatusTone, Attention> = {
  blocked: "author",
  unknown: "waiting",
  shipped: "none",
  ready: "none",
  active: "none",
  pending: "none",
  closed: "none",
};

/** Red <=> the colourblind-safe `x` glyph: exactly the `author` tones. */
export const PLAN_AUTHOR_GLYPH_TONES: ReadonlySet<PlanStatusTone> = new Set(
  (Object.keys(PLAN_ATTENTION_BY_TONE) as PlanStatusTone[]).filter(
    (t) => PLAN_ATTENTION_BY_TONE[t] === "author"
  )
);

export const PLAN_STATUS_PALETTE: StatusPalette<PlanStatusTone> = {
  badgeClass: PLAN_TONE_CLASS,
  authorGlyphKinds: PLAN_AUTHOR_GLYPH_TONES,
  doneGlyphKinds: new Set<PlanStatusTone>(["shipped"]),
};

/**
 * The row status `/plans` renders: the plan's operator-facing status tag,
 * widened into the console's {@link RowStatus} shape.
 *
 * `kind` is the TONE, not the raw coord status, because the tone is what the
 * palette is keyed on and what the R3 audit can be total over — coord's status
 * column is opaque text with no closed vocabulary to be total over. `label`
 * stays the human status word (and, for an unrecognised value, the raw string
 * verbatim), so nothing is lost by keying the colour on the tone.
 */
export function derivePlanStatus(
  plan: Pick<CoordPlanRow, "status" | "current_phase">
): RowStatus<PlanStatusTone> {
  const tag = describePlanStatus(plan.status);
  return {
    kind: tag.tone,
    label: tag.label,
    reason: plan.current_phase ? `phase ${plan.current_phase}` : undefined,
    attention: PLAN_ATTENTION_BY_TONE[tag.tone],
  };
}

/**
 * Statuses that read as "done", normalised.
 *
 * A MIRROR of `backend/app/models/work_artifact.py` `TERMINAL_STATUSES`, and
 * of its normalisation (upper-case, every run of non-alphanumerics collapsed
 * to `_`, edges trimmed) — so `"in progress"`, `"in-progress"` and
 * `"In_Progress"` compare equal. Keep the two lists in step; there is no
 * shared vocabulary to import, because `coord.work_units.status` is opaque
 * text with no schema on either side.
 *
 * Like the backend's, this is a READING of an opaque column rather than a
 * vocabulary: an unlisted status is not rejected, it simply does not count as
 * done.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "SHIPPED",
  "COMPLETE",
  "COMPLETED",
  "DONE",
  "LANDED",
  "MERGED",
  "ABANDONED",
  "SUPERSEDED",
  "CANCELLED",
  "CANCELED",
  "OBSOLETE",
  "CLOSED",
  "WITHDRAWN",
]);

/**
 * True when this work unit is finished.
 *
 * Used to suppress the body-signal badges: a `shipped` work unit that never
 * had a document is not a defect (`plan-discipline` — with no plan files,
 * citing the PRs and stamping the status ARE the ritual), and a badge on it
 * would spend the signal's credibility on correctly-closed work. See
 * `planBodySignal.showsBodySignal`.
 */
export function isTerminalPlanStatus(status?: string | null): boolean {
  const normalised = (status ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return TERMINAL_STATUSES.has(normalised);
}

/**
 * What the identity chip renders when the plan has NO authoring date at all —
 * neither a dated slug nor a coord `authored_at`. An em dash, the same "we do
 * not know" the row's time cell says in words via {@link PLAN_TIME_ABSENT}.
 */
export const PLAN_IDENTITY_ABSENT = "\u2014";

/**
 * `head` IFF it is a real calendar date. Shape alone is not validity —
 * `2026-13-45` and `2026-02-30` both match the pattern — and neither is
 * `Date.parse` alone: V8 rejects a month of 13 but ROLLS `2026-02-30` over to
 * March 2nd and returns a number, which is how the chip could have asserted
 * "Authored 2026-02-30" for a stem the runner's `NaiveDate::from_ymd_opt`
 * refuses. So the day is round-tripped: build the UTC instant and require the
 * calendar fields to come back unchanged. Shared by BOTH sources below so that
 * the slug arm and the column arm cannot disagree about what counts as a date.
 */
function calendarDay(head: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // `setUTCFullYear`, not `Date.UTC`: the latter maps years 0–99 onto
  // 1900–1999, which would call `0050-06-15` undated while both writers
  // accept it. No plan will ever carry such a year; parity is the contract.
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  const real =
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d;
  return real ? head : null;
}

/** The leading 10 characters of an ISO instant, IFF a real calendar date. */
function authoredDay(value?: string | null): string | null {
  return calendarDay((value ?? "").slice(0, 10));
}

/**
 * The `YYYY-MM-DD-` prefix a plan slug conventionally opens with, IFF it is a
 * real calendar date.
 *
 * Calendar-validated for PARITY with the two writers of `authored_at`: the
 * runner's `authored_at_from_stem` (`chrono::NaiveDate::from_ymd_opt`) and the
 * alembic backfill (a per-row `DO` block) both classify `2026-02-30-bogus` as
 * UNDATED and store NULL. A frontend that read the prefix by shape alone would
 * be the one consumer in the pipeline asserting "Authored 2026-02-30" for a
 * slug everything else agrees carries no date.
 */
function slugDay(slug: string): string | null {
  const head = /^(\d{4}-\d{2}-\d{2})-/.exec(slug)?.[1];
  return head ? calendarDay(head) : null;
}

/**
 * The plan's EFFECTIVE authoring instant — the ONE derivation every consumer
 * on this surface reads, so the identity chip, the row time, the detail
 * dates, the `authored_*` sorts and the "undated" caveat count can never
 * disagree about whether a plan has an authoring date.
 *
 * Two sources, in this order, and no third:
 *
 * 1. The slug's own `YYYY-MM-DD` prefix, as midnight UTC. First because it is
 *    the same substring the runner's `authored_at_from_stem` and the alembic
 *    backfill derive the column from — so where both exist they agree by
 *    construction (measured 2026-09-13: 0 disagreements over 1,686 dated
 *    slugs) — and because it is right for a row whose column is NULL.
 * 2. coord `work_units.authored_at`, returned verbatim (it may carry a real
 *    time of day for a bodyless unit whose creator supplied one).
 *
 * The second arm alone was not enough. `PR #1346` taught the chip to read the
 * slug first; the row time, the sort and the caveat still read the column
 * only, and on 2026-09-13 twenty-nine dated slugs — every one created since
 * 2026-09-10 through the MCP upsert door, whose callers omit `authored_at` —
 * had a NULL column. Their chip said `2026-09-12`; their row said "Ingested";
 * the default `authored_desc` sort sank the NEWEST plans in the corpus to the
 * bottom as "undated"; and the caveat counted them as having no date. One
 * deriver, read everywhere, is what closes that.
 *
 * `created_at` is deliberately NOT a third source. It is the INGEST time, and
 * every consumer that falls through to it does so under its own name.
 */
export function planAuthoredAt(
  plan: Pick<CoordPlanRow, "slug" | "authored_at">
): string | null {
  const fromSlug = slugDay(plan.slug);
  if (fromSlug) return `${fromSlug}T00:00:00Z`;
  return authoredDay(plan.authored_at) ? (plan.authored_at ?? null) : null;
}

/**
 * The row's mono identity chip: the date the plan was **authored**.
 *
 * Two sources, in this order, and no third:
 *
 * 1. The slug's own `YYYY-MM-DD` prefix. This stays first because it is the
 *    same substring the runner's `authored_at_from_stem` derives the column
 *    from, so a dated slug and its `authored_at` cannot disagree — and it is
 *    right even for a coord row that predates the column.
 * 2. coord `work_units.authored_at`, which plan
 *    `2026-09-02-coord-work-units-carry-no-authoring-date` added and
 *    backfilled.
 *
 * Neither available → {@link PLAN_IDENTITY_ABSENT}.
 *
 * ## Why the slug-word fallback was DELETED
 *
 * This used to fall back to the slug's first two hyphen-segments, so that an
 * undated slug still got "a stable, short identity rather than a blank chip".
 * That was a defensible trade while there was no other date to show — and it
 * stopped being one the moment `authored_at` shipped. The chip sits in the
 * position operators read as the row's date, so the fallback printed WORDS
 * where a date belongs:
 *
 *     coordinator-assign   (slug `coordinator-assign-task-dispatch-race-...`)
 *     qontinui-schemas     (slug `qontinui-schemas-rust-codegen`)
 *     plans to do          (no hyphens at all — chip and label rendered
 *                           IDENTICALLY, so the row read as a date of itself)
 *
 * Measured against coord on 2026-09-13 (1,835 rows the page lists, `shepherd-`
 * excluded as it excludes them): 149 slugs are undated and so showed words
 * today; **108 of those already carry a real `authored_at`** and now render the
 * date they always had. The remaining 41 render the em dash — an admitted
 * blank, which is the honest answer and is strictly better than a plausible
 * wrong one in a date column.
 *
 * `created_at` is deliberately NOT a third source. It is the INGEST time (for
 * most of the corpus, a bulk-backfill date); the detail panel shows it under
 * the word "ingested" precisely so it is never read as an authoring date, and
 * promoting it here would undo that one line above.
 */
export function planIdentity(slug: string, authoredAt?: string | null): string {
  // The chip is `planAuthoredAt` projected to a day, so it cannot drift from
  // the row time, the sort or the caveat — one derivation, not a parallel one.
  return (
    planAuthoredAt({ slug, authored_at: authoredAt })?.slice(0, 10) ??
    PLAN_IDENTITY_ABSENT
  );
}

/**
 * Tooltip for the identity chip, in the shape {@link describePlanStatus} and
 * {@link PLAN_TIME_ABSENT} already use on this surface: it names WHERE the
 * date came from, so a slug-derived date and a coord-derived one are
 * distinguishable without reading the slug — and an absent one says which of
 * the two sources was missing rather than leaving a bare dash unexplained.
 */
export function planIdentityTitle(
  slug: string,
  authoredAt?: string | null
): string {
  const fromSlug = slugDay(slug);
  if (fromSlug)
    return `Authored ${fromSlug} — from the plan slug's date prefix.`;
  const fromCoord = authoredDay(authoredAt);
  if (fromCoord) {
    return (
      `Authored ${fromCoord} — coord's recorded authoring date ` +
      `(work_units.authored_at). This slug carries no valid date prefix.`
    );
  }
  return (
    "No authoring date recorded: this slug carries no valid date prefix " +
    "and coord holds no authored_at for this work unit."
  );
}

/**
 * The slug with its date prefix removed (never empty).
 *
 * Reads the SLUG-derived identity only — it deliberately does not take the
 * authoring date, because a date that came out of coord's column is not a
 * substring of the slug and there is nothing to strip. The `startsWith` guard
 * is what makes that safe and is asserted by `planStatus.test.ts`: for an
 * undated slug {@link planIdentity} now returns the em dash, which no slug
 * begins with, so the full slug comes back.
 */
export function planRest(slug: string): string {
  const id = planIdentity(slug);
  return slug.startsWith(`${id}-`) ? slug.slice(id.length + 1) : slug;
}
