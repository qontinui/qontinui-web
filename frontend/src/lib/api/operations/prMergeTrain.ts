/**
 * `/operations` merge-train routes: the proposal queue, the PR list, the
 * dependency graph, train health, merge economics, the suggestion and
 * blast-radius side-channels, the emergency stop, stuck-PR recovery, PR check
 * details, plus the two coord reads the CI dashboard and the pull-decisions
 * page poll (`/ci/overview`, `/coord/pull-decisions`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7). The repo-profile and onboarding routes under the same
 * `/pr-merge` prefix live in `prMerge.ts` / `prMergeOnboarding.ts`.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (same-origin, D6) with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`: a caller reads the status with
 * `httpStatusOf`, the body with `httpBodyOf`, and the operator sentence with
 * `operationsErrorMessage`.
 *
 * Reads take the caller's `HttpOptions` (the dashboard polls pass
 * `COORD_DASHBOARD_POLL_OPTIONS`: one request, the next tick is the retry).
 * Where the response shape is validated by the caller (coord answers more than
 * one shape, or the page checks the body field by field) the function returns
 * `unknown` rather than promise a shape the wire does not keep.
 *
 * The handler each function mirrors is named in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import type {
  BlastRadiusBlock,
  BlastRadiusBlocksResponse,
  MergeEnabledResponse,
  PrListResponse,
  PrRow,
  PrStateResponse,
  ProposalDetail,
  QueueResponse,
  SuggestionListResponse,
  SuggestionRow,
  TrainHealth,
} from "@/components/operations/mergeTypes";
import { OPERATIONS_BASE, readJson } from "./base";

// ---------------------------------------------------------------------------
// Dependency graph — mirrors qontinui-coord src/pr_merge/graph_routes.rs
// ---------------------------------------------------------------------------

export interface PrRef {
  repo: string;
  pr: number;
}

export interface GraphNode {
  repo: string;
  pr_number: number;
  tenant_id: string | null;
  outer_state: string | null;
  /**
   * The topological-merge predicate (`is_pr_ready_for_topo_merge`). It
   * requires review `APPROVED`, which agents on this fleet never give, so it
   * reads `false` for PRs the merge train will land. Secondary signal only —
   * never the "landable" colour.
   */
  topo_merge_ready?: boolean;
  /**
   * The merge predicate's latest verdict (the latest `predicate_eval`
   * `pr_events` row — the same verdict `coord_pr_status` serves). `"none"`
   * means the predicate passed; `null` means no verdict is recorded. Absent
   * on a coord that predates the field.
   */
  block_reason_code?: string | null;
  /**
   * LEGACY: the pre-rename wire name of `topo_merge_ready` (same predicate).
   * Served only by a coord predating plan
   * `2026-09-28-coord-pr-merge-ready-false-stall-and-events-tenant-mismatch`
   * Phase 2c; read only when `block_reason_code` is absent.
   */
  ready?: boolean;
  merge_state_status: string | null;
}

export interface GraphEdge {
  from: PrRef;
  to: PrRef;
  /** "upstream_of" | "stacked_on" — kept as string for forward-compat. */
  kind: string;
}

/** `GET /pr-merge/graph` — `get_pr_merge_graph`. */
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  topo_order: PrRef[];
  cycle_detected: boolean;
  cycle_members: PrRef[];
}

/** A suggestion verdict: `POST /pr-merge/suggestions/{alert_id}/{action}`. */
export type SuggestionAction = "accept" | "reject" | "mute";

/**
 * The short text the merge-train surfaces show for a failed read: `HTTP <status>`
 * for a status rejection from any function here, the error's own message for
 * anything else (a network failure). Keeps the sentence the surfaces had when
 * they threw their own `HTTP <status>` error.
 */
