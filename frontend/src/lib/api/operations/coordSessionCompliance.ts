/**
 * `/operations/coord/session-compliance` — the session-compliance enforcement
 * settings, their version history, recent session verdicts and the
 * outstanding-work ledger — through the coord proxy.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import type {
  ListComplianceSessionsResponse,
  ListConfigVersionsResponse,
  ListOutstandingResponse,
  SessionComplianceConfig,
  SessionComplianceConfigUpdate,
} from "@/app/(app)/admin/coord/prompt-documents/compliance-types";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /coord/session-compliance/config` — the current enforcement settings. */
export async function fetchSessionComplianceConfig(): Promise<SessionComplianceConfig> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SessionComplianceConfig>(res, `GET ${url}`);
}

/** `GET /coord/session-compliance/config/versions` — the settings audit trail. */
export async function fetchSessionComplianceConfigVersions(): Promise<ListConfigVersionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config/versions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListConfigVersionsResponse>(res, `GET ${url}`);
}

/** `PUT /coord/session-compliance/config` — save the settings; coord versions the row. */
export async function putSessionComplianceConfig(
  patch: SessionComplianceConfigUpdate
): Promise<SessionComplianceConfig> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/config`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(patch),
    idempotent: true,
  });
  return readJson<SessionComplianceConfig>(res, `PUT ${url}`);
}

/** `GET /coord/session-compliance/sessions?<query>` — one page of session verdicts. */
export async function fetchComplianceSessions(
  query: URLSearchParams
): Promise<ListComplianceSessionsResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/sessions?${query.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListComplianceSessionsResponse>(res, `GET ${url}`);
}

/** `GET /coord/session-compliance/outstanding` — the outstanding-work ledger. */
export async function fetchComplianceOutstanding(): Promise<ListOutstandingResponse> {
  const url = `${OPERATIONS_BASE}/coord/session-compliance/outstanding`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ListOutstandingResponse>(res, `GET ${url}`);
}
