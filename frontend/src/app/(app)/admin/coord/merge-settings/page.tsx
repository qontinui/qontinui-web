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
 * Admin-gating + CoordNav come from the /admin/coord layout.
 */

import { MergeOrchestrationSettings } from "@/components/operations/MergeOrchestrationSettings";

export default function MergeSettingsPage() {
  return (
    <div className="p-3 sm:p-6" data-testid="coord-merge-settings-page">
      <MergeOrchestrationSettings />
    </div>
  );
}
