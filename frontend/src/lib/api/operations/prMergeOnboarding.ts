/**
 * `/operations/pr-merge/onboarding/*` and `/operations/coord/devices/pair-start`:
 * the merge-orchestration onboarding wizard (device pairing, the async repo
 * audit, accepting the starter profile), the GitHub App connect cards (the
 * App config, an installation's enroll and a repo's restore, the connected
 * accounts) and the onboarding doctor.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and states
 * its retry policy.
 *
 * Two functions resolve a parsed body through `readJson` (a non-2xx rejects
 * with `GET <url> failed: <status> - <body>`). The rest return the raw
 * `Response`, because each caller maps a status (a 404 from a coord a deploy
 * behind, a 409 `next_step`, a 202 accepted, an error code in the body) to its
 * own wording. The wire types stay with the components that render them; the
 * two parsed reads take the body type as a parameter.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /pr-merge/onboarding/github-app` — the GitHub App's public config. Default retries. */
export function fetchOnboardingGithubApp(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/onboarding/github-app`);
}

/**
 * `POST /pr-merge/onboarding/installations/{id}/enroll` — enroll an
 * installation's repositories. Never re-sent (`maxRetries: 0`): coord answers
 * 202 and the caller polls the accounts read for the outcome.
 */
export function postOnboardingEnroll(
  installationId: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/onboarding/installations/${installationId}/enroll`,
    { method: "POST", maxRetries: 0 }
  );
}

/**
 * `POST /pr-merge/onboarding/repos/{repo}/restore` — re-enroll one repository
 * (`repo` is `owner/name`, inlined as two path segments). Never re-sent
 * (`maxRetries: 0`).
 */
export function postOnboardingRestore(repo: string): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/onboarding/repos/${repo}/restore`,
    { method: "POST", maxRetries: 0 }
  );
}

/**
 * `GET /pr-merge/onboarding/accounts` — the tenant's connected GitHub
 * accounts. `polled` marks the enroll/restore progress poll, which sends no
 * client retries (`maxRetries: 0`); the first read keeps the default budget.
 */
export async function fetchOnboardingAccounts<T>(polled: boolean): Promise<T> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/accounts`;
  const res = await httpClient.fetch(
    url,
    polled ? { method: "GET", maxRetries: 0 } : { method: "GET" }
  );
  return readJson<T>(res, `GET ${url}`);
}

/** `GET /pr-merge/onboarding/doctor?repo=<owner/name>` — the onboarding doctor's checks. Default retries. */
export async function fetchOnboardingDoctor<T>(repo: string): Promise<T> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/doctor?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET" });
  return readJson<T>(res, `GET ${url}`);
}

/** `POST /coord/devices/pair-start` — begin pairing the operator's local runner. */
export function postDevicePairStart(
  body: Record<string, string>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/coord/devices/pair-start`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * `POST /pr-merge/onboarding/audit` — dispatch the async repo audit. The POST
 * is fast (coord answers 202 `{agent_id, repo, status: "running"}`), so the
 * default client timeout is correct; the slow work is polled via
 * {@link fetchOnboardingAuditStatus}.
 */
export function postOnboardingAudit(repo: string): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/onboarding/audit`, {
    method: "POST",
    body: JSON.stringify({ repo }),
  });
}

/** `GET /pr-merge/onboarding/audit-status?agent_id=<id>` — the audit's progress. A poll: no client retries. */
export function fetchOnboardingAuditStatus(agentId: string): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/onboarding/audit-status?agent_id=${encodeURIComponent(
      agentId
    )}`,
    { method: "GET", maxRetries: 0 }
  );
}

/** `POST /pr-merge/onboarding/accept` — accept the (possibly edited) starter profile. */
export function postOnboardingAccept(
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/onboarding/accept`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `GET /pr-merge/onboarding/precondition-status` — pairing / Claude Code readiness. A poll: no client retries. */
export function fetchOnboardingPreconditionStatus(): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/pr-merge/onboarding/precondition-status`,
    { method: "GET", maxRetries: 0 }
  );
}
