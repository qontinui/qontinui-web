/**
 * `/operations` delivery-history reads: lands (list, preview, precision,
 * cross-repo verifications), deploys (list, rollback proposal), primary trees,
 * git-ops, federation reports, pull decisions, and the domain cost ledger.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 6). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated,
 * and a non-2xx rejecting with `GET <url> failed: <status> - <body>` — the
 * exact string `httpClient.get` threw at every call site before, so the error
 * text the pages render is unchanged.
 *
 * Every handler named below lives in
 * `backend/app/api/v1/endpoints/operations/__init__.py` and proxies coord.
 * Row types a console component already owns (`LandRow`, `DeployRow`,
 * `PrecisionResponse`, `LandPreviewResponse`, `RollbackProposal`,
 * `PrimaryTreeRow`, `PullDecisionRow`) are imported from it, not redeclared.
 *
 * A polled read takes `options` — the caller's retry budget, which the
 * dashboards set to `COORD_DASHBOARD_POLL_OPTIONS` so a failed tick is retried
 * by the next tick, never by `httpClient`'s 5xx backoff chain. All are reads,
 * so all are `idempotent: true`.
 */

import type { PrecisionResponse } from "@/components/admin/coord/LandPrecisionPanel";
import type { LandPreviewResponse } from "@/components/admin/coord/LandPreviewPanel";
import type {
  DeployRow,
  RollbackProposal,
} from "@/components/admin/coord/deployTypes";
import type { LandRow } from "@/components/admin/coord/landTypes";
import type { PullDecisionRow } from "@/components/admin/coord/pullDecisionStatus";
import type { PrimaryTreeRow } from "@/components/admin/coord/treeStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ---- Lands ----------------------------------------------------------------

/** `GET /lands` body — handler `get_lands`. */
export interface LandsResponse {
  lands?: LandRow[] | null;
}

/** `GET /lands/precision` (handler `get_lands_precision`) — the calibration panel's data. */
export async function fetchLandPrecision(
  options: HttpOptions = {}
): Promise<PrecisionResponse> {
  const url = `${OPERATIONS_BASE}/lands/precision`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrecisionResponse>(res, `GET ${url}`);
}

/**
 * `GET /lands/preview?repo=&pr=` (handler `get_lands_preview`) — what landing
 * one PR would do. An explicit operator action, so the default retry budget.
 */
export async function fetchLandPreview(query: {
  repo: string;
  pr: string;
}): Promise<LandPreviewResponse> {
  const qs = new URLSearchParams({ repo: query.repo, pr: query.pr });
  const url = `${OPERATIONS_BASE}/lands/preview?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<LandPreviewResponse>(res, `GET ${url}`);
}

/** `GET /lands` (handler `get_lands`) — recent lands; `repo` is omitted from the query when absent. */
export async function fetchLandList(
  query: { repo?: string; limit: number },
  options: HttpOptions = {}
): Promise<LandsResponse> {
  const qs = new URLSearchParams();
  if (query.repo) qs.set("repo", query.repo);
  qs.set("limit", String(query.limit));
  const url = `${OPERATIONS_BASE}/lands?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<LandsResponse>(res, `GET ${url}`);
}

// Wire shapes of `GET /lands/verifications` (handler `get_lands_verifications`),
// which mirrors coord's `/coord/restacks/verifications` (snake_case). Rendered
// defensively — `worst_drift_class` / `d3_outcome` / `verified_at` are null
// until a repo is verified.

export interface RepoVerification {
  repo: string;
  signature_id?: string | null;
  worst_drift_class?: string | null;
  d3_outcome?: string | null;
  verified_at?: string | null;
  edge_verdicts?: unknown[] | null;
}

export interface ComposedVerification {
  worst_drift_class?: string | null;
  repo_count?: number | null;
  verified_count?: number | null;
}

export interface CrossRepoVerifications {
  correlation_id?: string | null;
  repos?: RepoVerification[] | null;
  composed?: ComposedVerification | null;
}

/**
 * `GET /lands/verifications?correlation_id=` — the composed cross-repo
 * restack verdict for one land's cascade.
 */
export async function fetchLandVerifications(
  correlationId: string
): Promise<CrossRepoVerifications> {
  const qs = new URLSearchParams({ correlation_id: correlationId });
  const url = `${OPERATIONS_BASE}/lands/verifications?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<CrossRepoVerifications>(res, `GET ${url}`);
}

// ---- Deploys --------------------------------------------------------------

/** `GET /deploys` body — handler `get_deploys`. */
export interface DeploysResponse {
  deploys?: DeployRow[] | null;
}

/** `GET /deploys` (handler `get_deploys`) — recent deploys; `service` is omitted when absent. */
export async function fetchDeployList(
  query: { service?: string; limit: number },
  options: HttpOptions = {}
): Promise<DeploysResponse> {
  const qs = new URLSearchParams();
  if (query.service) qs.set("service", query.service);
  qs.set("limit", String(query.limit));
  const url = `${OPERATIONS_BASE}/deploys?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<DeploysResponse>(res, `GET ${url}`);
}

/**
 * `GET /deploys/{deploy_id}/rollback-proposal` (handler
 * `get_deploy_rollback_proposal`). Coord 404s when the latest verification
 * does not justify a rollback; the rejection keeps the status for
 * `isNoProposalAnswer`. The handler types the id as a UUID, so encoding it
 * changes nothing for a valid id; it is encoded like every other path segment.
 */
export async function fetchDeployRollbackProposal(
  deployId: string
): Promise<RollbackProposal> {
  const url = `${OPERATIONS_BASE}/deploys/${encodeURIComponent(deployId)}/rollback-proposal`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<RollbackProposal>(res, `GET ${url}`);
}

