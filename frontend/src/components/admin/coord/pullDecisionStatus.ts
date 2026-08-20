/**
 * `repo_pull` decision → operator-facing status.
 *
 * Created by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 2, in the shape `alertStatus.ts` / `planStatus.ts` established:
 * a pure derivation module beside the row that renders it, carrying R3's two
 * requirements — an audited kind→attention table and a palette keyed off it —
 * with `pullDecisionStatus.test.ts` asserting the agreement through the shared
 * `paletteDisagreements`.
 *
 * The wire shape is coord's `PullDecisionRow` DTO. Coord parses the nested
 * `coord.policy_rule_resolutions.resolution_payload` server-side, so everything
 * here is presentation over an already-flat row (plan
 * `2026-05-30-coord-pull-decision-ui.md` §4.1, "Decision (robustness)").
 */

import type { Attention } from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";

export interface PullDecisionOutcome {
  chosen_option?: string | null;
  reasoning?: string | null;
  recorded_at?: string | null;
}

export interface PullDecisionRow {
  resolution_id: string;
  resolved_at?: string | null;
  device_id?: string | null;
  repo?: string | null;
  kind?: "decision" | "escalate" | string | null;
  verdict?:
    | "pull"
    | "default_ref_sync"
    | "hold"
    | "up_to_date"
    | "diverged"
    | string
    | null;
  timing?: "now" | "defer" | string | null;
  defer_reason?: string | null;
  hold_reason?: string | null;
  autonomy?: "auto_decide" | "guidance_only" | string | null;
  behind?: number | null;
  ahead?: number | null;
  rationale?: string | null;
  outcome?: PullDecisionOutcome | null;
  // `timing_evidence` is the Mode-C `pull_timing_evidence` blob — shape is
  // an internal coord detail; we render a couple of well-known keys when
  // present and otherwise stay silent.
  timing_evidence?: Record<string, unknown> | null;
}

/** The verdict vocabulary this surface has a meaning for. */
export type PullVerdictKind =
  | "pull"
  | "default_ref_sync"
  | "hold"
  | "up_to_date"
  | "diverged"
  | "diverged_handled"
  | "unknown";

/** Operator-facing label per verdict. Never the raw snake_case token. */
const VERDICT_LABEL: Record<PullVerdictKind, string> = {
  pull: "Pull",
  default_ref_sync: "Default ref sync",
  hold: "Hold",
  up_to_date: "Up to date",
  diverged: "Diverged",
  diverged_handled: "Diverged — handled",
  unknown: "Unknown verdict",
};

export const PULL_VERDICT_CLASS: Record<PullVerdictKind, string> = {
  // Calm in-flight / terminal hues — nobody is blocked on any of these.
  pull: "bg-green-500/15 text-green-200 border-green-500/30",
  default_ref_sync: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  up_to_date: INERT,
  // Waiting on something else, and it clears itself.
  hold: WAITING_AMBER,
  // Someone must act now.
  diverged: AUTHOR_RED,
  // The same divergence, with an outcome reported against it. Calm, and the
  // detail says what was done.
  diverged_handled: INERT,
  // R3's ignorance floor.
  unknown: UNKNOWN_AMBER,
};

/**
 * The audited verdict → attention table. TOTAL over
 * {@link PullVerdictKind}, one row per verdict with the reason it lands there:
 *
 * - `pull` — **`none`**. coord said go ahead. The runner acts on it; the
 *   operator reading the feed is not owed anything.
 * - `default_ref_sync` — **`none`**. Same: an instruction to the executor, not
 *   to a human.
 * - `up_to_date` — **`none`**. Nothing to do, and nothing was to do.
 * - `hold` — **`waiting`**. The name of the thing that clears it is on the row
 *   (`hold_reason`): coord re-evaluates the pull decision on the next request,
 *   and a hold lapses when its premise does. That is amber's self-clearing
 *   contract, satisfied literally.
 * - `diverged` — **`author`**, but only while NOTHING has reported back. A
 *   diverged checkout does not reconcile itself; no watcher, no retry and no
 *   timeout resolves it, and the failure mode is lost local work. Only a human
 *   decides which side wins. Same call `alertStatus.ts` and `treeStatus.ts`
 *   make for idle uncommitted work, and R3 records the tie-break: where the
 *   failure mode is lost work, it breaks toward the louder signal.
 * - `diverged_handled` — **`none`**. THIS SURFACE IS AN AUDIT FEED, not a live
 *   checkout list: rows are append-only, carry a `resolved_at`, and the fetch
 *   has no time bound. Without this kind, a divergence somebody sorted out
 *   three weeks ago stays red forever and drags the whole page's health strip
 *   red with it — which is precisely how red stops meaning "act now". The
 *   evidence that separates the two is on the row already: coord records an
 *   `outcome.chosen_option` when something acted on the decision. Absence of
 *   an outcome is UNKNOWN, not "unhandled" — so absence keeps the loud
 *   reading, and only a positively-recorded outcome earns the calm one.
 * - `unknown` — **`waiting`**, the ignorance floor. A verdict token this build
 *   has never seen is a statement about our vocabulary, not about the row;
 *   nothing but a human extending it clears that, and painting it calm would
 *   assert "nothing is wrong here", which is exactly what we do not know.
 */
