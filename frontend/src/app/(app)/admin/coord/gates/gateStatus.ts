/**
 * gateStatus — the derived state of one coord gate, and R3's audited severity
 * table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4 (Family C, D2). Derivation lives in a pure, unit-tested module rather
 * than inline in JSX (R8).
 *
 * ## Why a DERIVED kind union and not coord's `verdict` string
 *
 * `GateOverviewRow.verdict` is a free-text string — the pre-migration
 * `verdictTone` lower-cased it and matched against three hand-written lists,
 * with an `outline` fallback for anything else. A palette cannot be audited
 * against an open vocabulary: `paletteDisagreements` needs a TOTAL kind
 * table, and totality over "whatever coord sends" is not a thing. So the
 * string is normalised into a closed union here, exactly once, and the audit
 * binds that.
 *
 * ## The R3 reading, kind by kind — and the two the old tones got wrong
 *
 * - **`withdrawn` was painted destructive red.** Its own comment said it
 *   "tones like `failed` — destructive terminal". But a withdrawal is the
 *   REGISTRANT cancelling its own request: the thing it was gating is no
 *   longer wanted. Nobody must act, nothing is lost, and painting it red is
 *   the "how alarming does the word sound" bug — it spends the one hue whose
 *   value is that it means what it says.
 * - **`stale` was a `destructive` sub-badge on the Last-evaluated cell**, i.e.
 *   red, but it was decoration beside the verdict rather than part of it, so a
 *   stale PENDING gate rendered a calm grey verdict badge with a red word next
 *   to it. Stale means coord's sweep has not re-evaluated this gate in far too
 *   long: nothing clears that but a human noticing, which is genuinely
 *   `author` — so it becomes a KIND that wins over the calm ones rather than
 *   an ornament.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
} from "@/components/console/statusRow";

/** The vocabulary the ROW renders. */
export type GateKind =
  | "cleared"
  | "failed"
  | "withdrawn"
  | "evaluating"
  | "pending"
  | "stale"
  | "unknown";

/**
 * The audited kind → attention table. TOTAL over {@link GateKind}, one
 * documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `cleared` | `none` | The gate passed. Terminal and finished — nobody's move. |
 * | `failed` | `author` | The gate's predicate came back negative, or coord errored evaluating it. Nothing re-opens a failed gate on its own; a human decides what happens next. |
 * | `withdrawn` | `none` | The registrant cancelled its own request. **Was red.** A withdrawal is a CHOICE, terminal, and costs nobody anything. |
 * | `evaluating` | `none` | coord's sweep is computing the predicate right now. In flight; nobody is blocked. |
 * | `pending` | `none` | Registered and waiting for its predicate to become true. This is the NORMAL state of a healthy gate and by far the most common row — painting it amber would put most of the page in the "waiting on something" hue and destroy amber's signal. |
 * | `stale` | `author` | Open, and coord has not re-evaluated it within the staleness window. **Was a red ornament beside a calm badge.** The promise that the sweep would clear it is demonstrably not being kept, which is the same reading `prPipeline` gives `blocked-stale` / `needs-rebase-stale`. |
 * | `unknown` | `waiting` | R3's IGNORANCE FLOOR — a verdict string this build has no reading for. We cannot say whose move it is, and calm would assert nothing is wrong. |
 *
 * Note `pending` is `none` while `unknown` is `waiting`: the difference is not
 * how long either has been sitting there, it is that we KNOW what a pending
 * gate is and do not know what an unrecognised verdict is. That is exactly the
 * two-part test the style guide states for amber.
 */
export const GATE_ATTENTION_BY_KIND: Record<GateKind, Attention> = {
  cleared: "none",
  failed: "author",
  withdrawn: "none",
  evaluating: "none",
  pending: "none",
  stale: "author",
  unknown: "waiting",
};

