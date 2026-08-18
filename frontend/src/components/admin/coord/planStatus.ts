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
 */

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
 */
export const PLAN_TONE_CLASS: Record<PlanStatusTone, string> = {
  shipped: "bg-green-500/15 text-green-200 border-green-500/30",
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  active: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  pending: "bg-muted text-muted-foreground border-border",
  blocked: "bg-red-500/15 text-red-200 border-red-500/30",
  closed: "bg-muted/40 text-muted-foreground/70 border-border",
  unknown: "bg-amber-500/10 text-amber-200 border-amber-500/30",
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
