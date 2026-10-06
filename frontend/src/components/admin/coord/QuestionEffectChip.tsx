"use client";

/**
 * QuestionEffectChip — the "this row mirrors a decision" chip.
 *
 * Plan `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
 * Phases 2–3. Rendered by `QuestionRow` (the inbox) and the
 * `/admin/coord/questions/[id]` detail route, off the one pure derivation in
 * `questionEffect.ts`, so the two surfaces cannot disagree about which
 * decision a row mirrors. Renders NOTHING for an ordinary question — including
 * every row from a coord build that omits `effect_kind` — so those rows look
 * exactly as they did before the columns existed.
 *
 * Style: a KIND label, not a status. It sits in the row's status slot beside
 * the `plan_phase` chip and matches that chip's shape (outline `Badge`,
 * `text-[10px]`), taking its hue from the `components.css` `.badge-*` palette.
 * None of the hues is red or amber: under the console style guide's R3 those
 * carry attention claims (an agent is stopped / it will clear itself), and the
 * row's own `StatusBadge` already makes the attention claim for this row.
 *
 * `linked` renders the chip as a link to the effect's own console page (the
 * gate row on `/admin/coord/gates`, the proposal on
 * `/admin/coord/prompt-document-proposals`). The inbox row passes `false`
 * because the collapsed row is itself a toggle button and a nested link would
 * be invalid interactive content; the row's expanded detail and the detail
 * route carry the link instead.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  QuestionEffect,
  QuestionEffectKind,
} from "@/components/admin/coord/questionEffect";

const EFFECT_BADGE_CLASS: Record<QuestionEffectKind, string> = {
  gate: "badge-info",
  proposal: "badge-secondary",
  clause: "badge-muted",
  unknown: "badge-muted",
};

export function QuestionEffectChip({
  effect,
  linked = false,
  showDetail = true,
  className,
}: {
  effect: QuestionEffect | null;
  linked?: boolean;
  showDetail?: boolean;
  className?: string;
}) {
  if (!effect) return null;
  const chip = (
    <Badge
      variant="outline"
      data-testid="coord-question-effect-chip"
      data-effect-kind={effect.kind}
      title={effect.title}
      className={cn(
        "text-[10px] font-mono",
        EFFECT_BADGE_CLASS[effect.kind],
        className
      )}
    >
      {effect.label}
      {showDetail && effect.detail && (
        <span
          className="ml-1 max-w-[16rem] truncate font-sans text-foreground/80"
          data-testid="coord-question-effect-detail"
        >
          {effect.detail}
        </span>
      )}
    </Badge>
  );
  if (!linked || !effect.href) return chip;
  return (
    <Link
      href={effect.href}
      data-testid="coord-question-effect-link"
      className="inline-flex hover:underline"
    >
      {chip}
    </Link>
  );
}
