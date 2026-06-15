"use client";

/**
 * /admin/coord/merge-settings — PR Merge Orchestrator operator console.
 *
 * Mounts the (previously orphaned) MergeOrchestrationSettings component:
 * tenant merge defaults + per-repo overrides, the Phase 9 D9.6 SLO
 * dashboard with per-repo rollout promote/demote controls
 * (dry_run/shadow/live), and the D9.4 emergency kill-switch.
 *
 * This page is the interactive surface coord's rollout-promote guard
 * requires: `POST /pr-merge/rollout` rejects non-interactive bearers
 * (403 non_interactive_write_forbidden), so promoting a repo to `live`
 * is only possible from a logged-in dashboard session — i.e. here.
 *
 * This is ENTIRELY a write surface (per-repo rollout promote/demote, the
 * emergency kill-switch, tenant merge defaults). The /admin/coord layout
 * is now viewable by all authenticated users, so this page gates itself.
 * Coord gates the rollout/kill-switch/settings routes on tenant membership
 * (no role tier), so the gate here is "is the caller a coord tenant member":
 * non-members get a read-only notice instead of the mutating component.
 * CoordNav comes from the layout.
 */

import { ShieldAlert } from "lucide-react";
import { MergeOrchestrationSettings } from "@/components/operations/MergeOrchestrationSettings";
import { useCoordIdentity } from "@/components/admin/coord/use-coord-identity";
import { isCoordMember } from "@/lib/coord-permissions";

export default function MergeSettingsPage() {
  const canMutate = isCoordMember(useCoordIdentity());

  if (!canMutate) {
    return (
      <div className="p-3 sm:p-6" data-testid="coord-merge-settings-page">
        <div
          className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm"
          data-testid="coord-merge-settings-readonly"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">
              Merge orchestration requires coordination-layer access
            </p>
            <p className="text-muted-foreground">
              Merge rollout promote/demote, the emergency kill-switch, and
              tenant merge defaults require a linked coord tenant membership.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6" data-testid="coord-merge-settings-page">
      <MergeOrchestrationSettings />
    </div>
  );
}