export const PULL_ATTENTION_BY_VERDICT: Record<PullVerdictKind, Attention> = {
  pull: "none",
  default_ref_sync: "none",
  up_to_date: "none",
  hold: "waiting",
  diverged: "author",
  diverged_handled: "none",
  unknown: "waiting",
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` verdicts. */
export const PULL_AUTHOR_GLYPH_VERDICTS: ReadonlySet<PullVerdictKind> = new Set(
  (Object.keys(PULL_ATTENTION_BY_VERDICT) as PullVerdictKind[]).filter(
    (k) => PULL_ATTENTION_BY_VERDICT[k] === "author"
  )
);

export const PULL_STATUS_PALETTE: StatusPalette<PullVerdictKind> = {
  badgeClass: PULL_VERDICT_CLASS,
  authorGlyphKinds: PULL_AUTHOR_GLYPH_VERDICTS,
  doneGlyphKinds: new Set<PullVerdictKind>(["up_to_date"]),
};

/**
 * The tokens coord actually sends. A `Set`, not an `in` test against
 * `VERDICT_LABEL`: `in` walks the prototype chain, so a row whose verdict was
 * the string `"constructor"` would classify as a known verdict and then index
 * the palette with it — an unstyled badge from a payload we do not control.
 */
const WIRE_VERDICTS: ReadonlySet<string> = new Set([
  "pull",
  "default_ref_sync",
  "hold",
  "up_to_date",
  "diverged",
]);

/** Normalise coord's verdict token; anything unlisted degrades to `unknown`. */
export function classifyVerdict(verdict?: string | null): PullVerdictKind {
  const v = (verdict ?? "").trim().toLowerCase();
  return WIRE_VERDICTS.has(v) ? (v as PullVerdictKind) : "unknown";
}

/** The `Now` / `Defer (reason)` chip text, or null when coord said nothing. */
export function timingLabel(row: PullDecisionRow): string | null {
  if (row.timing === "defer") {
    return `Defer${row.defer_reason ? ` (${row.defer_reason})` : ""}`;
  }
  if (row.timing === "now") return "Now";
  return null;
}

/**
 * The row status. `reason` is the shortest true "why" available: the hold
 * reason when there is one (it is the thing that clears the row), otherwise
 * the behind/ahead distance, otherwise coord's rationale.
 */
export function derivePullDecisionStatus(
  row: PullDecisionRow
): RowStatus<PullVerdictKind> {
  const verdict = classifyVerdict(row.verdict);
  // The one place a per-row signal changes the KIND rather than escalating an
  // attention. It is done here, in the classification, precisely BECAUSE
  // `escalateAttention` is escalate-only by contract: a row may be raised
  // above its kind's floor by evidence and never lowered below it. So the
  // evidence has to pick a different kind, and that kind carries its own
  // audited row in the table above.
  const kind: PullVerdictKind =
    verdict === "diverged" && (row.outcome?.chosen_option ?? "").trim() !== ""
      ? "diverged_handled"
      : verdict;
  // ASYMMETRIC on purpose, and the two halves answer different questions.
  // `behind` is the reason this decision exists, so a measured `0 behind`
  // ("we looked, you are level") is real information and must survive — a
  // truthy check would swallow it. `ahead` only ever qualifies the verdict:
  // `0 ahead` is the ordinary case and adds nothing, so it is omitted rather
  // than printed. An UNMEASURED `ahead` is likewise omitted; the two are not
  // distinguished here because neither is worth a row-level word, and the raw
  // counts are in the expanded detail either way.
  const distance: string[] = [];
  if ((row.behind ?? null) !== null) distance.push(`${row.behind} behind`);
  if ((row.ahead ?? 0) > 0) distance.push(`${row.ahead} ahead`);

  const reason =
    row.hold_reason ||
    (distance.length > 0 ? distance.join(", ") : "") ||
    row.rationale ||
    "";

  return {
    kind,
    label:
      kind === "unknown" && row.verdict
        ? // Verbatim, never guessed at — the raw token IS the honest label.
          String(row.verdict)
        : VERDICT_LABEL[kind],
    reason:
      kind === "diverged_handled"
        ? `resolved as ${row.outcome?.chosen_option}`
        : reason || undefined,
    attention: PULL_ATTENTION_BY_VERDICT[kind],
  };
}

/**
 * The mono identity chip: the repo's short name.
 *
 * `owner/name` → `name`; anything else is shown whole. The device id is
 * deliberately NOT the identity — it is a UUID, which R8 keeps out of a
 * primary surface and the expanded detail carries labelled.
 */
export function pullIdentity(repo?: string | null): string {
  const r = (repo ?? "").trim();
  if (!r) return "—";
  const slash = r.lastIndexOf("/");
  return slash >= 0 && slash < r.length - 1 ? r.slice(slash + 1) : r;
}

/** Build a short Mode-C evidence summary from the (opaque) evidence blob. */
export function evidenceSummary(
  ev?: Record<string, unknown> | null
): string | null {
  if (!ev || typeof ev !== "object") return null;
  const parts: string[] = [];
  const posture = ev["posture"];
  if (typeof posture === "string" && posture) parts.push(`posture: ${posture}`);
  const rate = ev["rate"] ?? ev["land_rate"] ?? ev["recent_rate"];
  if (typeof rate === "number") parts.push(`rate: ${rate}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}
