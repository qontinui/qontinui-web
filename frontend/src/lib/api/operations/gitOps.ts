/**
 * `/operations/git-ops/*` — coord git-op log and per-device branch heads.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with the URL
 * inline; a non-2xx rejects with `<METHOD> <url> failed: <status> - <body>`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// Local mirror of coord's git-ops wire shape; swap for the generated
// `@qontinui/shared-types` exports once they are published.

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

export interface DeviceBranchSummary {
  device_id: string;
  repo: string;
  branch: string;
  sha: string;
  recorded_at: string;
}

export interface GitOpsListResponse {
  ops?: GitOpRecord[];
  items?: GitOpRecord[];
  count?: number;
}

export interface GitOpsBranchesResponse {
  branches?: DeviceBranchSummary[];
  items?: DeviceBranchSummary[];
  count?: number;
}

/** `GET /git-ops/list?<query>` — a dashboard poll: no client retries. */
export async function fetchGitOpsList(
  query: URLSearchParams
): Promise<GitOpsListResponse> {
  const url = `${OPERATIONS_BASE}/git-ops/list?${query.toString()}`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<GitOpsListResponse>(res, `GET ${url}`);
}

/** `GET /git-ops/branches` — a dashboard poll: no client retries. */
export async function fetchGitOpsBranches(): Promise<GitOpsBranchesResponse> {
  const url = `${OPERATIONS_BASE}/git-ops/branches`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
    maxRetries: 0,
  });
  return readJson<GitOpsBranchesResponse>(res, `GET ${url}`);
}
