/**
 * `/operations` coord-console reads and writes that sit around the merge
 * train: lands, deploys, git-ops, plan history, findings, federation reports,
 * notifications, and the policy-gap rows' two writes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7). The handlers live in
 * `backend/app/api/v1/endpoints/operations/__init__.py`; each function names
 * the route it calls. Row types that a console component already owns
 * (`LandRow`, `DeployRow`, `PrecisionResponse`, ...) are imported from it, not
 * redeclared.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * with its URL inline, states its retry policy, and returns the PARSED body
 * through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`. A read that polls takes
 * `options` (the caller's retry budget, e.g. `COORD_DASHBOARD_POLL_OPTIONS`).
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import type { CrossRepoVerifications } from "@/components/admin/coord/LandRow";
import type { PrecisionResponse } from "@/components/admin/coord/LandPrecisionPanel";
import type { LandPreviewResponse } from "@/components/admin/coord/LandPreviewPanel";
import type {
  DeployRow,
  RollbackProposal,
} from "@/components/admin/coord/deployTypes";
import type { LandRow } from "@/components/admin/coord/landTypes";
import type {
  MarkReadResponse,
  MarkReadSelection,
  NotificationsResponse,
} from "@/components/admin/coord/notificationStatus";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { ProposedClause } from "@/components/admin/coord/policy-gap";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

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

/** `GET /federation/reports` — the rows ride under `reports` or `items`. */
export interface FederationReportsResponse {
  reports?: FederationReport[];
  items?: FederationReport[];
  count?: number;
}

