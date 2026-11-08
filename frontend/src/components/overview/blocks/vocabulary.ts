/**
 * The words report blocks say a status, a change, a verdict and a method in —
 * the ONE place they live (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D5), in
 * the style of `components/overview/vocabulary.ts`.
 *
 * ## Status words come from the Summary's own list
 *
 * A report item's status reads exactly as the Summary's progress panel says
 * the same thing: the five shared labels are taken from `PROGRESS_BUCKETS`
 * (`_lib/progress.ts`), and `dropped` — work that will not be done — is added
 * here. `PROGRESS_BUCKETS` and its `ProgressBucket` type are deliberately NOT
 * extended: the Summary keys its colours and its "done of total" headline on
 * them, and leaves closed work out by design (`CLASS_BUCKET` maps
 * `closed_other` to `null`). Adding `dropped` there would change the
 * Summary's numbers.
 *
 * ## Never colour alone
 *
 * Every status, change and verdict carries a SHAPE and a WORD. The shape is
 * decoration (`aria-hidden` where it renders); the word is the meaning, so the
 * page reads the same in greyscale, to a screen reader, and in a UI Bridge
 * text snapshot.
 */

import {
  PROGRESS_BUCKETS,
  type ProgressBucket,
} from "@/app/(app)/overview/_lib/progress";
import type { components } from "@/lib/api-client/generated-types";

type Schemas = components["schemas"];

/** A report item's status — the contract's own union (D4). */
export type ItemStatus = Schemas["SnapshotItem"]["status"];

/** The statuses blocks know: the Summary's five, plus `dropped`. */
export type BlockStatus = ProgressBucket | "dropped";

// Compile-time proof that the contract and the vocabulary name the same six
// statuses: a status added on either side fails the type-check here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const STATUSES_AGREE: Same<ItemStatus, BlockStatus> = true;
void STATUSES_AGREE;

const SHAPE: Record<BlockStatus, string> = {
  done: "✓",
  in_progress: "◐",
  blocked: "⊘",
  planned: "○",
  unknown: "?",
  dropped: "–",
};

/** How work that will not be done is said. */
export const DROPPED_LABEL = "Dropped";

/** Every status a block shows, in the Summary's order, then `dropped`. */
export const BLOCK_STATUSES: readonly {
  key: BlockStatus;
  label: string;
  shape: string;
}[] = [
  ...PROGRESS_BUCKETS.map((b) => ({
    key: b.key as BlockStatus,
    label: b.label,
    shape: SHAPE[b.key],
  })),
  { key: "dropped", label: DROPPED_LABEL, shape: SHAPE.dropped },
];

/** The word and shape for a status; one the contract may add later reads as
 *  "Status unknown" rather than as nothing. */
export function statusWords(status: string | null | undefined): {
  label: string;
  shape: string;
} {
  const found = BLOCK_STATUSES.find((s) => s.key === status);
  if (found) return found;
  const unknown = BLOCK_STATUSES.find((s) => s.key === "unknown")!;
  return { label: unknown.label, shape: unknown.shape };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

const METHOD_WORDS: Record<string, string> = {
  full_review: "Full review",
  light_check: "Light check",
  measured: "Measured",
  manual: "Entered by hand",
};

/** How a stop was measured, in words: "Full review", "Light check". */
export function methodWords(kind: string | null | undefined): string {
  return (kind && METHOD_WORDS[kind]) || "Method not stated";
}

// ---------------------------------------------------------------------------
// Changes and verdicts
// ---------------------------------------------------------------------------

export type DeltaKind = "up" | "down" | "same" | "new" | "unknown";

/** A change since the compared stop: ↑ / ↓ / = / new / unknown, each with
 *  its word. */
export const DELTA: Record<DeltaKind, { shape: string; word: string }> = {
  up: { shape: "↑", word: "up" },
  down: { shape: "↓", word: "down" },
  same: { shape: "=", word: "no change" },
  new: { shape: "+", word: "new" },
  unknown: { shape: "?", word: "unknown" },
};

/**
 * How a value moved. `previous` is `undefined` when the compared stop had no
 * such value at all (the cell, figure or row is new there), and `null` when
 * it had one that was not measured. A move to or from "not measured" cannot
 * be said as up or down, so it is `unknown` — never a move from zero.
 */
export function deltaOf(
  previous: number | null | undefined,
  current: number | null
): DeltaKind {
  if (previous === undefined) return "new";
  if (previous === null || current === null) return "unknown";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "same";
}

/** Whether a move is an improvement on a scale where `better` is up or down;
 *  null when it is not a move either way. */
export function improvement(
  kind: DeltaKind,
  better: "higher" | "lower"
): "better" | "worse" | null {
  if (kind !== "up" && kind !== "down") return null;
  return (kind === "up") === (better === "higher") ? "better" : "worse";
}

export type Verdict = Schemas["SnapshotFigure"]["verdict"];

export const VERDICT: Record<Verdict, { shape: string; word: string }> = {
  met: { shape: "✓", word: "Met" },
  missed: { shape: "✕", word: "Missed" },
  unknown: { shape: "?", word: "Unknown" },
};

/** "Higher is better" / "Lower is better". */
export function betterWords(better: "higher" | "lower"): string {
  return better === "higher" ? "Higher is better" : "Lower is better";
}
