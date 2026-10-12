/**
 * `/operations/plans*` — coord's work-unit ("plan") registry: the list, its
 * overview facets and throughput, one unit's detail and status history, and
 * the operator's status transition.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 8). Same conventions as `unfinished.ts`: `httpClient.fetch` on
 * the RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and
 * a non-2xx rejecting through {@link readJson} with
 * `<METHOD> <url> failed: <status> - <body>` — the string `httpClient.get` /
 * `post` threw, which `isNotFoundError`, `httpStatusOf` and
 * `describeCoordPollError` read.
 *
 * Reads take the caller's `HttpOptions`: the dashboard polls pass
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request; the next tick is the retry).
 *
 * The wire types mirror the handlers in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which proxy coord's
 * `/coord/work-units*` routes (qontinui-coord `work_unit_registry.rs`).
 */

import type {
  BodyProvenance,
  BodyUnknownReason,
  HasBody,
  PlanBodySignalBlock,
} from "@/components/admin/coord/planBodySignal";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `list_coord_plans`' keyset cursor, as coord's `next_cursor` carries it. */
export interface WalkCursor {
  /** RFC3339, or null while walking the NULL-authored tail. */
  after_authored_at: string | null;
  after_slug: string;
}

/** `list_coord_plans` — one page of coord's work-unit list. */
export interface PlansListResponse {
  // coord `/coord/work-units` returns rows under `work_units`. `plans` is
  // kept for backwards-tolerance during the cutover (harmless if absent).
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
  limit?: number;
  offset?: number;
  count?: number;
  /** Echoed by a coord that understood `order`; absent on an older one. */
  order?: string;
  /** Non-null only when the page was full and another may follow. */
  next_cursor?: WalkCursor | null;
  /**
   * The size of the WHOLE matching population, when coord serves one (it
   * does not today: the envelope is `{work_units, limit, offset}` plus
   * `count`). Read on the `single_page` arm only, where it is the one page's
   * own statement and the truncation notice's denominator. A walk does not
   * need it and does not fold it: a walk's denominator is the rows it read,
   * cross-checked against `/plans/overview` — see `overviewTotalFor` in
   * `admin/coord/work-units/planWalk.ts`.
   * Never substituted from `count`, which is the size of the PAGE.
   */
  total?: number;
  /**
   * Why a `has_body: false` on THIS PAGE is (or is not) evidence — computed
   * per request by the proxy (plan
   * `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`).
   * Absent when the page had no rows to annotate, and on a backend that
   * predates the signals. A walk collects one per page and folds them; see
   * `WalkOutcome`'s `bodySignal` in `admin/coord/work-units/planWalk.ts`.
   */
  body_signal?: PlanBodySignalBlock;
}

/**
 * The rows of one {@link fetchPlans} page: `work_units`, else the legacy
 * `plans`, else none. Every caller reads rows through this: the coord history
 * page once read `plans` alone and rendered empty, because `list_coord_plans`
 * sends only `work_units`.
 */
export function planRowsOf(
  body: PlansListResponse | null | undefined
): CoordPlanRow[] {
  return body?.work_units ?? body?.plans ?? [];
}

/**
 * `get_coord_plans_overview` — the fields of coord's
 * `GET /coord/work-units/overview` the work-units page reads.
 *
 * It deliberately does NOT declare `corpus_complete`, which the response also
 * carries, because declaring a field no consumer reads invites the belief that
 * completeness is being checked when it is not. Nothing is lost by leaving it
 * out: coord sets `corpus_complete: !by_status_truncated`
 * (`work_unit_registry.rs` `work_unit_overview_body`) — exactly the flag
 * `overviewTotalFor` (`planWalk.ts`) already gates the per-status total on — while
 * `row_count`, the total the `status=any` arm reads, is folded from the
 * complete tally BEFORE any truncation and is whole-corpus in both arms. So
 * reading `corpus_complete` here would either duplicate the truncation check
 * or discard a `row_count` that is not truncated at all.
 */
export interface WorkUnitOverview {
  row_count?: number;
  facets?: {
    by_status?: Record<string, number>;
    by_status_truncated?: boolean;
  };
}

/** `get_coord_plan` — one coord work-unit row, as the detail envelope carries it. */
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

/** `get_coord_plan` — coord `GET /coord/work-units/{slug}` envelope. */
export interface CoordPlanDetailResponse {
  work_unit?: CoordWorkUnit;
  recent_history?: PlanHistoryEntry[];
}

/** `get_coord_plan_history` envelope. */
export interface PlanHistoryResponse {
  slug?: string;
  history?: PlanHistoryEntry[];
}

/**
 * `post_coord_plan_transition` request. The handler remaps it onto coord's
 * `operator-transition` body (`status` → `to_status`, `note` → `reason`); an
 * absent `note` is left out of the JSON.
 */
export interface PlanTransitionRequest {
  status: string;
  note?: string;
}

/**
 * `GET /plans?<query>` (`list_coord_plans`) — one page of the work-unit list.
 * `query` carries `status`, `exclude_slug_prefix`, `limit`, `order` and the
 * walk cursor exactly as the caller built them; an empty query sends no `?`.
 */
export async function fetchPlans(
  query: URLSearchParams,
  options: HttpOptions = {}
): Promise<PlansListResponse> {
  let url = `${OPERATIONS_BASE}/plans`;
  const qs = query.toString();
  if (qs) url += `?${qs}`;
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
 * `GET /plans/throughput?<query>` (`get_coord_plans_throughput`; `since` is
 * required). Returned as `unknown`: the caller's `deriveThroughput` validates
 * the body.
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

/** `GET /plans/{slug}` (`get_coord_plan`) — one work unit plus recent history. */
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
 * work unit to a status. `idempotent: false`: a 5xx is never re-sent, since a
 * 504 after coord committed would write a second history row. A 429 (nothing
 * processed) still retries, as it did through `httpClient.post`. The 2xx body
 * must parse, exactly as `httpClient.post` required.
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
  return readJson<unknown>(res, `POST ${url}`);
}
