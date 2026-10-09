/**
 * `/operations/plans*`, `/operations/domain-cost` and `/operations/trees/*` —
 * coord's work-unit ("plan") registry reads, the operator's status
 * transition, the domain cost ledger and the primary-tree reads.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 7). Each function is the move of a call site that used to type
 * `${API}/plans...` by hand, onto the relative {@link OPERATIONS_BASE} through
 * `httpClient.fetch` and {@link readJson}. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`, the shape `httpStatusOf`,
 * `isNotFoundError` and `describeCoordPollError` read.
 *
 * Reads take the caller's `HttpOptions` — the dashboard polls pass
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request; the next tick is the retry).
 * Each function calls `httpClient.fetch` directly with its URL inline: a
 * shared `request(path)` helper would be a wrapper of a wrapper, which
 * `route-walker.test.ts` cannot resolve.
 */

import type { PrimaryTreeRow } from "@/components/admin/coord/treeStatus";
import type {
  BodyProvenance,
  BodyUnknownReason,
  HasBody,
} from "@/components/admin/coord/planBodySignal";
import type {
  PlansListResponse,
  WorkUnitOverview,
} from "@/app/(app)/admin/coord/work-units/planWalk";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `operations.py` `get_coord_plan` — one coord work-unit row. */
export interface CoordWorkUnit {
  slug: string;
  title?: string | null;
  status?: string;
  /**
   * coord `work_units.current_phase`. Omitted from this interface until
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

/** One `coord.work_unit_status_history` row. */
export interface PlanHistoryEntry {
  from_status?: string | null;
  to_status: string;
  transitioned_at: string;
  by_actor?: string | null;
  reason?: string | null;
}

/** coord `GET /coord/work-units/{slug}` envelope. */
export interface CoordPlanDetailResponse {
  work_unit?: CoordWorkUnit;
  recent_history?: PlanHistoryEntry[];
}

/** `get_coord_plan_history` envelope. */
export interface PlanHistoryResponse {
  slug?: string;
  history?: PlanHistoryEntry[];
}

/** `post_coord_plan_transition` request. `note` is omitted when empty. */
export interface PlanTransitionRequest {
  status: string;
  note?: string;
}

/** `get_trees_by_device` envelope. */
export interface TreesByDeviceResponse {
  device_id?: string;
  trees?: PrimaryTreeRow[];
}

/** One repo whose primary tree sits on more than one device. */
export interface ContentionRow {
  repo: string;
  primary_paths?: string[];
  devices?: { device_id: string; hostname?: string; primary_path: string }[];
}

/** `get_trees_contention` envelope. */
export interface ContentionResponse {
  overlaps?: ContentionRow[];
}

/**
 * `GET /plans?<query>` (`list_coord_plans`) — one page of the work-unit list.
 * `query` carries `status`, `exclude_slug_prefix`, `limit`, `order` and the
 * walk cursor exactly as the caller built them.
 */
export async function fetchPlans(
  query: URLSearchParams,
  options: HttpOptions = {}
): Promise<PlansListResponse> {
  const url = `${OPERATIONS_BASE}/plans?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PlansListResponse>(res, `GET ${url}`);
}

/** `GET /plans/overview` (`get_coord_plans_overview`) — corpus facets. */
export async function fetchPlansOverview(
  options: HttpOptions = {}
): Promise<WorkUnitOverview> {
  const url = `${OPERATIONS_BASE}/plans/overview`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<WorkUnitOverview>(res, `GET ${url}`);
}

/**
 * `GET /plans/throughput?<query>` (`get_coord_plans_throughput`). Returned as
 * `unknown`: the caller's `deriveThroughput` validates the body.
 */
export async function fetchPlansThroughput(
  query: URLSearchParams,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/throughput?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /plans/{slug}` (`get_coord_plan`). */
export async function fetchPlan(
  slug: string,
  options: HttpOptions = {}
): Promise<CoordPlanDetailResponse> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<CoordPlanDetailResponse>(res, `GET ${url}`);
}

/** `GET /plans/{slug}/history` (`get_coord_plan_history`). */
export async function fetchPlanHistory(
  slug: string,
  options: HttpOptions = {}
): Promise<PlanHistoryResponse> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}/history`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PlanHistoryResponse>(res, `GET ${url}`);
}

/**
 * `POST /plans/{slug}/transition` (`post_coord_plan_transition`) — move a
 * work unit to a status. Not declared idempotent, so a 5xx is never replayed;
 * the caller refetches the detail on success and ignores the body.
 */
export async function transitionPlan(
  slug: string,
  request: PlanTransitionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/plans/${encodeURIComponent(slug)}/transition`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `GET /domain-cost` (`get_domain_cost`) — coord's domain cost ledger.
 * Returned as `unknown`: the caller's `isDomainCostPayload` validates it.
 */
export async function fetchDomainCost(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/domain-cost`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /trees/by-device/{device_id}` (`get_trees_by_device`). */
export async function fetchTreesByDevice(
  deviceId: string,
  options: HttpOptions = {}
): Promise<TreesByDeviceResponse> {
  const url = `${OPERATIONS_BASE}/trees/by-device/${encodeURIComponent(deviceId)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<TreesByDeviceResponse>(res, `GET ${url}`);
}

/** `GET /trees/contention` (`get_trees_contention`). */
export async function fetchTreesContention(
  options: HttpOptions = {}
): Promise<ContentionResponse> {
  const url = `${OPERATIONS_BASE}/trees/contention`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ContentionResponse>(res, `GET ${url}`);
}