/** `GET /federation/reports` — `since` is omitted from the query when absent. */
export async function fetchFederationReports(
  query: { since?: string; limit: number },
  options?: HttpOptions
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

// ---- Findings -------------------------------------------------------------

/**
 * `GET /coord/findings?<query>` — the findings list. `query` is the caller's
 * already-built query string (filters, page size, and a cursor coord minted);
 * the body is returned unvalidated because the page reads it defensively.
 */
export async function fetchCoordFindings(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/findings?${query}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /coord/findings?finding_id=<id>` — one finding by id. */
export async function fetchCoordFindingById(
  findingId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/findings?finding_id=${encodeURIComponent(
    findingId
  )}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

// ---- Plan history ---------------------------------------------------------

/** `GET /plans` — the plan rows of one status. */
export interface CoordPlansResponse {
  plans?: CoordPlanRow[];
}

/** `GET /plans?status=<status>&limit=<limit>`. */
export async function fetchCoordPlans(
  query: { status: string; limit: number },
  options?: HttpOptions
): Promise<CoordPlansResponse> {
  const qs = new URLSearchParams();
  qs.set("status", query.status);
  qs.set("limit", String(query.limit));
  const url = `${OPERATIONS_BASE}/plans?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<CoordPlansResponse>(res, `GET ${url}`);
}

// ---- Lands ----------------------------------------------------------------

/** `GET /lands`. */
export interface LandsResponse {
  lands?: LandRow[] | null;
}

/** `GET /lands/precision` — the calibration panel's data. */
export async function fetchLandPrecision(
  options?: HttpOptions
): Promise<PrecisionResponse> {
  const url = `${OPERATIONS_BASE}/lands/precision`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PrecisionResponse>(res, `GET ${url}`);
}

/** `GET /lands/preview?repo=&pr=` — what landing one PR would do. */
export async function fetchLandPreview(query: {
  repo: string;
  pr: string;
}): Promise<LandPreviewResponse> {
  const qs = new URLSearchParams({ repo: query.repo, pr: query.pr });
  const url = `${OPERATIONS_BASE}/lands/preview?${qs.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<LandPreviewResponse>(res, `GET ${url}`);
}

/** `GET /lands` — recent lands; `repo` is omitted from the query when absent. */
export async function fetchLandList(
  query: { repo?: string; limit: number },
  options?: HttpOptions
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

/** `GET /deploys`. */
export interface DeploysResponse {
  deploys?: DeployRow[] | null;
}

/** `GET /deploys` — recent deploys; `service` is omitted when absent. */
export async function fetchDeployList(
  query: { service?: string; limit: number },
  options?: HttpOptions
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
 * `GET /deploys/{id}/rollback-proposal`. Coord 404s when the latest
 * verification does not justify a rollback; the rejection keeps the status.
 */
export async function fetchDeployRollbackProposal(
  deployId: string
): Promise<RollbackProposal> {
  const url = `${OPERATIONS_BASE}/deploys/${deployId}/rollback-proposal`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<RollbackProposal>(res, `GET ${url}`);
}

// ---- Git ops --------------------------------------------------------------
//
// These interfaces mirror coord's git-ops wire shape. The generated
// `@qontinui/shared-types` git-ops exports (GitOpRecord, DeviceBranchSummary)
// are not yet published — swap these for them once they are; the field shapes
// are intentionally identical.

/** One recorded git operation. */
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

/** One device's head of one branch. */
export interface DeviceBranchSummary {
  device_id: string;
  repo: string;
  branch: string;
  sha: string;
  recorded_at: string;
}

/** `GET /git-ops/list` — the rows ride under `ops` or `items`. */
export interface GitOpsListResponse {
  ops?: GitOpRecord[];
  items?: GitOpRecord[];
  count?: number;
}

/** `GET /git-ops/branches` — the rows ride under `branches` or `items`. */
export interface GitOpsBranchesResponse {
  branches?: DeviceBranchSummary[];
  items?: DeviceBranchSummary[];
  count?: number;
}

/** `GET /git-ops/list` — `since` and `repo` are omitted from the query when absent. */
export async function fetchGitOpsList(
  query: { since?: string; repo?: string; limit: number },
  options?: HttpOptions
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

/** `GET /git-ops/branches`. */
export async function fetchGitOpsBranches(
  options?: HttpOptions
): Promise<GitOpsBranchesResponse> {
  const url = `${OPERATIONS_BASE}/git-ops/branches`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GitOpsBranchesResponse>(res, `GET ${url}`);
}

// ---- Notifications --------------------------------------------------------

/**
 * `GET /notifications?<query>`. `query` is the caller's already-built query
 * string (page size, filters, a cursor coord minted); `options` carries the
 * poller's `noRetryStatuses`.
 */
export async function fetchNotifications(
  query: string,
  options?: HttpOptions
): Promise<NotificationsResponse> {
  const url = `${OPERATIONS_BASE}/notifications?${query}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<NotificationsResponse>(res, `GET ${url}`);
}

/**
 * `POST /notifications/mark-read`. The selection IS the wire body —
 * `{notification_ids: [...]}` or `{all: true}`, never both keys. Not re-sent
 * on a 5xx (`idempotent: false`); `options` carries the click-driven call's
 * `noRetryStatuses`.
 */
export async function markNotificationsRead(
  selection: MarkReadSelection,
  options?: HttpOptions
): Promise<MarkReadResponse> {
  const url = `${OPERATIONS_BASE}/notifications/mark-read`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(selection),
    idempotent: false,
  });
  return readJson<MarkReadResponse>(res, `POST ${url}`);
}

// ---- Policy-gap rows ------------------------------------------------------

/** The body of `POST /agent-questions/{question_id}/respond`. */
export interface AgentQuestionResponseBody {
  response: string;
  responded_by_operator: string;
}

/**
 * `POST /agent-questions/{question_id}/respond` — a durable answer to a
 * pending agent question. Not re-sent on a 5xx (`idempotent: false`).
 */
export async function respondToAgentQuestion(
  questionId: string,
  answer: AgentQuestionResponseBody
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/agent-questions/${encodeURIComponent(
    questionId
  )}/respond`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      response: answer.response,
      responded_by_operator: answer.responded_by_operator,
    }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/**
 * `POST /coord/prompt-documents/policy/{category}/clauses` — create a policy
 * clause (the Phase-2 clause-create proxy). Not re-sent on a 5xx
 * (`idempotent: false`).
 */
export async function createPolicyClause(
  category: string,
  clause: ProposedClause
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-documents/policy/${encodeURIComponent(
    category
  )}/clauses`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(clause),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}
