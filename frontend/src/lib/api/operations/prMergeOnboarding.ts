/**
 * `/operations/pr-merge/onboarding/*` and `/operations/coord/devices/pair-start`:
 * connecting a GitHub org (connect-state mint, claim, App config, the keyed
 * pending-installation read), the connected-accounts list with its enroll and
 * restore writes, the onboarding doctor, and the merge-orchestration wizard
 * (device pairing, preconditions, the async repo audit, accept).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7 batch 2). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline, states its
 * retry policy, and returns the PARSED body through `readJson`. A non-2xx
 * rejects with `<METHOD> <url> failed: <status> - <body>`: a caller that words
 * its own error reads the status and body back with `httpStatusOf` /
 * `httpBodyOf` (`components/admin/coord/httpStatus.ts`).
 *
 * The wire types are hand-written and each names the handler it mirrors in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which proxies coord's
 * `pr_merge::onboarding_routes` / `coord/onboarding/*` routes verbatim.
 *
 * The core `pr-merge` reads (`GET /pr-merge/repos`, …) live in `prMerge.ts`.
 *
 * A shared `request(path)` helper underneath would make every call site a
 * wrapper-of-a-wrapper, which `route-walker.test.ts` cannot resolve.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ----------------------------------------------------------------------------
// GitHub App config + connect (connect-state mint, claim, pending install)
// ----------------------------------------------------------------------------

/**
 * Coord's app-config envelope (`GET /coord/onboarding/github-app`), proxied by
 * `get_pr_merge_onboarding_github_app`.
 */
export interface GithubAppConfig {
  app_slug: string;
  client_id: string | null;
  oauth_configured: boolean;
}

/**
 * Coord's envelope for `GET /coord/onboarding/pending-installations`, passed
 * through verbatim by `get_pr_merge_onboarding_pending_installation`.
 */
export interface PendingInstallationResponse {
  /** `true` = seen and unclaimed; `false` = claimed or never seen; `null` = UNKNOWN. */
  pending: boolean | null;
  installation_id: number | null;
  account_login: string | null;
  account_type: string | null;
  repo_count: number | null;
  received_at: string | null;
  claimed_at: string | null;
  /** Set on the UNKNOWN arm: `"pending_installations_table_absent"`. */
  reason?: string;
}

/** Exactly one key — the same rule coord and the proxy enforce (400 otherwise). */
export type PendingInstallationKey =
  | { installation_id: number }
  | { account_login: string };

/**
 * The body of `POST /pr-merge/onboarding/connect-state`
 * (`post_pr_merge_onboarding_connect_state`). The target keys are OMITTED when
 * unknown, never sent empty — see `mintConnectState`.
 */
export interface ConnectStateMintBody {
  flow: string;
  target_login?: string;
  target_installation_id?: number;
}

/**
 * The connect-state mint's envelope. Coord's key is `connect_state`; `token`
 * is the alias the web side still accepts. Both optional: the caller rejects a
 * body carrying neither.
 */
export interface ConnectStateMintResponse {
  connect_state?: unknown;
  token?: unknown;
}

/**
 * The body of `POST /pr-merge/onboarding/claim`
 * (`post_pr_merge_onboarding_claim`): the OAuth code, exactly one target, the
 * server-minted connect state, and `bind_only` on the clone-picker flow.
 */
export type ClaimBody = {
  code: string;
  connect_state: string;
  bind_only?: true;
} & ({ installation_id: number } | { account_login: string });

/**
 * Coord's claim success envelope (frozen contract, coord PR #901), passed
 * through by `post_pr_merge_onboarding_claim`.
 *
 * **Only `account_login` is rendered** (the onboarding-status page). The rest
 * of this interface is a record of the wire shape, kept so a future reader can
 * see what the response carries without re-reading coord — it is deliberately
 * not a to-do list of fields to surface. The `enrolled` comment used to claim
 * the shape was "rendered generically"; nothing rendered it, and the checklist
 * reports enrolment from its own poll rather than from this envelope.
 */
export interface ClaimResponse {
  ok: boolean;
  account_login: string;
  installation_id: number;
  tenant_id: string;
  /** Coord-owned shape (count or flag). Not read — see the note above. */
  enrolled?: unknown;
}

/**
 * `GET /pr-merge/onboarding/github-app` — `get_pr_merge_onboarding_github_app`.
 */
