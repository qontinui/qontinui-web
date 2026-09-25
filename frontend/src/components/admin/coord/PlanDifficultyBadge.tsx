"use client";

/**
 * The plan-difficulty chip on a `/admin/coord/work-units` row.
 *
 * Neutral by design — see `planDifficulty.ts` ("No hue"): the level is the
 * word plus a signal-bars glyph whose shape differs per level. `data-difficulty`
 * carries the machine-readable state (`high` | `medium` | `low` | `unrated` |
 * `unknown`) for specs and audits.
 */

import {
  CircleHelp,
  SignalHigh,
  SignalLow,
  SignalMedium,
  type LucideIcon,
} from "lucide-react";
import {
  describeDifficultyCell,
  type DifficultyCell,
  type DifficultyLevel,
} from "./planDifficulty";

const GLYPH: Record<DifficultyLevel, LucideIcon> = {
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
};

export function PlanDifficultyBadge({ cell }: { cell: DifficultyCell }) {
  const { label, title } = describeDifficultyCell(cell);
  const state = cell.kind === "rated" ? cell.item.difficulty : cell.kind;
  const Glyph =
    cell.kind === "rated" ? GLYPH[cell.item.difficulty] : CircleHelp;
  const muted = cell.kind !== "rated";
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] leading-none",
        muted ? "text-muted-foreground/70 italic" : "text-foreground/80",
      ].join(" ")}
      data-testid="coord-plan-difficulty"
      data-difficulty={state}
      title={title}
    >
      <Glyph className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
