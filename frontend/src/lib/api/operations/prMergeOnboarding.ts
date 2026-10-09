/**
 * `/operations/pr-merge/onboarding/*` plus the device pair-start the wizard
 * opens with: the precondition poll, the async repo audit, the profile
 * accept, the doctor, the connected-accounts list, the GitHub App config and
 * pending-installation reads, the connect-state mint, the installation claim,
 * and the enroll / restore writes.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7 `p7-prmerge-settings`). Tenant / repo merge settings live
 * in `prMerge.ts`.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * (same-origin, D6) with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`: read the status with
 * `httpStatusOf`, the raw body with `httpBodyOf`, and coord's typed JSON
 * refusal (`{error, ...}`) with {@link coordErrorBody}.
 *
 * The wire types mirror coord's `pr_merge::onboarding_routes`; each function
 * names the backend handler it fronts in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. The pending-
 * installation envelope keeps its type in `@/lib/onboarding-pending`, beside
 * the pure classifier that reads it.
 */

import { httpBodyOf } from "@/components/admin/coord/httpStatus";
import type {
  PendingInstallationKey,
  PendingInstallationResponse,
} from "@/lib/onboarding-pending";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ----------------------------------------------------------------------------
// Wire types
// ----------------------------------------------------------------------------

/**
 * A device the calling USER has paired to a DIFFERENT tenant. Coord computes
 * this from the forwarded X-Qontinui-User-Id header (plan
 * 2026-07-02-multi-tenant-device-pairing-reconsideration Phase 1b; the entry
 * may repeat per binding once coord reads coord.tenant_devices). Older coord
 * omits the field entirely — the poll site normalizes missing to [].
 */
export interface PairedElsewhereDevice {
  hostname: string;
  name: string | null;
  last_seen_at: string | null;
}

/** `GET /pr-merge/onboarding/precondition-status`. */
export interface PreconditionStatus {
  paired: boolean;
  claude_code_available: boolean;
  ready: boolean;
  /**
   * Pairing is ADDITIVE m:n (plan
   * 2026-07-02-session-scoped-multi-tenant-device-binding Phase 3/9):
   * non-empty means these devices also serve OTHER tenants — purely
   * informational. Optional so the wizard degrades against older coord.
   */
  paired_elsewhere?: PairedElsewhereDevice[];
}

/** The body of `POST /coord/devices/pair-start`. */
export interface PairStartRequest {
  callback_url: string;
  device_hostname: string;
  web_pair_url: string;
}

/** `POST /coord/devices/pair-start`. */
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
  /**
   * Legacy synchronous-path field. The async status response no longer
   * carries it, so it is optional and the cards guard its render.
   */
  audit_latency_secs?: number;
}

/**
 * `POST /pr-merge/onboarding/audit`: the async dispatch answers 202
 * `{agent_id, repo, status: "running"}`; a legacy coord answers 200 with the
 * whole {@link AuditResponse}. Every field is optional for that reason.
 */
export type AuditDispatchResponse = Partial<AuditResponse> & {
  agent_id?: string;
  status?: string;
};

/**
 * `GET /pr-merge/onboarding/audit-status` (the async poll). Mirrors coord's
 * stateless status wrapper over poll_starter_profile_once.
 */
export interface AuditStatusResponse {
  status: "running" | "ready" | "failed";
  agent_id: string;
  starter_profile?: StarterProfile;
  audit_confidence?: number;
  error?: string;
}

/**
 * Per-step provisioning outcomes, e.g. {registry: "inserted", bare_init:
 * "created", ...}. Values are human-readable; a failed step reads
 * "failed: <reason>". Keys are open-ended (coord may add steps).
 */
export type ProvisioningSteps = Record<string, string>;

/** `POST /pr-merge/onboarding/accept`. */
export interface AcceptResponse {
  repo: string;
  profile_version?: number;
  profile_source?: string;
  updated_at?: string;
  /** Optional: an older coord returns the pre-parity envelope with neither. */
  provisioning?: ProvisioningSteps;
  worktree_allocation?: string;
}

/**
 * The body of `POST /pr-merge/onboarding/accept`. `github_remote` is sent
 * only when the operator left a value in the field.
 */
export interface AcceptRequest {
  repo: string;
  profile: StarterProfile;
  github_remote?: string;
}

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

/** `GET /pr-merge/onboarding/doctor` — FROZEN contract with coord's doctor (P4). */
export interface DoctorResponse {
  repo: string;
  checks: DoctorCheck[];
  summary: DoctorSummary;
}

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

/** `GET /pr-merge/onboarding/accounts` — coord's connected GitHub accounts. */
export interface AccountsResponse {
  accounts: ConnectedAccount[];
}

/** Coord's app-config envelope (`GET /pr-merge/onboarding/github-app`). */
export interface GithubAppConfig {
  app_slug: string;
  client_id: string | null;
  oauth_configured: boolean;
}

/** The target of a claim: exactly one key. */
export type ClaimTarget =
  | { installation_id: number }
  | { account_login: string };

/** The body of `POST /pr-merge/onboarding/claim`. */
export type ClaimRequest = ClaimTarget & {
  code: string;
  /** The server-minted state binding the claim to the tenant that STARTED it. */
  connect_state: string;
  /** Clone-picker connect binds only — no repo enrollment / PRs. */
  bind_only?: true;
};

/**
 * `POST /pr-merge/onboarding/claim`: coord's claim success envelope (frozen
 * contract, coord PR #901). Only `account_login` is rendered; the rest is a
 * record of the wire shape.
 */
