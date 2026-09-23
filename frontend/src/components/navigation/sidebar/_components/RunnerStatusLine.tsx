"use client";

import { Monitor } from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useActiveRunner,
  type RunnerListState,
  type RunnerPin,
} from "@/contexts/active-runner-context";
import {
  LOCALITY_PHRASE,
  RUNNER_DOT_LABEL,
  RunnerStateDot,
  runnerDotClass,
  runnerLocality,
  type RunnerDotStatus,
} from "@/components/runner/runner-state";
import type { RunnerLocality } from "@/lib/runner/locality";
import type { ResolvedRunnerState } from "@/lib/runner/resolve";
import { cn } from "@/lib/utils";

interface RunnerStatusLineProps {
  isCollapsed: boolean;
}

/** The dot describes the runner reads currently address. */
function getStatus(
  activeRunner: Runner | null,
  listState: RunnerListState,
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerDotStatus {
  // An empty list means "no runner" only once it has actually loaded.
  if (listState === "failed") return "list_unavailable";
  if (listState === "loading") return "list_loading";
  if (activeRunner === null) return "none";
  return runnerLocality(activeRunner, localityById);
}

/** The line when reads address no listed runner. */
function unresolvedLabel(
  listState: RunnerListState,
  runnerCount: number,
  resolution: ResolvedRunnerState
): string {
  if (listState === "failed") return "Runner list unavailable";
  if (listState === "loading") return "Loading runners";
  if (runnerCount === 0) return "No runner paired";
  switch (resolution.status) {
    case "loading":
      return "Resolving runner";
    case "no_capable":
    case "all_drained":
    case "pin_ineligible":
      return "No runner available";
    default:
      return "Runner unknown";
  }
}

/**
 * The resolver's state, when it is not simply "coord named this runner": it
 * is UNKNOWN, it answered that nothing is eligible for NEW work, or it moved
 * off the user's pick. Reads then keep a runner (the pick while online, the
 * last resolved one, one proven on this machine, or the only one) — never
 * the first listed — and say so.
 */
function resolverNotice(
  pin: RunnerPin | null,
  resolution: ResolvedRunnerState,
  activeRunner: Runner | null
): string | null {
  switch (resolution.status) {
    case "unavailable":
    case "drain_unreadable":
      if (!activeRunner) return "Resolver unavailable";
      return pin?.id === activeRunner.id
        ? "Resolver unavailable — using your pick"
        : `Resolver unavailable — showing ${activeRunner.name ?? "this runner"}'s data`;
    case "no_capable":
    case "all_drained":
    case "pin_ineligible":
      return activeRunner
        ? "Not eligible for new work — showing its data"
        : "No runner is eligible for new work";
    case "resolved":
      return pin && resolution.deviceId !== pin.id
        ? "Your pick is unavailable — coord chose this runner"
        : null;
    default:
      return null;
  }
}

/**
 * The sidebar's runner STATUS line — status only, never a control. It names
 * the runner reads currently address with its measured locality, plus the
 * resolver's state. Where work runs is chosen on the execution surfaces
 * ("Run on:"), where the choice means something (plan Phase 4).
 */
export function RunnerStatusLine({ isCollapsed }: RunnerStatusLineProps) {
  const { activeRunner, runners, pin, listState, localityById, resolution } =
    useActiveRunner();

  const status = getStatus(activeRunner, listState, localityById);
  const locality =
    activeRunner === null
      ? null
      : LOCALITY_PHRASE[runnerLocality(activeRunner, localityById)];
  const label = activeRunner
    ? `Runner: ${activeRunner.name ?? "unnamed"}`
    : unresolvedLabel(listState, runners.length, resolution);
  const notice =
    listState === "loaded" && runners.length > 0
      ? resolverNotice(pin, resolution, activeRunner)
      : null;
  const summary = [label, locality].filter(Boolean).join(" · ");

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            role="status"
            data-ui-bridge-id="shell.runner-status"
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover"
          >
            {/* The status itself, inside the live region: announced when it
                changes and read on focus, not only held in a label. */}
            <span className="sr-only">
              {notice ? `${summary}. ${notice}` : summary}
            </span>
            <div className="relative" aria-hidden>
              <Monitor className="size-4" />
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 size-2 rounded-full border border-surface-canvas",
                  runnerDotClass(status)
                )}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {summary}
          {!activeRunner && (
            <span className="block text-text-subtle">
              {RUNNER_DOT_LABEL[status]}
            </span>
          )}
          {notice && <span className="block text-text-subtle">{notice}</span>}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      role="status"
      data-ui-bridge-id="shell.runner-status"
      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-text-muted"
    >
      <RunnerStateDot status={status} />
      <span className="min-w-0 truncate text-xs">
        {label}
        {locality && <span className="text-text-subtle"> · {locality}</span>}
        {notice && (
          <span className="block truncate text-text-subtle">{notice}</span>
        )}
      </span>
    </div>
  );
}
