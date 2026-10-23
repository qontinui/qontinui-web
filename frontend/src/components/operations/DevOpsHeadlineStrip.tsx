"use client";

/**
 * The Dev Ops headline strip — presentation mode's opening on
 * `/admin/coord/devops` (plan `2026-10-23-console-presentation-spaces`
 * Phase 7).
 *
 * Three figures an external evaluator can read in one glance — machines
 * healthy, agent workspaces in use, CI runners ready — each with the source
 * and as-of of the read behind it, and each UNKNOWN with its reason when that
 * read has not answered or its latest poll failed. The operator console is
 * untouched: `HeadlineFigures` renders nothing outside presentation mode, and
 * the dense health strip below stays exactly as it was.
 *
 * It fetches NOTHING (D3.4, R1). The page owns all three reads — fleet
 * health, worktree slots and the CI-runner mirror are each polled once, there
 * — and hands them in; the derivations are the pure, tested functions in
 * `devOpsHeadline.ts`.
 */

import { useMemo } from "react";
import {
  HeadlineFigures,
  type HeadlineFigure,
} from "@/components/presentation";
import type { CiRunnerMirrorRead } from "./ciRunnerMirror";
import {
  DEVOPS_SOURCES,
  ciRunnersReadyFigure,
  machinesHealthyFigure,
  workspacesInUseFigure,
} from "./devOpsHeadline";
import type { FleetDeviceRef } from "./fleetResources";
import type { UseFleetHealthResult } from "./useFleetHealth";
import type { UseFleetWorktreeSlotsResult } from "./useFleetWorktreeSlots";

export interface DevOpsHeadlineStripProps {
  health: Pick<UseFleetHealthResult, "data" | "error" | "fetchedAtMs">;
  /** The page's device spine, shared with the sections below. */
  devices: FleetDeviceRef[];
  worktreeSlots: Pick<
    UseFleetWorktreeSlotsResult,
    "data" | "error" | "fetchedAtMs"
  >;
  ciRunnerMirror: CiRunnerMirrorRead;
}

export function DevOpsHeadlineStrip({
  health,
  devices,
  worktreeSlots,
  ciRunnerMirror,
}: DevOpsHeadlineStripProps) {
  const figures = useMemo<HeadlineFigure[]>(
    () => [
      {
        key: "machines",
        label: "Machines healthy",
        value: machinesHealthyFigure({
          devices: health.data?.devices ?? [],
          answered: health.data !== null,
          error: health.error,
          fetchedAtMs: health.fetchedAtMs,
        }),
        source: DEVOPS_SOURCES.fleetHealth,
        "data-testid": "devops-headline-machines",
      },
      {
        key: "workspaces",
        label: "Agent workspaces in use",
        value: workspacesInUseFigure({
          devices,
          data: worktreeSlots.data,
          error: worktreeSlots.error,
          fetchedAtMs: worktreeSlots.fetchedAtMs,
        }),
        source: DEVOPS_SOURCES.worktreeSlots,
        "data-testid": "devops-headline-workspaces",
      },
      {
        key: "ci",
        label: "CI runners ready",
        value: ciRunnersReadyFigure(ciRunnerMirror),
        source: DEVOPS_SOURCES.ciRunnerMirror,
        "data-testid": "devops-headline-ci",
      },
    ],
    [
      health.data,
      health.error,
      health.fetchedAtMs,
      devices,
      worktreeSlots.data,
      worktreeSlots.error,
      worktreeSlots.fetchedAtMs,
      ciRunnerMirror,
    ]
  );

  return (
    <HeadlineFigures
      figures={figures}
      label="Dev Ops at a glance"
      data-testid="devops-headline-strip"
    />
  );
}
