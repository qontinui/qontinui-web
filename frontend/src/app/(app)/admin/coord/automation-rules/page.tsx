"use client";

/**
 * /admin/coord/automation-rules — tenant-scoped authoring UI for the unified
 * automation-rule framework (terminal auto-response rules + agent-question
 * auto-answer rules).
 *
 * Plan `2026-06-13-unified-automation-rule-framework.md` Phase 6. Replaces the
 * deleted org-scoped #580 Settings UI (`settings/auto-response/`): the
 * RuleList / RuleEditorDialog / BackoffFields / live-regex hint were copied
 * here and re-scoped from org (`useOrganization` + `organizationService`) to
 * tenant-admin — they now author through the coord-proxy
 * (`/api/v1/operations/coord/policies`), which resolves the tenant from the
 * operator bearer.
 *
 * Crawl-safety: this is a child of the `/admin/coord` layout, which gates the
 * whole subtree on `user?.is_superuser` and renders `null` otherwise. The
 * Spec-CI crawl has no authenticated user, so the body never mounts — and it
 * talks ONLY to the always-registered `httpClient` (never a cloud-only
 * extension slot like `organizationService`), so there is no slot console.error
 * for the crawl gate to catch. Same posture as every existing admin/coord page;
 * no extra `getService(...)` guard is needed here.
 *
 * ## Console style (Phase 3 ride-along) — R9 only
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` classes this
 * route as a form/dialog surface, not a list, and says such routes "ride along
 * in whichever wave touches them, taking R9 + R3 only". No wave touched it, so
 * the ride-along is done here explicitly rather than left to be discovered as a
 * gap after Phase 3 was declared finished.
 *
 * - **R9** — the page `<h1>Automation Rules</h1>` and its 5-size icon are gone;
 *   `coord/layout.tsx:41-53` already renders the console title and the nav
 *   crumb naming this route, so the heading was a duplicated title. The two
 *   muted paragraphs fold onto one line, which keeps BOTH signals: what the
 *   rules do, and that the visible set is identity-scoped. Body padding moves
 *   from `p-6` to the console's `p-3 sm:p-6`.
 * - **R3** — nothing to correct. This page renders no kind-keyed status hue at
 *   page scope, so it enrols no palette in `console/attention.test.ts`. Adding
 *   an empty row there would be an audit of nothing.
 *
 * NOT done here, and deliberately: the section `<Card>`s inside `RuleList` are
 * record containers, not a duplicated page title, and R2/R5 on the rule list is
 * a list migration this route's classification excludes.
 */

import { Workflow } from "lucide-react";
import { RuleList } from "./_components/RuleList";

export default function AutomationRulesPage() {
  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="automation-rules-page">
      {/* R9 — no page <h1>: `coord/layout.tsx` already renders the console
          title and the nav crumb naming this route. What survives is the part
          the shell does NOT say: what these rules DO, and whose they are. The
          identity caveat is load-bearing rather than decorative — the set on
          screen changes with the signed-in identity — so it stays, folded onto
          the same muted line instead of costing a second paragraph. */}
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Workflow
          className="mt-0.5 size-4 shrink-0"
          aria-hidden
          data-testid="automation-rules-icon"
        />
        <span>
          Tenant-scoped rules that auto-respond to terminal output or
          auto-answer agent questions, authored in coord and served to every
          runner in the fleet. They apply to your current workspace — a
          different identity sees a different set, including its own overrides
          of built-in rules.
        </span>
      </p>

      <RuleList />
    </div>
  );
}