export interface ClaimResponse {
  ok: boolean;
  account_login: string;
  installation_id: number;
  tenant_id: string;
  /** Coord-owned shape (count or flag). Not read here. */
  enrolled?: unknown;
}

/** The body of `POST /pr-merge/onboarding/connect-state`. */
export interface ConnectStateMintRequest {
  flow: string;
  target_login?: string;
  target_installation_id?: number;
}

/**
 * Coord's typed JSON refusal read back out of a rejection from this module:
 * the parsed object after `<status> - ` in the error message, or `{}` when
 * the body is not a JSON object (a plain-prose FastAPI detail, an HTML error
 * page, a transport error).
 */
export function coordErrorBody(err: unknown): Record<string, unknown> {
  const text = httpBodyOf(err);
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

/**
 * `POST /coord/devices/pair-start` — `post_coord_devices_pair_start`: begin
 * pairing this machine's runner. Not re-sent on a 5xx.
 */
export async function startDevicePairing(
  request: PairStartRequest
): Promise<PairStartResponse> {
  const url = `${OPERATIONS_BASE}/coord/devices/pair-start`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({
      callback_url: request.callback_url,
      device_hostname: request.device_hostname,
      web_pair_url: request.web_pair_url,
    }),
    idempotent: false,
  });
  return readJson<PairStartResponse>(res, `POST ${url}`);
}

/**
 * `GET /pr-merge/onboarding/precondition-status` —
 * `get_pr_merge_onboarding_precondition`. `options` carries the poll's retry
 * budget.
 */
export async function fetchOnboardingPrecondition(
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
 * `POST /pr-merge/onboarding/audit` — `post_pr_merge_onboarding_audit`:
 * dispatch the repo audit (202) or, on a legacy coord, run it (200). Not
 * re-sent on a 5xx.
 */
export async function startOnboardingAudit(
  repo: string
): Promise<AuditDispatchResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/audit`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ repo }),
    idempotent: false,
  });
  return readJson<AuditDispatchResponse>(res, `POST ${url}`);
}

/**
 * `GET /pr-merge/onboarding/audit-status?agent_id=` —
 * `get_pr_merge_onboarding_audit_status`. `options` carries the poll's retry
 * budget.
 */
export async function fetchOnboardingAuditStatus(
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
 * `POST /pr-merge/onboarding/accept` — `post_pr_merge_onboarding_accept`:
 * register + provision the repo under the edited profile. Not re-sent on a
 * 5xx.
 */
export async function acceptOnboardingProfile(
  request: AcceptRequest
): Promise<AcceptResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/accept`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<AcceptResponse>(res, `POST ${url}`);
}

/**
 * `GET /pr-merge/onboarding/doctor?repo=` —
 * `get_pr_merge_onboarding_doctor`: the readiness checklist for one repo.
 */
export async function fetchOnboardingDoctor(
  repo: string
): Promise<DoctorResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/doctor?repo=${encodeURIComponent(
    repo
  )}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<DoctorResponse>(res, `GET ${url}`);
}

/**
 * `GET /pr-merge/onboarding/accounts` —
 * `get_pr_merge_onboarding_accounts`. `options` carries the re-pull's retry
 * budget.
 */
export async function fetchConnectedAccounts(
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
 * `GET /pr-merge/onboarding/pending-installation` —
 * `get_pr_merge_onboarding_pending_installation`: one row by exactly one key.
 */
export async function fetchPendingInstallationRow(
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
 * `GET /pr-merge/onboarding/github-app` —
 * `get_pr_merge_onboarding_github_app`: the App's slug and OAuth client id.
 */
export async function fetchGithubAppConfig(): Promise<GithubAppConfig> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/github-app`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<GithubAppConfig>(res, `GET ${url}`);
}

/**
 * `POST /pr-merge/onboarding/connect-state` —
 * `post_pr_merge_onboarding_connect_state`: mint a single-use, tenant-bound
 * connect token. One request only (`maxRetries: 0`): a mint allocates a
 * single-use row, so a silent retry would leak rows and mask a coord outage.
 * Resolves `null` when a 2xx body does not parse.
 */
export async function postConnectState(
  request: ConnectStateMintRequest
): Promise<Record<string, unknown> | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/connect-state`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<Record<string, unknown>>(res, `POST ${url}`, {
    unparseable: "null",
  });
}

/**
 * `POST /pr-merge/onboarding/claim` — `post_pr_merge_onboarding_claim`: spend
 * the single-use OAuth code and bind the installation to the tenant that
 * started the flow. Not re-sent on a 5xx. Resolves `null` when a 2xx body does
 * not parse.
 */
export async function claimInstallation(
  request: ClaimRequest
): Promise<ClaimResponse | null> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/claim`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<ClaimResponse>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/onboarding/installations/{installation_id}/enroll` —
 * `post_pr_merge_onboarding_enroll`: coord enrolls off-connection and answers
 * 202. One request only (`maxRetries: 0`). Resolves `null` on a bodiless 2xx.
 */
export async function enrollInstallation(
  installationId: number
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/installations/${installationId}/enroll`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    maxRetries: 0,
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /pr-merge/onboarding/repos/{repo:path}/restore` —
 * `post_pr_merge_onboarding_restore_repo`: lift one repo's un-enrollment
 * tombstone. `repo` is an `owner/name` slug written into the path UNENCODED
 * (a `:path` converter; the slash is the boundary). One request only
 * (`maxRetries: 0`). Resolves `null` on a bodiless 2xx.
 */
export async function restoreEnrolledRepo(repo: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/repos/${repo}/restore`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    maxRetries: 0,
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}
