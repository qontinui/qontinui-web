"use client";

/**
 * One verdict, as a word AND a shape (✓ met, ✕ missed, ? unknown), so colour
 * is never the only signal (plan `2026-10-06-overview-objectives-view` D10).
 * Tones follow the visual system's contract: red is "someone must act",
 * amber is the ignorance floor.
 */

import { cn } from "@/lib/utils";
import { VERDICT_LOOK } from "../../_lib/objectives";
import type { Verdict } from "../../_lib/objectives-api";

const TONE_CLASS = {
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
} as const;

export function VerdictMark({
  verdict,
  uiBridgeId,
  className,
}: {
  verdict: Verdict;
  uiBridgeId: string;
  className?: string;
}) {
  const look = VERDICT_LOOK[verdict];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium",
        TONE_CLASS[look.tone],
        className
      )}
      data-ui-bridge-id={uiBridgeId}
      data-verdict={verdict}
    >
      <span aria-hidden>{look.symbol}</span>
      {look.word}
    </span>
  );
}

/** A tally of all three verdicts — unknown is never folded into "other". */
export function TallyMarks({
  tally,
  uiBridgeId,
}: {
  tally: { met: number; missed: number; unknown: number };
  uiBridgeId: string;
}) {
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-3 text-sm"
      data-ui-bridge-id={uiBridgeId}
    >
      {(["met", "missed", "unknown"] as const).map((v) => (
        <span
          key={v}
          // A zero obliges nobody to act, so it takes no attention colour.
          className={
            tally[v] === 0
              ? "text-muted-foreground"
              : TONE_CLASS[VERDICT_LOOK[v].tone]
          }
        >
          <span aria-hidden>{VERDICT_LOOK[v].symbol} </span>
          {tally[v]} {v}
        </span>
      ))}
    </span>
  );
}
