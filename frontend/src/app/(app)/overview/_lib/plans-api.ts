/**
 * The project's work units — the plans behind `/api/v1/operations/plans` —
 * read once here for every overview page that shows them (the Summary's
 * progress figures, the Timeline's shipped-plans lane).
 */

import { httpClient } from "@/services/service-factory";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";

/** Same window the Coord Console's plan list reads. */
export const PLAN_FETCH_LIMIT = 500;

/**
 * Up to `PLAN_FETCH_LIMIT` rows. A full page means there may be more: the
 * caller judges truncation on what this returns, before any filter of its own.
 */
export async function fetchPlanRows(): Promise<CoordPlanRow[]> {
  const qs = new URLSearchParams({
    limit: String(PLAN_FETCH_LIMIT),
    exclude_slug_prefix: SHEPHERD_SLUG_PREFIX,
  });
  const body = await httpClient.get<{
    work_units?: CoordPlanRow[];
    plans?: CoordPlanRow[];
  }>(`/api/v1/operations/plans?${qs.toString()}`);
  return body.work_units ?? body.plans ?? [];
}