export async function fetchGithubAppConfig(): Promise<GithubAppConfig> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/github-app`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<GithubAppConfig>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/onboarding/pending-installation` —
 * `get_pr_merge_onboarding_pending_installation`. Keyed, never listed: exactly
 * one of `installation_id` / `account_login`, under coord's own param name.
 *
 * Rejects on a non-2xx so a caller folds transport failure into the UNKNOWN
 * arm — a 502 from coord is "couldn't check", not "not installed".
 */
export async function fetchPendingInstallation(
  key: PendingInstallationKey
): Promise<PendingInstallationResponse> {
  const params = new URLSearchParams(
    "installation_id" in key
      ? { installation_id: String(key.installation_id) }
      : { account_login: key.account_login }
  );
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/pending-installation?${params.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PendingInstallationResponse>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/onboarding/connect-state` —
 * `post_pr_merge_onboarding_connect_state`. Each mint allocates a single-use
 * row, so it is never re-sent: `idempotent: false` and `maxRetries: 0` (a
 * silent retry would leak rows and mask a genuine coord outage). A 2xx whose
 * body does not parse resolves `null`; the caller treats that as "no token".
 */
export async function mintConnectStateToken(
  body: ConnectStateMintBody
): Promise<ConnectStateMintResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/connect-state`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<ConnectStateMintResponse>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/onboarding/claim` — `post_pr_merge_onboarding_claim`. Spends
 * a single-use OAuth code, so never re-sent on a 5xx (`idempotent: false`).
 * Resolves `null` for a 2xx whose body does not parse: the claim landed. A
 * rejection carries coord's error body for `httpBodyOf`.
 */
export async function claimInstallation(
  body: ClaimBody
): Promise<ClaimResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/claim`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<ClaimResponse>(res, `POST ${url}`, { unparseable: "null" });
}

// ----------------------------------------------------------------------------
// Connected accounts — list, enroll, restore
// (coord-owned contract `GET /coord/onboarding/github-accounts`)
// ----------------------------------------------------------------------------

/**
 * The tier that decided a repo's resolved merge posture, in coord's own
 * arm order (the onboarding doctor's): the tenant-wide pause dominates, then
 * the explicit per-repo pin, then an explicit `auto_merge_enabled = false`,
 * else the enabled default.
 */
export type MergePosture =
  | "default"
  | "pinned_on"
  | "pinned_off"
  | "tenant_paused"
  | "auto_merge_off";

/**
 * One repo row of a connected account. `repos` may be []. Fields marked
 * "older coord" are absent/null on a coord that predates plan 2026-09-05
 * P2/P3, and every reader tolerates that.
 */
export interface AccountRepo {
  repo: string;
  /**
   * `"enrolled"` — a live `tenant_repos` row. `"unenrolled"` — only the
   * un-enrollment tombstone remains; the installation enroll skips this repo
   * until it is restored. Absent on an older coord, which lists enrolled rows
   * only, so absent reads as enrolled.
   */
  state?: "enrolled" | "unenrolled";
  /**
   * The RAW per-repo enablement pin: `true`/`false` = explicitly pinned,
   * `null` = inheriting the enabled default. NOT the resolved verdict — the
   * tenant-wide `merge_paused` pause dominates it and is not folded in here;
   * `merge_enabled_resolved` is. Replaced `rollout_state` when plan
   * `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`
   * Phase 5 dropped that column.
   */
  merge_enabled: boolean | null;
  /**
   * The RESOLVED verdict, computed coord-side by `resolve_merge_enabled`
   * (pause → pin → default) AND-ed with the tenant's `auto_merge_enabled` —
   * the same conjunction the doctor and `EffectiveProfile::merge_permitted`
   * apply. `null` on an un-enrolled row or an older coord.
   */
  merge_enabled_resolved?: boolean | null;
  /** The tier that decided `merge_enabled_resolved`. `null` = older coord. */
  merge_posture?: MergePosture | null;
  profile_source: string | null;
  /** Tombstone fields — set only when `state === "unenrolled"`. */
  unenrolled_at?: string | null;
  unenrolled_by?: string | null;
  unenroll_reason?: string | null;
}

export interface ConnectedAccount {
  account_login: string;
  account_type: string;
  installation_id: number;
  repos: AccountRepo[];
}

/** `get_pr_merge_onboarding_accounts`'s body. */
export interface AccountsResponse {
  accounts: ConnectedAccount[];
}

/**
 * The enroll / restore spawn acknowledgement (`202`). Coord returns no repo
 * list; the caller re-reads the accounts list. No caller reads the body.
 */
export interface EnrollSpawned {
  enrolled?: string;
}

/**
 * `GET /pr-merge/onboarding/accounts` — `get_pr_merge_onboarding_accounts`.
 * `options` carries the caller's retry budget: the post-enroll poll passes
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request; the next tick is the retry).
 */
export async function fetchOnboardingAccounts(
  options: HttpOptions = {}
): Promise<AccountsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/accounts`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AccountsResponse>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/onboarding/installations/{installation_id}/enroll` —
 * `post_pr_merge_onboarding_enroll`. Spawns an off-connection enroll, so it is
 * never re-sent (`idempotent: false`, `maxRetries: 0`): a re-click is the
 * operator's call, not the client's. Resolves `null` for a 2xx whose body does
 * not parse.
 */
export async function enrollInstallation(
  installationId: number
): Promise<EnrollSpawned | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/installations/${installationId}/enroll`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<EnrollSpawned>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/onboarding/repos/{repo:path}/restore` —
 * `post_pr_merge_onboarding_restore_repo`. `repo` is `owner/name` and the
 * route's `:path` converter takes the slash, so it is NOT percent-encoded.
 * Never re-sent (`idempotent: false`, `maxRetries: 0`); resolves `null` for a
 * 2xx whose body does not parse.
 */
export async function restoreRepo(repo: string): Promise<EnrollSpawned | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/repos/${repo}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<EnrollSpawned>(res, `POST ${url}`, { unparseable: "null" });
}