export const GATE_KIND_CLASS: Record<GateKind, string> = {
  cleared: "bg-green-500/15 text-green-200 border-green-500/30",
  failed: AUTHOR_RED,
  // Terminal and deliberate — the dashed "not in play" treatment, distinct
  // from `cleared` without being an alarm.
  withdrawn: "bg-transparent text-muted-foreground border-border border-dashed",
  evaluating: CI_YELLOW,
  pending: INERT,
  stale: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const GATE_AUTHOR_GLYPH_KINDS: ReadonlySet<GateKind> = new Set(
  (Object.keys(GATE_ATTENTION_BY_KIND) as GateKind[]).filter(
    (k) => GATE_ATTENTION_BY_KIND[k] === "author"
  )
);

export const GATE_STATUS_PALETTE: StatusPalette<GateKind> = {
  badgeClass: GATE_KIND_CLASS,
  authorGlyphKinds: GATE_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<GateKind>(["cleared"]),
};

/** coord's terminal verdict words, lower-cased, grouped by what they mean. */
const CLEARED_WORDS = new Set(["pass", "passed", "cleared", "ready", "ok"]);
const FAILED_WORDS = new Set(["fail", "failed", "error", "veto", "rejected"]);
const WITHDRAWN_WORDS = new Set(["withdrawn", "cancelled", "canceled"]);
const EVALUATING_WORDS = new Set(["evaluating", "running", "in_progress"]);
const PENDING_WORDS = new Set(["pending", "queued", "open", "registered"]);

/** Is this verdict terminal — i.e. is the gate's story over? */
export function isTerminalGateVerdict(verdict: string): boolean {
  const v = verdict.toLowerCase();
  return (
    CLEARED_WORDS.has(v) || FAILED_WORDS.has(v) || WITHDRAWN_WORDS.has(v)
  );
}

const LABEL_BY_KIND: Record<GateKind, string> = {
  cleared: "cleared",
  failed: "failed",
  withdrawn: "withdrawn",
  evaluating: "evaluating",
  pending: "pending",
  stale: "not re-evaluated",
  unknown: "unrecognised verdict",
};

/** The fields this derivation reads — a structural subset of `GateOverviewRow`. */
export interface GateStatusInput {
  verdict: string;
  verdict_reason?: string | null;
  stale: boolean;
}

/**
 * The row's status.
 *
 * Precedence is **terminal-first, then staleness**: a gate that already
 * failed, cleared or was withdrawn has nothing left to re-evaluate, so
 * `stale` on it is meaningless bookkeeping and must not overwrite the answer.
 * Only an OPEN gate can be stale in the sense that matters — the sweep owes it
 * an evaluation and is not delivering.
 *
 * The LABEL is coord's own verdict word for every recognised kind except
 * `stale` and `unknown`, where the derived word carries information the raw
 * string does not.
 */
export function deriveGateStatus(g: GateStatusInput): RowStatus<GateKind> {
  const v = (g.verdict ?? "").toLowerCase();
  let kind: GateKind;
  if (CLEARED_WORDS.has(v)) kind = "cleared";
  else if (FAILED_WORDS.has(v)) kind = "failed";
  else if (WITHDRAWN_WORDS.has(v)) kind = "withdrawn";
  else if (g.stale) kind = "stale";
  else if (EVALUATING_WORDS.has(v)) kind = "evaluating";
  else if (PENDING_WORDS.has(v)) kind = "pending";
  else kind = "unknown";

  return {
    kind,
    // For the recognised non-derived kinds, print what coord said — its word
    // is the operator's word. `stale`/`unknown` print the derived label
    // because the raw string ("pending", or something we cannot read) is the
    // thing that would mislead.
    label:
      kind === "stale" || kind === "unknown"
        ? LABEL_BY_KIND[kind]
        : g.verdict || LABEL_BY_KIND[kind],
    reason:
      kind === "stale"
        ? `coord's sweep has not re-evaluated this gate recently${g.verdict_reason ? ` — last said: ${g.verdict_reason}` : ""}`
        : kind === "unknown"
          ? `coord reported the verdict "${g.verdict}", which this build has no reading for`
          : g.verdict_reason || undefined,
    attention: GATE_ATTENTION_BY_KIND[kind],
  };
}
