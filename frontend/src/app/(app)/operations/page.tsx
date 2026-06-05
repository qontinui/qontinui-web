"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CiStatusPanel,
  FleetOverview,
  GatesPanel,
  LandedFeaturesPanel,
  MergeDependencyGraph,
  MergeTrain,
} from "@/components/operations";
import { Activity } from "lucide-react";

export default function OperationsPage() {
  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Operations</h1>
            <p className="text-xs text-muted-foreground">
              Cross-machine fleet view — runners, Claude Code sessions, and
              active workflows.
            </p>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4 space-y-4">
          {/*
           * Merge train anchors at the top — it is the demo's primary
           * visual anchor per `plans/2026-05-18-coordination-layer-demos.md`
           * §5.2.1. FleetOverview below shows the machines + Claude
           * sessions. LandedFeaturesPanel surfaces the deployed demo
           * features via embedded iframes (§5.2.2).
           */}
          <MergeTrain />
          {/*
           * PR Merge Orchestrator Phase 5 D5.5 — cross-repo
           * dependency DAG. Operator inputs (repo, pr) to render the
           * connected component. Anchor id matches the in-link from
           * MergeTrain.tsx's "Cross-repo dependencies" section.
           */}
          <div id="merge-dep-graph">
            <MergeDependencyGraph />
          </div>
          {/*
           * CI Status Dashboard (plan 2026-05-25-ci-status-dashboard).
           * Per-repo red/amber/green main + open-PR check view, pushed
           * live via useCiStatusStream, with a per-repo "notify when
           * green" gate action.
           */}
          <CiStatusPanel />
          {/*
           * Gates panel (plan
           * 2026-06-05-plan-gate-web-surface-and-productization Phase 2).
           * Tenant-scoped list + light reversible management (approve /
           * mute / snooze) of the user's coord gates — the read/manage
           * surface for the gate system that already runs in coord.
           */}
          <GatesPanel />
          <FleetOverview />
          <LandedFeaturesPanel />
        </div>
      </ScrollArea>
    </div>
  );
}
