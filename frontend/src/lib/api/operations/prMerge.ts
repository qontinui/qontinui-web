/**
 * `/operations/pr-merge` tenant and per-repo merge settings, the merge pause
 * and enablement writes, the SLO read, and the canonical-repo registry
 * (`/operations/repos`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7 `p7-prmerge-settings`). The onboarding wizard's routes
 * (`/pr-merge/onboarding/*`) live in `prMergeOnboarding.ts`.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (same-origin, D6) with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`: read the status with
 * `httpStatusOf`, the body with `httpBodyOf`.
 *
 * The wire types are the settings page's own (`merge-settings/types.ts`,
 * mirroring coord's `pr_merge/settings.rs` + `settings_wire.rs`); each
 * function names the backend handler it fronts in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 */

import type { MergeEnabledResponse } from "@/components/operations/mergeTypes";
import type {
  RepoProfileResponse,
  SloResponse,
  TenantReposResponse,
  TenantSettingsResponse,
} from "@/components/operations/merge-settings/types";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One row of `GET /repos` (the canonical-repo registry). */
export interface CanonicalRepo {
  repo: string;
  mirror_state?: string | null;
  last_reconciled_at?: string | null;
  created_at?: string | null;
}

/** `GET /repos` — `list_repos`, proxying coord's `/coord/canonical-repos`. */
export interface CanonicalReposResponse {
  repos: CanonicalRepo[];
}

/**
 * The body of `POST /pr-merge/merge-enabled` (`post_pr_merge_merge_enabled`).
 * `enabled: null` clears a per-repo pin back to inherit.
 */
export interface MergeEnabledWrite {
  /** `"tenant"` or `"repo:<owner>/<name>"`. */
  scope: string;
  enabled: boolean | null;
  reason: string;
}

/**
 * `GET /pr-merge/settings` — `get_pr_merge_settings`: the tenant's resolved
 * profile. `options` carries the caller's retry budget.
 */
export async function fetchTenantMergeSettings(
  options: HttpOptions = {}
): Promise<TenantSettingsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<TenantSettingsResponse>(res, `GET ${url}`);
}

/**
 * `PATCH /pr-merge/settings` — `patch_pr_merge_settings`. The body is a delta
 * (`PatchTenantSettings` is `deny_unknown_fields`, so the caller sends only
 * keys coord knows). Not re-sent on a 5xx (`idempotent: false`).
 */
export async function patchTenantMergeSettings(
  body: Record<string, unknown>
): Promise<TenantSettingsResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<TenantSettingsResponse>(res, `PATCH ${url}`, {
    unparseable: "null",
  });
}

/** `GET /pr-merge/repos` — `get_pr_merge_repos`: the tenant's enrolled repos. */
export async function fetchTenantMergeRepos(): Promise<TenantReposResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TenantReposResponse>(res, `GET ${url}`);
}

/** `GET /pr-merge/slo` — `get_pr_merge_slo`: per-repo SLO windows. */
export async function fetchMergeSlo(): Promise<SloResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/slo`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<SloResponse>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/repos/{repo:path}/profile` — `get_pr_merge_repo_profile`:
 * the resolved profile plus the RAW per-repo overrides. `repo` is an
 * `owner/name` slug written into the path UNENCODED: the route is a `:path`
 * converter, and the slash is the segment boundary.
 */
export async function fetchRepoMergeProfile(
  repo: string
): Promise<RepoProfileResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos/${repo}/profile`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<RepoProfileResponse>(res, `GET ${url}`);
}

/**
 * `PATCH /pr-merge/repos/{repo:path}/profile` — `patch_pr_merge_repo_profile`.
 * The body is a delta (an absent field is "leave unchanged", `null` clears to
 * inherit). Resolves `null` when a landed write's 2xx body does not parse.
 * Not re-sent on a 5xx.
 */
export async function patchRepoMergeProfile(
  repo: string,
  body: Record<string, unknown>
): Promise<RepoProfileResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/repos/${repo}/profile`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<RepoProfileResponse>(res, `PATCH ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/merge-enabled` — `post_pr_merge_merge_enabled`: write a per-repo pin
 * or lift the tenant pause. Not re-sent on a 5xx.
 */
export async function writeMergeEnabled(
  write: MergeEnabledWrite
): Promise<MergeEnabledResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/merge-enabled`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    // Spelled field by field so the wire key order never depends on how the
    // caller built its object.
    body: JSON.stringify({
      scope: write.scope,
      enabled: write.enabled,
      reason: write.reason,
    }),
    idempotent: false,
  });
  return readJson<MergeEnabledResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/kill-switch` — `post_pr_merge_kill_switch`: the audited tenant-wide
 * pause (writes the alert row). Not re-sent on a 5xx.
 */
export async function pauseTenantMerges(
  reason: string
): Promise<MergeEnabledResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/kill-switch`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ scope: "tenant", reason }),
    idempotent: false,
  });
  return readJson<MergeEnabledResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/** `GET /repos` — `list_repos`: the tenant's registered canonical repos. */
export async function fetchCanonicalRepos(): Promise<CanonicalReposResponse> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    idempotent: true,
  });
  return readJson<CanonicalReposResponse>(res, `GET ${url}`);
}

/**
 * `POST /repos` — `register_repo`. Not re-sent on a 5xx: a repeat of a
 * register that landed is a conflict, not a no-op.
 */
export async function registerCanonicalRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `DELETE /repos?repo=` — `deregister_repo`. Retried on a 5xx by method:
 * repeating a landed delete removes nothing further.
 */
export async function deregisterCanonicalRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/repos?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}
