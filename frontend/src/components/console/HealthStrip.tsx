"use client";

/**
 * HealthStrip — the one derived traffic-light row a list surface opens with.
 *
 * **Enforces R1 — "Health strip first."**
 * See `frontend/docs/console-ui-style-guide.md` §2 R1 and §3.2.
 *
 * Generalised out of `MergePipeline.tsx`'s own `HealthStrip` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1. The
 * merge pipeline's version took `PipelineRow[]` and derived the health itself;
 * this one takes the ALREADY-DERIVED verdict, because R1's load-bearing clause
 * is *"derived from data already on the page, never a second fetch"* — and the
 * only way a shared primitive can hold that clause is by not being able to
 * fetch at all. It renders `{level, headline, detail, badges[]}` and nothing
 * else.
 *
 * The badge cluster is right-aligned mono counts, and a badge may be clickable
 * (the merge pipeline's "needs attention N" jumps to that filter). A clickable
 * badge is a real `<button>` wrapping the badge in `display: contents`, so the
 * affordance is in the accessibility tree without changing the layout.
 */

import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** Traffic-light level. Same vocabulary as `prPipeline`'s `HealthLevel`. */
export type HealthStripLevel = "green" | "amber" | "red";

/** Dot treatment per level. Green pulses; a steady dot reads as stale. */
const LIGHT_CLASS: Record<HealthStripLevel, string> = {
  green: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse",
  amber: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
  red: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]",
};

const HEADLINE_CLASS: Record<HealthStripLevel, string> = {
  green: "text-foreground",
  amber: "text-amber-200",
  red: "text-red-200",
};

const BORDER_CLASS: Record<HealthStripLevel, string> = {
  green: "border-border",
  amber: "border-amber-500/35",
  red: "border-red-500/40",
};

/**
 * Badge tone. Note this is NOT the R3 attention palette: a count badge is a
 * measurement of the whole surface, not a row whose owner we are naming.
 * `attention` is the one tone that borrows red, and only for the count of rows
 * that genuinely need a human.
 */
export type HealthBadgeTone = "default" | "muted" | "attention";

const BADGE_TONE_CLASS: Record<HealthBadgeTone, string> = {
  default: "",
  muted: "text-muted-foreground",
  attention: "text-red-200 border-red-500/35",
};

export interface HealthBadge {
  /** React key, and the badge's stable identity. */
  key: string;
  /** Full badge content, e.g. `queue 3`. Mono by construction. */
  label: ReactNode;
  tone?: HealthBadgeTone;
  /** Makes the badge a real button (e.g. "show me those rows"). */
  onClick?: () => void;
  title?: string;
  "data-testid"?: string;
}

export interface HealthStripProps {
  level: HealthStripLevel;
  /** One sentence: "is this healthy?", answerable without reading a row. */
  headline: ReactNode;
  /** The signals behind the verdict, plain language. Optional. */
  detail?: ReactNode;
  /** Right-aligned mono count cluster. */
  badges?: HealthBadge[];
  className?: string;
  "data-testid"?: string;
}

export function HealthStrip({
  level,
  headline,
  detail,
  badges,
  className,
  "data-testid": testId,
}: HealthStripProps) {
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-lg border bg-card/30 px-4 py-2.5 flex-wrap",
        BORDER_CLASS[level],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      data-health-level={level}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${LIGHT_CLASS[level]}`}
        aria-hidden
      />
      <span className={`text-[13px] font-semibold ${HEADLINE_CLASS[level]}`}>
        {headline}
      </span>
      {detail && (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
      {badges && badges.length > 0 && (
        <span className="ml-auto flex items-center gap-2">
          {badges.map((b) => {
            const badge = (
              <Badge
                variant="outline"
                className={[
                  "font-mono text-[11px]",
                  BADGE_TONE_CLASS[b.tone ?? "default"],
                  b.onClick ? "cursor-pointer" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={b.title}
                data-testid={b["data-testid"]}
              >
                {b.label}
              </Badge>
            );
            return b.onClick ? (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                className="contents"
              >
                {badge}
              </button>
            ) : (
              // A Fragment, not a wrapper element: an unclickable badge must
              // be a DIRECT child of the flex cluster or it inherits no gap.
              <Fragment key={b.key}>{badge}</Fragment>
            );
          })}
        </span>
      )}
    </div>
  );
}
