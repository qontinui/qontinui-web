/**
 * `/operations/repos` routes: the tenant's canonical repository list.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7b). Same conventions as `coordMembers.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>`.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One registered repository of `ReposResponse.repos`. */
export interface CanonicalRepo {
  repo: string;
  mirror_state?: string | null;
  last_reconciled_at?: string | null;
  created_at?: string | null;
}

/** `GET /repos` body. */
export interface ReposResponse {
  repos: CanonicalRepo[];
}

/** `GET /repos` — the tenant's registered repositories. */
export async function fetchRepos(): Promise<ReposResponse> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ReposResponse>(res, `GET ${url}`);
}

/**
 * `POST /repos` — register `owner/name`. Never re-sent on a 5xx
 * (`idempotent: false`). The caller ignores the body, so a 2xx whose body does
 * not parse resolves `null` rather than failing a registration that landed.
 */
export async function registerRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ repo }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `DELETE /repos?repo=` — unregister one repository. */
export async function removeRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}
