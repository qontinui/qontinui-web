"use client";

/**
 * /admin/coord/plan-library/settings — the plan library's two policy dials.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1
 * and Design decision 4b. Split from the browsing page by MUTATION FREQUENCY,
 * not by feature: these are the only controls over the plan corpus that
 * change what the fleet does, they are touched rarely, and they are
 * tenant-admin-gated on the backend (`require_coord_tenant_admin`, reflected
 * in the UI via `can_edit`). A stable, linkable URL of their own keeps them
 * out of the page an operator opens constantly just to find a plan
 * (`/admin/coord/plans`).
 *
 * - `CapturePolicyPanel` — the `plan_capture` fleet-policy toggle. It shows
 *   the value devices RESOLVE, not the value last written.
 * - `CitationBackfillPolicyPanel` — `citation_scope_backfill_write` (`off` |
 *   `dry_run` | `live`): whether an AGENT may run the delivery-scope citation
 *   backfill write (plan
 *   `2026-09-23-delivery-scope-backfill-write-is-operator-only-so-a-mechanical-reconcile-needs-a-human`).
 *
 * R9: no page-level card and no `<h1>` — the coord layout owns both.
 */

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { CapturePolicyPanel } from "../_components/CapturePolicyPanel";
import { CitationBackfillPolicyPanel } from "../_components/CitationBackfillPolicyPanel";

export default function PlanLibrarySettingsPage() {
  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="plan-library-settings-page"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <Settings2
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden
        />
        <h2 className="text-sm font-semibold">Plan library settings</h2>
        <p className="max-w-4xl text-xs text-muted-foreground">
          The plan library is a searchable <em>index</em> of what the fleet
          writes — <strong>not a backup</strong>. Browse and search it on{" "}
          <Link
            href="/admin/coord/plans"
            className="underline"
            data-testid="plan-library-settings-plans-link"
          >
            Plans
          </Link>
          ; every other artifact kind is on the{" "}
          <Link
            href="/admin/coord/plan-library/artifacts"
            className="underline"
            data-testid="plan-library-settings-artifacts-link"
          >
            Artifact library
          </Link>
          .
        </p>
      </div>

      <CapturePolicyPanel />
      <CitationBackfillPolicyPanel />
    </div>
  );
}