export function httpStatusLabel(err: unknown): string {
  const status = httpStatusOf(err);
  if (status !== null) return `HTTP ${status}`;
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `GET /merge/queue` — `get_merge_queue`: coord's proposal queue, as the
 * `{proposals}` envelope or (an older coord) a bare array.
 */
export async function fetchMergeQueue(
  options: HttpOptions = {}
): Promise<QueueResponse | ProposalDetail[]> {
  const url = `${OPERATIONS_BASE}/merge/queue`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<QueueResponse | ProposalDetail[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs` — `get_pr_merge_prs`, the open PR list, as the
 * `{prs}` envelope or a bare array.
 */
export async function fetchPrMergePrs(
  options: HttpOptions = {}
): Promise<PrListResponse | PrRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrListResponse | PrRow[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs?merged_count_hours=<h>` — the open list plus coord's
 * cheap merged COUNT over the last `hours` (`merged_recent_count`).
 */
export async function fetchPrMergePrsWithMergedCount(
  hours: number,
  options: HttpOptions = {}
): Promise<PrListResponse | PrRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs?merged_count_hours=${hours}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrListResponse | PrRow[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs?include_merged=<h>` — the open list plus the rows merged
 * in the last `hours`. An order of magnitude dearer than the open list, so a
 * caller passes `{ maxRetries: 0 }`.
 */
export async function fetchPrMergePrsIncludingMerged(
  hours: number,
  options: HttpOptions = {}
): Promise<PrListResponse | PrRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs?include_merged=${hours}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrListResponse | PrRow[]>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/merge-economics` — `get_pr_merge_merge_economics`. Coord
 * answers three shapes (keyed object, `{repos}` wrapper, array), so the body
 * is `unknown` and `normalizeMergeEconomics` reads it.
 */
export async function fetchMergeEconomics(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/merge-economics`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /pr-merge/suggestions` — `get_pr_merge_suggestions`. */
export async function fetchMergeSuggestions(
  options: HttpOptions = {}
): Promise<SuggestionListResponse | SuggestionRow[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/suggestions`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<SuggestionListResponse | SuggestionRow[]>(res, `GET ${url}`);
}

/** `GET /pr-merge/blast-radius-blocks` — `get_pr_merge_blast_radius_blocks`. */
export async function fetchBlastRadiusBlocks(
  options: HttpOptions = {}
): Promise<BlastRadiusBlocksResponse | BlastRadiusBlock[]> {
  const url = `${OPERATIONS_BASE}/pr-merge/blast-radius-blocks`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<BlastRadiusBlocksResponse | BlastRadiusBlock[]>(
    res,
    `GET ${url}`
  );
}

/** `GET /pr-merge/health` — `get_pr_merge_health`: merge-train liveness. */
export async function fetchTrainHealth(
  options: HttpOptions = {}
): Promise<TrainHealth> {
  const url = `${OPERATIONS_BASE}/pr-merge/health`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<TrainHealth>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/graph?repo=<repo>&pr=<n>` — `get_pr_merge_graph`: the
 * connected component of one PR's dependency graph.
 */
export async function fetchPrMergeGraph(
  repo: string,
  pr: number,
  options: HttpOptions = {}
): Promise<GraphResponse> {
  const params = new URLSearchParams({ repo, pr: String(pr) });
  const url = `${OPERATIONS_BASE}/pr-merge/graph?${params.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GraphResponse>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/prs/{repo}/{pr_number}/checks` — `get_pr_merge_pr_checks`:
 * the per-check breakdown (coord's `PrStateResponse`). `repo` is `owner/name`
 * and travels as ONE encoded segment, as it always did.
 */
export async function fetchPrChecks(
  repo: string,
  prNumber: number,
  options: HttpOptions = {}
): Promise<PrStateResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(
    repo
  )}/${prNumber}/checks`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrStateResponse>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/{repo}/stuck-nudges` — `get_pr_merge_stuck_nudges`: coord's
 * "your PR is stuck" alarm for a repo. `repo` is `owner/name`, inlined inside
 * the path (the backend captures `{repo:path}`), so its slash is NOT encoded.
 * The caller's `parseStuckNudges` validates the body.
 */
export async function fetchStuckNudges(
  repo: string,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/${repo}/stuck-nudges`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/verdict/{owner}/{name}/{pr_number}` —
 * `get_pr_merge_verdict`: coord's merge verdict for one PR. The caller's
 * `parseProposalView` validates the body.
 */
export async function fetchPrMergeVerdict(
  owner: string,
  name: string,
  prNumber: number,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/verdict/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(name)}/${prNumber}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /ci/overview` — `get_ci_overview`: the CI dashboard's pool + repo
 * rollup. The page checks the `pools` / `repos` arrays before trusting it.
 */
export async function fetchCiOverview(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/ci/overview`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /coord/pull-decisions[?device_id=…&repo=…]` — `get_pull_decisions`.
 * Coord answers the `{resolutions}` envelope or a bare array; an empty filter
 * is left off the query.
 */
export async function fetchPullDecisions(
  filter: { deviceId?: string; repo?: string },
  options: HttpOptions = {}
): Promise<unknown> {
  const qs = new URLSearchParams();
  if (filter.deviceId) qs.set("device_id", filter.deviceId);
  if (filter.repo) qs.set("repo", filter.repo);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const url = `${OPERATIONS_BASE}/coord/pull-decisions${suffix}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * `POST /pr-merge/kill-switch` — `post_pr_merge_kill_switch`: the emergency
 * stop. Not re-sent on a 5xx (`idempotent: false`); the answer says which
 * repos the latch now covers.
 */
/**
 * `scope` is `"tenant"` (every repo the tenant owns) or `"repo:<owner/name>"`.
 */
export async function engageKillSwitch(
  scope: string,
  reason: string
): Promise<MergeEnabledResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/kill-switch`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ scope, reason }),
    idempotent: false,
  });
  return readJson<MergeEnabledResponse>(res, `POST ${url}`);
}

/**
 * `POST /pr-merge/suggestions/{alert_id}/{action}` —
 * `post_pr_merge_suggestion_accept` / `_reject` / `_mute`. The success body is
 * not read; a 2xx is the fact that matters.
 */
export async function actOnMergeSuggestion(
  alertId: number,
  action: SuggestionAction,
  body: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/suggestions/${alertId}/${action}`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/prs/{owner}/{name}/{pr_number}/reevaluate` —
 * `post_pr_merge_reevaluate`: re-run coord's merge decision for one PR against
 * fresh GitHub truth. The caller words the answer (`describeActionSuccess`).
 */
export async function reevaluatePr(
  owner: string,
  name: string,
  prNumber: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/prs/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(name)}/${prNumber}/reevaluate`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/proposals/{proposal_id}/cancel` —
 * `post_pr_merge_proposal_cancel`. `unblock: false` STOPS (the cancelled prior
 * stays on record and blocks a retry at this commit); `true` clears the block
 * AND re-enqueues a fresh attempt — two different actions, never one button.
 */
export async function cancelMergeProposal(
  proposalId: string,
  { unblock, reason }: { unblock: boolean; reason: string }
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/proposals/${encodeURIComponent(
    proposalId
  )}/cancel`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ unblock, reason }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
