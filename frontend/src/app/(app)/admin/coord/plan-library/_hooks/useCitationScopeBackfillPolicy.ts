"use client";

import {
  CITATION_SCOPE_BACKFILL_WRITE_DOMAIN,
  type CitationScopeBackfillWriteLevel,
} from "../types";
import { useTenantFleetPolicyDial } from "./useTenantFleetPolicyDial";

/**
 * The `citation_scope_backfill_write` fleet-policy dial
 * (`off` | `dry_run` | `live`) — whether an AGENT may run the delivery-scope
 * backfill write through coord's agent door
 * (`POST /coord/citations/backfill-delivery-scope`, own tenant only). The
 * operator SSO door is not governed by it.
 *
 * Plan
 * `2026-09-23-delivery-scope-backfill-write-is-operator-only-so-a-mechanical-reconcile-needs-a-human`.
 * A binding of the shared tenant-band dial; the read-back honesty properties
 * live — and are documented — in `useTenantFleetPolicyDial`.
 */
export function useCitationScopeBackfillPolicy() {
  return useTenantFleetPolicyDial<CitationScopeBackfillWriteLevel>(
    CITATION_SCOPE_BACKFILL_WRITE_DOMAIN,
    "citation-scope backfill write",
    "agents"
  );
}
