// ============================================================================
// devenv digital-twin API client
//
// Typed fetch wrappers for the `/api/v1/devenv` surface (applications,
// machines, environments, drift). Mirrors the pydantic schemas in
// `backend/app/schemas/devenv.py`.
//
// Requests go through the shared `httpClient`, so they carry the
// `Authorization: Bearer` token in prod's remote/Bearer-only auth mode (a raw
// cookie-only fetch sends NO credential the remote backend accepts → a
// permanent 401, which on a one-shot page load looks like an empty tenant).
// `httpClient` also brings the 401-refresh / session-expiry handling and the
// 429/5xx retry every other authed service already relies on.
// ============================================================================

import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";

/** Base URL for the devenv surface. */
export const DEVENV_API = `${ApiConfig.API_BASE_URL}/api/v1/devenv`;

/** Drift poll cadence (ms) — matches the fleet/dev-action 10s cadence. */
export const DRIFT_POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// Severity / status literals
// ---------------------------------------------------------------------------

export type Severity = "info" | "warning" | "critical";
export type DeltaStatus = "added" | "removed" | "changed";

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export interface Application {
  id: string;
  /** The resource owner — sharing/unsharing is owner-only. */
  owner_user_id: string;
  /** Org this application is shared with, or null when personal. */
  organization_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationCreate {
  name: string;
  slug: string;
  description?: string | null;
  /** Share with an org from birth (caller must hold an edit role there). */
  organization_id?: string | null;
}

export interface ApplicationUpdate {
  name?: string;
  slug?: string;
  description?: string | null;
  /** Set = share with that org; explicit null = revert to personal. */
  organization_id?: string | null;
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export interface Machine {
  id: string;
  name: string;
  hostname: string | null;
  description: string | null;
  key_prefix: string | null;
  enrolled: boolean;
  last_seen_at: string | null;
  revoked: boolean;
  /** Environment this machine is explicitly bound to, or null when unbound. */
  environment_id: string | null;
  /**
   * Bridge to coord's device registry (`coord.devices.device_id`), or null
   * when unbridged. Soft pointer — set at agent enroll or by the
   * unambiguous-hostname backfill. Optional: older backends omit it.
   */
  coord_device_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** Machine create/regenerate-enrollment response: includes the ONE-TIME code. */
export interface MachineCreated extends Machine {
  enrollment_code: string;
  enrollment_expires_at: string;
}

export interface MachineCreate {
  name: string;
  hostname?: string | null;
  description?: string | null;
  environment_id?: string | null;
}

export interface MachineUpdate {
  name?: string;
  hostname?: string | null;
  description?: string | null;
  environment_id?: string | null;
}

// ---------------------------------------------------------------------------
// CI-node configuration (per machine)
//
// Mirrors the runner's Rust `CiNodeSettings`
// (qontinui-runner/src-tauri/src/settings.rs). THAT STRUCT IS THE AUTHORITY
// for the shape; this is the editor's view of it. When it gains a field, add
// it here and to the backend's `CiNodeConfig` in the same PR.
// ---------------------------------------------------------------------------

/** The four `CiNodeSettings` fields. */
export interface CiNodeConfig {
  /** Master opt-in. Enabling lets coord run repo-declared commands here. */
  enabled: boolean;
  /** Concurrent CI builds this device admits (and advertises as its budget). */
  max_concurrent_builds: number;
  /**
   * Repos this device may build. Empty means NOTHING is runnable even when
   * `enabled` — allowlisting is a deliberate act. There is deliberately no
   * wildcard entry; the server rejects one.
   */
  repo_allowlist: string[];
  /** Free disk (GiB) required on the runner's volume to START a build. */
  min_free_disk_gb: number;
}

/**
 * How reachable the paired coord device is, as far as coord will say.
 *
 * `unknown` is NOT a synonym for `offline`: "we could not ask coord" and "the
 * device is not connected" are different claims and the UI must not merge them.
 */
export type CiNodeReachability = "unlinked" | "offline" | "online" | "unknown";

/**
 * A machine's DESIRED CI-node config plus how far it has travelled.
 *
 * qontinui.io has NO read-back channel for the runner's settings file, and the
 * runner sends no acknowledgement for settings. So `requested` is what was
 * asked for, `dispatched_at` is when coord accepted it for delivery, and
 * neither is evidence that the runner applied it. Render them as such.
 */
export interface CiNodeConfigState {
  machine_id: string;
  coord_device_id: string | null;
  requested: CiNodeConfig;
  /** False when this surface has never saved a config for the machine. */
  configured: boolean;
  requested_at: string | null;
  /** When coord last ACCEPTED the directive. Handed off, never confirmed. */
  dispatched_at: string | null;
  reachability: CiNodeReachability;
  /** Outcome of THIS request's dispatch; null on a read (nothing attempted). */
  dispatched: boolean | null;
  dispatch_detail: string | null;
}

/**
 * The runner's OWN defaults, copied from its `Default for CiNodeSettings`.
 * A machine nobody has configured must render as the posture the runner
 * actually ships with — off, with an empty allowlist — never a friendlier one.
 */
export const CI_NODE_DEFAULTS: CiNodeConfig = {
  enabled: false,
  max_concurrent_builds: 1,
  repo_allowlist: [],
  min_free_disk_gb: 20,
};

export function getCiNodeConfig(machineId: string): Promise<CiNodeConfigState> {
  return request<CiNodeConfigState>(
    `/machines/${encodeURIComponent(machineId)}/ci-node`
  );
}

/** Save the desired config AND ask coord to deliver it to the paired runner. */
export function setCiNodeConfig(
  machineId: string,
  config: CiNodeConfig
): Promise<CiNodeConfigState> {
  return request<CiNodeConfigState>(
    `/machines/${encodeURIComponent(machineId)}/ci-node`,
    { method: "PUT", body: JSON.stringify(config) }
  );
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export interface Environment {
  id: string;
  /** The resource owner — sharing/unsharing is owner-only. */
  owner_user_id: string;
  /** Org this environment is shared with, or null when personal. */
  organization_id: string | null;
  name: string;
  description: string | null;
  application_id: string | null;
  canonical_machine_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentCreate {
  name: string;
  description?: string | null;
  application_id?: string | null;
  /** Share with an org from birth (caller must hold an edit role there). */
  organization_id?: string | null;
}

export interface EnvironmentUpdate {
  name?: string;
  description?: string | null;
  application_id?: string | null;
  /** Set = share with that org; explicit null = revert to personal. */
  organization_id?: string | null;
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

export interface KeyDelta {
  key: string;
  status: DeltaStatus;
  expected: string | null;
  actual: string | null;
  severity: Severity;
  /**
   * Whether this key is read from the repo the capturing binary was built
   * from rather than from the machine (`runner_crate_version`, `node_dep_*`).
   * Reported at `info` and never counted as drift — it converges by pulling
   * the repo, never by an apply.
   *
   * Optional: the frontend and the backend deploy independently, so a
   * frontend released ahead of the backend must tolerate its absence.
   */
  derived?: boolean;
}

export interface SectionDrift {
  section: string;
  deltas: KeyDelta[];
  severity: Severity;
  /**
   * Whether this section's capture reflects the capturing process rather than
   * the box (`env_contract`), so its deltas may be process-scope artifacts.
   * Labelled, never suppressed — a genuinely missing value looks identical
   * server-side. Optional for the same deploy-skew reason as {@link KeyDelta.derived}.
   */
  process_scoped?: boolean;
}

export interface MachineDriftReport {
  machine_id: string | null;
  machine_name: string | null;
  sections: SectionDrift[];
  severity: Severity;
  in_sync: boolean;
  schema_version_mismatch: boolean;
  expected_schema_version: number | null;
  actual_schema_version: number | null;
  has_config: boolean;
}

export interface EnvironmentDrift {
  environment_id: string;
  canonical_machine_id: string | null;
  canonical_machine_name: string | null;
  reports: MachineDriftReport[];
  severity: Severity;
  in_sync: boolean;
}

// ---------------------------------------------------------------------------
// Config history (P2 — drift over time)
// ---------------------------------------------------------------------------

/**
 * One capture in a machine's config-history timeline (newest-first).
 * Metadata only — the backend deliberately omits the config body; content is
 * reachable through the diff endpoint as a drift report.
 */
export interface ConfigHistoryEntry {
  id: string;
  captured_at: string;
  schema_version: number;
  source: string;
  content_hash: string;
}

/**
 * SELF-drift between two captures of the SAME machine over time. Same shape
 * as `MachineDriftReport` (the `from` capture fills the expected slot, `to`
 * the actual), extended with the identity of the two compared captures.
 */
export interface ConfigHistoryDiff extends MachineDriftReport {
  from_id: string;
  to_id: string;
  from_captured_at: string;
  to_captured_at: string;
}

// ---------------------------------------------------------------------------
// Canonical-designation audit trail
// ---------------------------------------------------------------------------

/**
 * One audited canonical-designation change ("who made this machine canonical,
 * and when"), newest-first in a list.
 *
 * **Every display name is nullable BY DESIGN, not as an edge case.**
 * `from_machine_id`/`to_machine_id` are deliberately soft refs (NOT foreign
 * keys) so the audit trail outlives machine deletion, and `changed_by_user_id`
 * is an FK with `ON DELETE SET NULL`. The server resolves the names with LEFT
 * joins, so a deleted machine or user yields `null` here while the id may
 * still be present. Renderers MUST fall back gracefully (see
 * `CanonicalHistoryPanel`) — a null name is never an error state.
 */
export interface CanonicalChange {
  id: string;
  environment_id: string;
  from_machine_id: string | null;
  to_machine_id: string | null;
  changed_by_user_id: string | null;
  tenant_id: string | null;
  note: string | null;
  changed_at: string;
  /** Resolved from `auth.users.email`; null when the user row is gone. */
  changed_by_email: string | null;
  /** Resolved from `devenv.machines.name`; null when the machine is gone. */
  from_machine_name: string | null;
  /** Resolved from `devenv.machines.name`; null when the machine is gone. */
  to_machine_name: string | null;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Error raised by the devenv client. Carries the HTTP status and the
 * backend error `code` when the body is the `{detail: {code, message}}`
 * envelope used across the devenv endpoints.
 */
export class DevenvApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "DevenvApiError";
    this.status = status;
    this.code = code;
  }
}

interface DetailEnvelope {
  detail?:
    | string
    | { code?: string; message?: string }
    | { code?: string; message?: string }[];
}

async function parseError(res: Response): Promise<DevenvApiError> {
  let message = `Request failed (${res.status})`;
  let code: string | null = null;
  try {
    const body = (await res.json()) as DetailEnvelope;
    const detail = body.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      const first = detail[0];
      if (first?.message) message = first.message;
      if (first?.code) code = first.code;
    } else if (detail && typeof detail === "object") {
      if (detail.message) message = detail.message;
      if (detail.code) code = detail.code ?? null;
    }
  } catch {
    // Non-JSON body — keep the status-based default message.
  }
  return new DevenvApiError(res.status, message, code);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `httpClient.fetch` attaches the Bearer token (+ credentials, CSRF, and the
  // 401-refresh / 429-5xx retry). We keep the raw Response so the devenv error
  // envelope (`{detail:{code,message}}` → DevenvApiError) is preserved rather
  // than swallowed by httpClient's throw-on-non-ok helpers.
  const res = await httpClient.fetch(`${DEVENV_API}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export function listApplications(): Promise<Application[]> {
  return request<Application[]>("/applications");
}

export function getApplication(id: string): Promise<Application> {
  return request<Application>(`/applications/${encodeURIComponent(id)}`);
}

export function createApplication(
  payload: ApplicationCreate
): Promise<Application> {
  return request<Application>("/applications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateApplication(
  id: string,
  payload: ApplicationUpdate
): Promise<Application> {
  return request<Application>(`/applications/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteApplication(id: string): Promise<void> {
  return request<void>(`/applications/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export function listMachines(): Promise<Machine[]> {
  return request<Machine[]>("/machines");
}

export function getMachine(id: string): Promise<Machine> {
  return request<Machine>(`/machines/${encodeURIComponent(id)}`);
}

export function createMachine(payload: MachineCreate): Promise<MachineCreated> {
  return request<MachineCreated>("/machines", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Create a machine + dispatch an enroll directive to a paired coord device. */
export interface DispatchEnrollRequest extends MachineCreate {
  /** The paired coord device (runner) to dispatch the enroll directive to. */
  target_device_id: string;
}

/**
 * Result of a dispatched enroll. `machine` always carries the created machine +
 * its one-time code (so the UI can fall back to the copy-paste command when the
 * runner is offline / the dispatch did not land). `dispatched` is true when
 * coord accepted the directive.
 */
export interface DispatchEnrollResponse {
  machine: MachineCreated;
  dispatched: boolean;
  detail: string | null;
}

export function dispatchEnroll(
  payload: DispatchEnrollRequest
): Promise<DispatchEnrollResponse> {
  return request<DispatchEnrollResponse>("/machines/dispatch-enroll", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMachine(
  id: string,
  payload: MachineUpdate
): Promise<Machine> {
  return request<Machine>(`/machines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMachine(id: string): Promise<void> {
  return request<void>(`/machines/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function regenerateEnrollment(id: string): Promise<MachineCreated> {
  return request<MachineCreated>(
    `/machines/${encodeURIComponent(id)}/regenerate-enrollment`,
    { method: "POST" }
  );
}

export function revokeMachine(id: string): Promise<Machine> {
  return request<Machine>(`/machines/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}

/**
 * Bind a machine to an environment (or unbind it with `environmentId: null`).
 * Mirrors `PUT /machines/{id}/environment` — the explicit P1 binding that
 * enrollment honors when several environments exist.
 */
export function setMachineEnvironment(
  id: string,
  environmentId: string | null
): Promise<Machine> {
  return request<Machine>(`/machines/${encodeURIComponent(id)}/environment`, {
    method: "PUT",
    body: JSON.stringify({ environment_id: environmentId }),
  });
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export function listEnvironments(): Promise<Environment[]> {
  return request<Environment[]>("/environments");
}

export function getEnvironment(id: string): Promise<Environment> {
  return request<Environment>(`/environments/${encodeURIComponent(id)}`);
}

export function createEnvironment(
  payload: EnvironmentCreate
): Promise<Environment> {
  return request<Environment>("/environments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEnvironment(
  id: string,
  payload: EnvironmentUpdate
): Promise<Environment> {
  return request<Environment>(`/environments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteEnvironment(id: string): Promise<void> {
  return request<void>(`/environments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Longest note the API accepts (`SetCanonicalRequest.note`, max_length=500). */
export const CANONICAL_NOTE_MAX_LEN = 500;

/**
 * Designate a machine as canonical, optionally recording WHY.
 *
 * `note` is stored on the audit row and rendered by `CanonicalHistoryPanel`.
 * A blank note is sent as `null`, never `""` — the server validator enforces
 * the same rule, so "has a note" stays a truthiness check for every reader.
 */
export function setCanonicalMachine(
  environmentId: string,
  machineId: string,
  note?: string | null
): Promise<Environment> {
  return request<Environment>(
    `/environments/${encodeURIComponent(environmentId)}/canonical`,
    {
      method: "PUT",
      body: JSON.stringify({
        machine_id: machineId,
        note: note?.trim() || null,
      }),
    }
  );
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

export function getEnvironmentDrift(
  environmentId: string
): Promise<EnvironmentDrift> {
  return request<EnvironmentDrift>(
    `/environments/${encodeURIComponent(environmentId)}/drift`
  );
}

export function getMachineDrift(
  environmentId: string,
  machineId: string
): Promise<MachineDriftReport> {
  return request<MachineDriftReport>(
    `/environments/${encodeURIComponent(
      environmentId
    )}/drift/${encodeURIComponent(machineId)}`
  );
}

// ---------------------------------------------------------------------------
// Config history
// ---------------------------------------------------------------------------

/** A machine's capture timeline for an environment, newest first (metadata only). */
export function getConfigHistory(
  environmentId: string,
  machineId: string,
  limit = 50,
  offset = 0
): Promise<ConfigHistoryEntry[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return request<ConfigHistoryEntry[]>(
    `/environments/${encodeURIComponent(
      environmentId
    )}/machines/${encodeURIComponent(machineId)}/config-history?${params}`
  );
}

/** Diff two captures of the same machine (what changed going from → to). */
export function getConfigHistoryDiff(
  environmentId: string,
  machineId: string,
  fromId: string,
  toId: string
): Promise<ConfigHistoryDiff> {
  const params = new URLSearchParams({ from_id: fromId, to_id: toId });
  return request<ConfigHistoryDiff>(
    `/environments/${encodeURIComponent(
      environmentId
    )}/machines/${encodeURIComponent(machineId)}/config-history/diff?${params}`
  );
}

// ---------------------------------------------------------------------------
// Canonical-designation audit trail
// ---------------------------------------------------------------------------

/**
 * Rows per canonical-history page. Shared with the panel (and its test) so the
 * "a full page means older rows exist" inference can never be made against a
 * page size the request did not actually use.
 */
export const CANONICAL_HISTORY_PAGE_SIZE = 50;

/**
 * One page of the environment's canonical-designation changes, newest first.
 *
 * An EMPTY first page is the correct, expected state until the next
 * designation — the audit only records changes made after the audit log
 * shipped. Callers must render an explicit empty state, never an error.
 *
 * Paged like `getConfigHistory`: a full page means older changes may exist,
 * fetched by advancing `offset`.
 */
export function getCanonicalHistory(
  environmentId: string,
  limit = CANONICAL_HISTORY_PAGE_SIZE,
  offset = 0
): Promise<CanonicalChange[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return request<CanonicalChange[]>(
    `/environments/${encodeURIComponent(
      environmentId
    )}/canonical-history?${params}`
  );
}
