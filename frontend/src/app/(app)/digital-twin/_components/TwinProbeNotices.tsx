"use client";

import { AlertTriangle, Lock } from "lucide-react";

/**
 * The two notices every view of the sub-space probe shares (the Completeness
 * matrix and the Lifecycle view read the same `useDigitalTwinSubspaces` data,
 * so they must degrade the same way).
 */

/**
 * coord's coarse twin tenant gate denied this operator (home tenant outside
 * the configured internal-tenant allowlist): EVERY probe was refused
 * (`resolve.ts` `allProbesRestricted`). Rendered INSTEAD of the view rather
 * than an all-"error" grid — it's an access decision, not an outage. A single
 * refused sub-space never reaches here; it renders as its own `restricted`
 * cell, so this copy stays true whenever it shows.
 */
export function TwinAccessRestricted() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
      <Lock className="size-8 text-muted-foreground" />
      <h2 className="text-base font-semibold">Access restricted</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        The Digital Twin is limited to internal Qontinui operators. Your tenant
        isn&apos;t on the allowlist for the fleet-wide twin observers — ask an
        administrator if you need access.
      </p>
    </div>
  );
}

/** The probe request itself failed; the manifest still renders below it. */
export function CoordUnreachableBanner({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-4 shrink-0" />
      <span>
        Could not reach the coordination layer
        {error instanceof Error ? `: ${error.message}` : ""}. Live cells fall
        back to their last status; the taxonomy below is still accurate.
      </span>
    </div>
  );
}
