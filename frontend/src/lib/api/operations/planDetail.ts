/**
 * `/operations/plans/{slug}`, `.../history` and `.../transition` - one work
 * unit's detail, its status history and the operator transition.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5 + D6, Phase 7). Each function inlines its URL over `OPERATIONS_BASE`,
 * calls `httpClient.fetch` directly and parses through `readJson`.
 */

import type {
  BodyProvenance,
  BodyUnknownReason,
  HasBody,
} from "@/components/admin/coord/planBodySignal";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

export interface CoordWorkUnit {
  slug: string;
  title?: string | null;
  status?: string;
  /**
   * coord `work_units.current_phase`. Omitted from this export interface until
   * 2026-08-29, which silently disarmed `derivePlanStatus`'s `reason` — it
   * reads exactly this field, so the badge could never produce its "phase N"
   * subtitle here even though `/work-units` and `/spawn` show it for the same work
   * unit. The deriver was doing its job; it was being handed a type that had
   * thrown the input away.
   */
  current_phase?: string | null;
  /**
   * coord `work_units.authored_at` — the authoring date coord holds, NULL when
   * it holds none (an undated slug, a coord predating the column, or a unit
   * created through the MCP upsert door by a caller that omitted it). Read
   * through `planAuthoredAt`, which consults the slug's own date prefix first,
   * never directly. Never stood in for by `created_at`, the ingest time.
   */
  authored_at?: string | null;
  /** coord `work_units.updated_at` — the scanner's last touch, not a plan event. */
  updated_at?: string | null;
  /** coord `work_units.first_shipped_at` — derived first `shipped` transition. */
  first_shipped_at?: string | null;
  /**
   * Does this work unit have a plan document? Derived server-side by
   * `operations.py` `get_coord_plan` — the SAME helper the list route uses,
   * over a one-row page, so this surface cannot disagree with the row the
   * operator clicked to reach it. Plan
   * `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`.
   */
  body_provenance?: BodyProvenance;
  has_body?: HasBody;
  body_unknown_reason?: BodyUnknownReason | null;
}

// coord `GET /coord/work-units/{slug}` envelope.
export interface CoordPlanDetailResponse {
  work_unit?: CoordWorkUnit;
  recent_history?: PlanHistoryEntry[];
}

// One `coord.work_unit_status_history` row.
export interface PlanHistoryEntry {
  from_status?: string | null;
  to_status: string;
  transitioned_at: string;
  by_actor?: string | null;
  reason?: string | null;
}

export interface PlanHistoryResponse {
  slug?: string;
  history?: PlanHistoryEntry[];
}
/** `GET /plans/{slug}`. */
export async function fetchPlanDetail(
  slug: string
): Promise<CoordPlanDetailResponse> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CoordPlanDetailResponse>(res, `GET ${url}`);
}

/** `GET /plans/{slug}/history`. */
export async function fetchPlanHistory(
  slug: string
): Promise<PlanHistoryResponse> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}/history`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PlanHistoryResponse>(res, `GET ${url}`);
}

/** `POST /plans/{slug}/transition` - the operator's status lever. */
export async function transitionPlan(
  slug: string,
  body: { status: string; note?: string }
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}/transition`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readJson<unknown>(res, `POST ${url}`);
}