// ----------------------------------------------------------------------------
// Onboarding doctor — FROZEN contract with coord's onboarding doctor (P4)
// ----------------------------------------------------------------------------

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  remediation: string | null;
}

export interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  ready_to_land: boolean;
}

/** `get_pr_merge_onboarding_doctor`'s body. */
export interface DoctorResponse {
  repo: string;
  checks: DoctorCheck[];
  summary: DoctorSummary;
}

/**
 * `GET /pr-merge/onboarding/doctor?repo=` — `get_pr_merge_onboarding_doctor`.
 * `repo` rides in the query, so it IS percent-encoded.
 */
export async function fetchOnboardingDoctor(
  repo: string
): Promise<DoctorResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/doctor?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<DoctorResponse>(res, `GET ${url}`);
}

// ----------------------------------------------------------------------------
// Merge-orchestration wizard (mirrors coord's pr_merge::onboarding_routes)
// ----------------------------------------------------------------------------

/**
 * A device the calling USER has paired to a DIFFERENT tenant. Coord computes
 * this from the forwarded X-Qontinui-User-Id header (plan
 * 2026-07-02-multi-tenant-device-pairing-reconsideration Phase 1b; the entry
 * may repeat per binding once coord reads coord.tenant_devices). Older
 * coord omits the field entirely — the poll site normalizes missing → [].
 */
export interface PairedElsewhereDevice {
  hostname: string;
  name: string | null;
  last_seen_at: string | null;
}

/** `get_pr_merge_onboarding_precondition`'s body. */
export interface PreconditionStatus {
  paired: boolean;
  claude_code_available: boolean;
  ready: boolean;
  // Pairing is ADDITIVE m:n (plan
  // 2026-07-02-session-scoped-multi-tenant-device-binding Phase 3/9):
  // non-empty means these devices also serve OTHER tenants — purely
  // informational, pairing here adds a binding and leaves the existing
  // ones untouched. Optional so the wizard degrades against older coord.
  paired_elsewhere?: PairedElsewhereDevice[];
}

/** The body of `POST /coord/devices/pair-start` (`post_coord_devices_pair_start`). */
export interface PairStartBody {
  callback_url: string;
  device_hostname: string;
  web_pair_url: string;
}

/** `post_coord_devices_pair_start`'s body. */
export interface PairStartResponse {
  state: string;
  redirect_url: string;
  expires_in: number;
}

export interface EscalatePathEntry {
  path: string;
  reason: string;
  memory_citation: string | null;
}

/** The auditor's STARTER_PROFILE, as coord stores and echoes it. */
export interface StarterProfile {
  framework_signals?: string[];
  escalate_paths?: (string | EscalatePathEntry)[];
  line_budget?: number;
  line_budget_rationale?: string;
  min_green_dwell_secs?: number;
  confidence_threshold?: number;
  auto_merge_enabled_for?: string[];
  tag_push_on_version_bump?: boolean;
  rulebook_addendum?: string;
  audit_confidence?: number;
  audit_notes?: string;
}

