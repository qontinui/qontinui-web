"use client";

import { ChevronDown } from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Badge } from "@/components/ui/badge";
import {
  StatCluster,
  UNKNOWN_AMBER,
  type Stat,
  type StatTone,
} from "@/components/console";
import {
  Caption,
  NAVIGATION_ONLY_PROPS,
  Provenance,
  captionEntry,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import type { FidelityFigure, TwinAspect } from "../_lib/twin-aspects";
import {
  PLAN_PROGRESS_LABEL,
  PLAN_PROGRESS_ORDER,
  countByProgress,
  type GroupPlan,
  type PlanProgress,
  type TwinPlanRead,
} from "../_lib/twin-plans";
import { FIGURE_UNKNOWN, FidelityFigures } from "./FidelityFigures";

/** The id of the one drill-down panel the cards open (`aria-controls`). */
export const ASPECT_DETAIL_ID = "digital-twin-aspect-detail";

/** Where the plan counts come from, in the reader's words. */
export const PLAN_SOURCE = "coord's work-unit list";

const PROGRESS_TONE: Readonly<Record<PlanProgress, StatTone>> = {
  "in-flight": "default",
  // Blocked on a person: the one count a human must act on.
  blocked: "attention",
  queued: "muted",
  unknown: "warning",
  done: "success",
};

/** The plans moving an aspect, counted by progress — or why they cannot be. */
function PlanSummary({
  aspectId,
  read,
  plans,
}: {
  aspectId: string;
  read: TwinPlanRead;
  plans: readonly GroupPlan[] | null;
}) {
  const testId = `digital-twin-aspect-${aspectId}-plans`;
  if (read.kind === "loading") {
    return (
      <p data-testid={testId} className="text-xs text-muted-foreground">
        Reading the plans…
      </p>
    );
  }
  if (read.kind === "error" || plans === null) {
    return (
      <div
        data-testid={testId}
        data-plans-state="unknown"
        className="space-y-1"
      >
        <Badge
          variant="outline"
          className={cn("text-[11px] font-semibold", UNKNOWN_AMBER)}
        >
          {FIGURE_UNKNOWN}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {read.kind === "error"
            ? `The plans could not be read: ${read.reason}`
            : "The plans could not be read."}
        </p>
        <Provenance
          source={PLAN_SOURCE}
          asOf={read.kind === "error" ? read.at : null}
        />
      </div>
    );
  }
  const counts = countByProgress(plans);
  const stats: Stat[] = PLAN_PROGRESS_ORDER.filter(
    // An unknown-status count shows only when there is one to show; the
    // others always do, so "0 blocked" is a stated fact, not an absence.
    (progress) => progress !== "unknown" || counts.unknown > 0
  ).map((progress) => ({
    key: progress,
    label: PLAN_PROGRESS_LABEL[progress],
    value: counts[progress],
    tone: PROGRESS_TONE[progress],
    "data-testid": `${testId}-${progress}`,
  }));
  return (
    <div data-testid={testId} data-plans-state="known" className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {plans.length === 1 ? "1 plan" : `${plans.length} plans`} moving it
        {read.incomplete ? " among the work units read" : ""}
      </p>
      <StatCluster stats={stats} />
      <Provenance source={PLAN_SOURCE} asOf={read.asOf} />
    </div>
  );
}

/**
 * One aspect of the twin on the Twin map: its caption, its fidelity, and the
 * plans moving it with their live status. The toggle opens the drill-down —
 * the aspect's parts and plans — below the cards. It only changes what is
 * displayed, so it stays live in presentation mode (`NAVIGATION_ONLY_PROPS`).
 */
export function AspectCard({
  aspect,
  figures,
  read,
  plans,
  open,
  onToggle,
}: {
  aspect: TwinAspect;
  figures: readonly FidelityFigure[];
  read: TwinPlanRead;
  /** The aspect's plans (`plansForSubspaces`), or `null` while none are read. */
  plans: readonly GroupPlan[] | null;
  open: boolean;
  onToggle: () => void;
}) {
  const title = captionEntry(aspect.captionKey).title;
  // UI Bridge: one stable id per aspect, so automation can open it.
  const { ref } = useUIElement({
    id: `digital-twin-aspect-${aspect.id}`,
    label: `Twin map — show what the ${title} observes and the plans moving it`,
    type: "button",
  });

  return (
    <article
      data-testid={`digital-twin-aspect-card-${aspect.id}`}
      data-aspect-open={open ? "true" : "false"}
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-card p-4",
        open ? "border-primary" : "border-border"
      )}
    >
      <Caption id={aspect.captionKey} level={3} persistent />
      <FidelityFigures
        figures={figures}
        testIdPrefix={`digital-twin-aspect-${aspect.id}-fidelity`}
      />
      <PlanSummary aspectId={aspect.id} read={read} plans={plans} />
      <button
        ref={ref}
        type="button"
        {...NAVIGATION_ONLY_PROPS}
        aria-expanded={open}
        aria-controls={ASPECT_DETAIL_ID}
        onClick={onToggle}
        className="mt-auto flex items-center gap-1.5 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
        {open ? "Hide its parts and plans" : "Show its parts and plans"}
      </button>
    </article>
  );
}
