/**
 * The reads `/admin/coord/spawns` states provenance for, by name — one
 * `Provenance` chip each, beside the section whose numbers come from it (plan
 * `2026-10-23-console-presentation-spaces` D1, "provenance on"). The fleet
 * reads keep Dev Ops' names, so one read is named one way on every lens page.
 */

import { DEVOPS_SOURCES } from "@/components/operations/devOpsHeadline";

export const SPAWNS_SOURCES = {
  ledger: "coord spawn ledger",
  ledgerWaiting: "coord spawn ledger (requests still waiting)",
  registry: "coord agent registry",
  tenantDefaults: "coord agent registry defaults",
  nextStep: "coord next-step settings",
  mergeSettings: "coord merge settings",
  followupScopes: "coord follow-up scopes",
  sessionRuns: "coord session run record",
  fleetHealth: DEVOPS_SOURCES.fleetHealth,
  drainState: DEVOPS_SOURCES.drainState,
  dispatchRoles: DEVOPS_SOURCES.dispatchRoles,
} as const;
