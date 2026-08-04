"use client";

/**
 * /admin/coord/merge-settings — PR Merge Orchestrator operator console.
 *
 * Mounts the (previously orphaned) MergeOrchestrationSettings component:
 * tenant merge defaults + per-repo overrides, and the Phase 9 D9.6 SLO
 * dashboard with per-repo `merge_enabled` switches.
 *
 * This page is the interactive surface coord's write guard requires:
 * `POST /pr-merge/merge-enabled` rejects non-interactive bearers
 * (403 non_interactive_write_forbidden), so enabling merges on a repo is
 * only possible from a logged-in dashboard session — i.e. here.
 * Admin-gating + CoordNav come from the /admin/coord layout.
 *
 * The emergency stop is deliberately NOT here. It lives per-repo on the
 * fleet page's merge-train view (`MergeTrainActivity`), because that is the
 * surface an operator is on mid-incident — this one is for calibration.
 */

import { MergeOrchestrationSettings } from "@/components/operations/MergeOrchestrationSettings";

export default function MergeSettingsPage() {
  return (
    <div className="p-3 sm:p-6" data-testid="coord-merge-settings-page">
      <MergeOrchestrationSettings />
    </div>
  );
}
