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
 *
 * ## Console style (Phase 3 ride-along) — checked, already satisfied
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` classes this
 * route as a form/dialog surface taking "R9 + R3 only". Audited 2026-08-24:
 * this page file already satisfies R9 — no `<h1>`, no page-level `<Card>`
 * wrapper, body is `p-3 sm:p-6`, and `coord/layout.tsx:41-53` supplies the
 * title. No code change was needed, and that is recorded HERE so the next
 * session reads a verdict instead of re-auditing an unchanged file.
 *
 * NOT in scope, and deliberately: `MergeOrchestrationSettings` carries seven
 * section `<CardTitle>`s. Those are record/section containers inside the page,
 * not a duplicated page title, so R9 does not reach them; migrating that
 * 1500-line component is a list migration this route's classification excludes.
 */

import { MergeOrchestrationSettings } from "@/components/operations/MergeOrchestrationSettings";

export default function MergeSettingsPage() {
  return (
    <div className="p-3 sm:p-6" data-testid="coord-merge-settings-page">
      <MergeOrchestrationSettings />
    </div>
  );
}
