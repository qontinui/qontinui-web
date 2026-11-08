/**
 * How a report block shows a number and its change since the compared stop
 * (plan `2026-11-07-interactive-stakeholder-reports-in-the-project-overview`
 * D3, D5).
 *
 * A change is a SHAPE plus a WORD — ↑ up, ↓ down, = no change, + new,
 * ? unknown — and never colour alone: the mark is drawn in one neutral tone,
 * and whether a move is better or worse is said in words (the scale says
 * which way is better; the mark's tooltip and screen-reader text say it of
 * this move).
 */

import { DELTA, improvement, type DeltaKind } from "./vocabulary";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A snapshot number as the overview writes it. */
export function formatValue(value: number): string {
  return NUMBER.format(value);
}

/** The change in a sentence: "up from 2 to 3 since Baseline review (better)". */
export function deltaSentence(
  kind: DeltaKind,
  previous: number | null | undefined,
  current: number | null,
  comparedLabel: string,
  better?: "higher" | "lower"
): string {
  switch (kind) {
    case "new":
      return `new since ${comparedLabel}`;
    case "same":
      return `no change since ${comparedLabel}`;
    case "unknown":
      return current === null
        ? previous === null || previous === undefined
          ? `not measured here or at ${comparedLabel}`
          : `not measured now; it was ${formatValue(previous)} at ${comparedLabel}`
        : `not measured at ${comparedLabel}, so it can't be compared`;
    case "up":
    case "down": {
      const way = better ? improvement(kind, better) : null;
      return `${DELTA[kind].word} from ${formatValue(previous as number)} to ${formatValue(current as number)} since ${comparedLabel}${way ? ` (${way})` : ""}`;
    }
  }
}

export function DeltaMark({
  kind,
  previous,
  current,
  comparedLabel,
  better,
}: {
  kind: DeltaKind;
  previous: number | null | undefined;
  current: number | null;
  comparedLabel: string;
  better?: "higher" | "lower";
}) {
  const { shape, word } = DELTA[kind];
  const sentence = deltaSentence(
    kind,
    previous,
    current,
    comparedLabel,
    better
  );
  return (
    <span
      className="ml-2 inline-flex items-baseline gap-0.5 text-xs text-muted-foreground"
      title={sentence}
      data-delta={kind}
    >
      <span aria-hidden>{shape}</span>
      <span>{word}</span>
      <span className="sr-only">: {sentence}</span>
    </span>
  );
}
