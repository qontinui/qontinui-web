/**
 * `GET /operations/coord/next-step-settings/fleet` — every tenant's
 * next-step autonomy setting plus coord's master switch, for the policies
 * page.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). The caller owns the retry policy (`options`).
 */

import type { AutonomyLevel } from "@/app/(app)/admin/coord/policies/policyAutonomyStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export interface TenantPolicySetting {
  tenant_id: string;
  slug: string;
  autonomy_level: AutonomyLevel;
  effective: boolean;
  updated_at: string;
}

export interface FleetNextStepSettings {
  master_enabled: boolean;
  tenants: TenantPolicySetting[];
}

export async function fetchFleetNextStepSettings(
  options?: HttpOptions
): Promise<FleetNextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings/fleet`;
  const res = await httpClient.fetch(url, { ...options, method: "GET" });
  return readJson<FleetNextStepSettings>(res, `GET ${url}`);
}
