"use client";

/**
 * /admin/coord/test-targets — fleet-fresh test-target routing.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 4. This was
 * a panel two disclosures deep inside the pipeline page's `System details`
 * drawer — inside a page about merge state, which is not what it is about.
 *
 * It is a **config editor with four write paths**
 * (`PATCH /fleet/apps/{app_id}`, `PUT` / `DELETE
 * /fleet/test-targets/{device_id}/{app_id}`, `POST /dispatch/fresh-host`), and
 * a config editor that can only be found by opening a collapsed section on
 * another domain's page is unreachable in the way that matters. It gets a
 * route.
 *
 * The panel owns its own read and 15 s poll; this page adds none.
 */

import { FleetTestTargetsPanel } from "@/components/operations";

export default function CoordTestTargetsPage() {
  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-test-targets-page">
      <p className="text-xs text-muted-foreground">
        Which machine runs a fresh build of each app, how that app is brought up
        to date (<code className="mx-1">pull_only</code> or
        <code className="mx-1">pull_build</code>), and the per-device freshness
        coord joined from
        <code className="mx-1">project.app_deploy_state</code>. Everything on
        this page writes: changing a strategy, designating a test host, or
        dispatching onto a fresh one all take effect on the fleet.
      </p>
      <FleetTestTargetsPanel />
    </div>
  );
}