export interface AuditResponse {
  agent_id: string;
  repo: string;
  starter_profile: StarterProfile;
  audit_confidence: number | null;
  // Legacy synchronous-path field. The async status response no longer
  // carries it (the latency is a process-local Instant in coord, lost across
  // the stateless poll), so it's optional and the cards guard its render.
  audit_latency_secs?: number;
}

/**
 * `post_pr_merge_onboarding_audit`'s body: the primary path is a `202`
 * `{agent_id, repo, status:"running"}`; a legacy coord answered a synchronous
 * `200` carrying the profile.
 */
export type AuditDispatchBody = Partial<AuditResponse> & {
  agent_id?: string;
  status?: string;
};

/**
 * The audit dispatch's answer WITH its status: the caller tells the legacy
 * synchronous `200` from the async `202` by the status code, not the body.
 */
export interface AuditDispatch {
  httpStatus: number;
  body: AuditDispatchBody;
}

/**
 * `get_pr_merge_onboarding_audit_status`'s body — coord's stateless status
 * wrapper over `poll_starter_profile_once`.
 */
export interface AuditStatusResponse {
  status: "running" | "ready" | "failed";
  agent_id: string;
  starter_profile?: StarterProfile;
  audit_confidence?: number;
  error?: string;
}

/** The body of `POST /pr-merge/onboarding/accept`. */
export interface AcceptBody {
  repo: string;
  profile: StarterProfile;
  /** Sent ONLY when the operator left a value — coord refuses an absent one. */
  github_remote?: string;
}

/**
 * `post_pr_merge_onboarding_accept`'s body. `provisioning` /
 * `worktree_allocation` are optional: an older coord returns the pre-parity
 * envelope with neither, which the wizard renders as UNKNOWN.
 */
export interface AcceptResponse {
  repo: string;
  profile_version?: number;
  profile_source?: string;
  updated_at?: string;
  /** Per-step provisioning outcomes; open-ended keys, "failed: <reason>" values. */
  provisioning?: Record<string, string>;
  worktree_allocation?: string;
}

/**
 * `POST /coord/devices/pair-start` — `post_coord_devices_pair_start`. Each call
 * mints a fresh pair code, so it is not re-sent on a 5xx (`idempotent: false`).
 */
export async function startDevicePairing(
  body: PairStartBody
): Promise<PairStartResponse> {
  const url = `${OPERATIONS_BASE}/coord/devices/pair-start`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<PairStartResponse>(res, `POST ${url}`);
}

/**
 * `GET /pr-merge/onboarding/precondition-status` —
 * `get_pr_merge_onboarding_precondition`. `options` carries the poll's retry
 * budget (`COORD_DASHBOARD_POLL_OPTIONS`).
 */
export async function fetchPreconditionStatus(
  options: HttpOptions = {}
): Promise<PreconditionStatus> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/precondition-status`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<PreconditionStatus>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/onboarding/audit` — `post_pr_merge_onboarding_audit`.
 * Dispatches an auditor agent, so it is not re-sent on a 5xx
 * (`idempotent: false`). Resolves the status alongside the parsed body.
 */
export async function dispatchRepoAudit(repo: string): Promise<AuditDispatch> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/audit`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ repo }),
    idempotent: false,
  });
  const body = await readJson<AuditDispatchBody>(res, `POST ${url}`);
  return { httpStatus: res.status, body };
}

/**
 * `GET /pr-merge/onboarding/audit-status?agent_id=` —
 * `get_pr_merge_onboarding_audit_status`. `options` carries the poll's retry
 * budget (`COORD_DASHBOARD_POLL_OPTIONS`).
 */
export async function fetchAuditStatus(
  agentId: string,
  options: HttpOptions = {}
): Promise<AuditStatusResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/audit-status?agent_id=${encodeURIComponent(
    agentId
  )}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AuditStatusResponse>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/onboarding/accept` — `post_pr_merge_onboarding_accept`.
 * Registers and provisions the repo, so it is not re-sent on a 5xx
 * (`idempotent: false`).
 */
export async function acceptStarterProfile(
  body: AcceptBody
): Promise<AcceptResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/accept`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<AcceptResponse>(res, `POST ${url}`);
}
