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
 */

import { Workflow } from "lucide-react";
import { RuleList } from "./_components/RuleList";

export default function AutomationRulesPage() {
  return (
    <div className="space-y-6 p-6" data-testid="automation-rules-page">
      <div className="flex items-start gap-3">
        <Workflow className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Automation Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenant-scoped rules that auto-respond to terminal output or
            auto-answer agent questions. Authored in coord and served to every
            runner in the fleet.
          </p>
        </div>
      </div>

      <RuleList />
    </div>
  );
}
