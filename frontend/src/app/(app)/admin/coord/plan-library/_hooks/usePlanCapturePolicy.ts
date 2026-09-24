"use client";

import { PLAN_CAPTURE_DOMAIN, type PlanCaptureLevel } from "../types";
import { useTenantFleetPolicyDial } from "./useTenantFleetPolicyDial";

/**
 * The `plan_capture` fleet-policy toggle (`off` | `record`).
 *
 * A binding of the shared tenant-band dial; the read-back honesty properties
 * live — and are documented — in `useTenantFleetPolicyDial`.
 */
export function usePlanCapturePolicy() {
  return useTenantFleetPolicyDial<PlanCaptureLevel>(
    PLAN_CAPTURE_DOMAIN,
    "plan capture"
  );
}