// ---- Primary trees --------------------------------------------------------

/** `GET /trees/by-device/{device_id}` body — handler `get_trees_by_device`. */
export interface TreesByDeviceResponse {
  device_id?: string;
  trees?: PrimaryTreeRow[];
}

/** One overlapping repo of `GET /trees/contention`. */
export interface ContentionRow {
  repo: string;
  primary_paths?: string[];
  devices?: { device_id: string; hostname?: string; primary_path: string }[];
}

/** `GET /trees/contention` body — handler `get_trees_contention`. */
export interface ContentionResponse {
  overlaps?: ContentionRow[];
}

/** `GET /trees/by-device/{device_id}` — one device's primary checkouts. */
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

/** `GET /trees/contention` — repos whose primary checkout overlaps across devices. */
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

// ---- Git ops --------------------------------------------------------------
//
// These interfaces mirror coord's git-ops wire shape. The generated
// `@qontinui/shared-types` git-ops exports (GitOpRecord, DeviceBranchSummary)
// are not yet published — swap these for them once they are; the field
// shapes are intentionally identical.

/** One recorded git operation of `GET /git-ops/list`. */
export interface GitOpRecord {
  op_id: string;
  tenant_id: string;
  device_id: string;
  session_id: string;
  repo: string;
  branch: string;
  op_kind: string;
  sha: string;
  message: string;
  recorded_at: string;
  metadata?: Record<string, unknown>;
}

/** One device's head of one branch, of `GET /git-ops/branches`. */
export interface DeviceBranchSummary {
  device_id: string;
  repo: string;
  branch: string;
  sha: string;
  recorded_at: string;
}

/** `GET /git-ops/list` body (handler `get_git_ops_list`) — rows ride under `ops` or `items`. */
export interface GitOpsListResponse {
  ops?: GitOpRecord[];
  items?: GitOpRecord[];
  count?: number;
}

/** `GET /git-ops/branches` body (handler `get_git_ops_branches`) — rows ride under `branches` or `items`. */
export interface GitOpsBranchesResponse {
  branches?: DeviceBranchSummary[];
  items?: DeviceBranchSummary[];
  count?: number;
}

/** `GET /git-ops/list` — `since` and `repo` are omitted from the query when absent. */
export async function fetchGitOpsList(
  query: { since?: string; repo?: string; limit: number },
  options: HttpOptions = {}
): Promise<GitOpsListResponse> {
  const qs = new URLSearchParams();
  if (query.since) qs.set("since", query.since);
  if (query.repo) qs.set("repo", query.repo);
  qs.set("limit", String(query.limit));
  const url = `${OPERATIONS_BASE}/git-ops/list?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GitOpsListResponse>(res, `GET ${url}`);
}

/** `GET /git-ops/branches` — the current branch per device. */
export async function fetchGitOpsBranches(
  options: HttpOptions = {}
): Promise<GitOpsBranchesResponse> {
  const url = `${OPERATIONS_BASE}/git-ops/branches`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GitOpsBranchesResponse>(res, `GET ${url}`);
}

// ---- Federation -----------------------------------------------------------

/** One row of `GET /federation/reports`. */
export interface FederationReport {
  id: string;
  device_id: string;
  session_id?: string;
  account?: string;
  pushed: number;
  pulled: number;
  failed: number;
  failed_names?: string[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

/** `GET /federation/reports` body (handler `get_federation_reports`) — rows ride under `reports` or `items`. */
export interface FederationReportsResponse {
  reports?: FederationReport[];
  items?: FederationReport[];
  count?: number;
}

/** `GET /federation/reports` — `since` is omitted from the query when absent. */
export async function fetchFederationReports(
  query: { since?: string; limit: number },
  options: HttpOptions = {}
): Promise<FederationReportsResponse> {
  const qs = new URLSearchParams();
  if (query.since) qs.set("since", query.since);
  qs.set("limit", String(query.limit));
  const url = `${OPERATIONS_BASE}/federation/reports?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<FederationReportsResponse>(res, `GET ${url}`);
}

// ---- Pull decisions -------------------------------------------------------

/** The `{resolutions: [...]}` envelope of `GET /coord/pull-decisions`. */
export interface PullDecisionsResponse {
  resolutions?: PullDecisionRow[];
  count?: number;
}

/**
 * `GET /coord/pull-decisions` (handler `get_pull_decisions`). Coord has
 * answered both the `{resolutions: [...]}` envelope and a bare array, so this
 * normalizes to the envelope. With no filter the URL carries no `?` at all.
 */
export async function fetchPullDecisions(
  query: { deviceId?: string; repo?: string },
  options: HttpOptions = {}
): Promise<PullDecisionsResponse> {
  const qs = new URLSearchParams();
  if (query.deviceId) qs.set("device_id", query.deviceId);
  if (query.repo) qs.set("repo", query.repo);
  let url = `${OPERATIONS_BASE}/coord/pull-decisions`;
  if (qs.toString()) url += `?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  const body = await readJson<unknown>(res, `GET ${url}`);
  return Array.isArray(body)
    ? { resolutions: body as PullDecisionRow[] }
    : (body as PullDecisionsResponse);
}

// ---- Domain cost ----------------------------------------------------------

/**
 * `GET /domain-cost` (handler `get_domain_cost`) — coord's domain cost ledger,
 * served verbatim. Returned UNVALIDATED: the caller narrows it with
 * `isDomainCostPayload`, because a body missing its ledger is a failed read
 * with its own message, not a parse error.
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
