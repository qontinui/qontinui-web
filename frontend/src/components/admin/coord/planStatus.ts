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
  /** coord `work_units.created_at` — the sort key operators asked for. */
  created_at?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
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
 * The date prefix a plan slug conventionally opens with, used as the row's
 * mono identity chip. Falls back to the leading segment so a slug that does
 * not follow the convention still gets a stable, short identity rather than a
 * blank chip.
 */
export function planIdentity(slug: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(slug);
  if (m?.[1]) return m[1];
  const head = slug.split("-").slice(0, 2).join("-");
  return head || slug;
}

/** The slug with its {@link planIdentity} prefix removed (never empty). */
export function planRest(slug: string): string {
  const id = planIdentity(slug);
  return slug.startsWith(`${id}-`) ? slug.slice(id.length + 1) : slug;
}
