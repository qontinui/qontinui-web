/**
 * Device credentials API — the operator's per-runner credential controls.
 *
 * Plan `2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web`
 * Phases 1, 2.4 and 4 (web frontend half). Three routes on the devices router:
 *
 * - `GET  /api/v1/devices/credential-overview` — per device: machine-key
 *   presence / expiry / revocation, the device-scoped credential deny, and any
 *   pending operator-authorized redeem. Credential POSTURE is deliberately NOT
 *   here: it is read from coord's `GET /coord/status` stream, the same way
 *   `/admin/coord/devops` reads it (`coordCredentialStatus.ts`).
 * - `POST /api/v1/devices/{device_id}/authorize-redeem` — grant an
 *   authorization the runner picks up on its next refresher tick. Returns 202
 *   with an `expires_at` and NEVER the pair code; a 202 is not a success of
 *   the runner re-authenticating, only of the authorization being recorded.
 * - `POST /api/v1/devices/{device_id}/machine-credential/revoke` — withdraw the
 *   machine key and set the device-scoped deny.
 *
 * All three go through the shared `httpClient` so the Cognito bearer and the
 * active-tenant header are attached, exactly as `pair_codes.ts` does.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1`;

/** Web's own `device_machine_credentials` row, as the overview reports it. */
export interface MachineKeySummary {
  /** A key row exists for this device (revoked or not). */
  present: boolean;
  /** ISO-8601, or null when no key is held. */
  expires_at: string | null;
  /** ISO-8601 when the key was revoked, else null. */
  revoked_at: string | null;
}

/** One device in `GET /devices/credential-overview`. */
export interface DeviceCredentialOverviewRow {
  device_id: string;
  hostname: string | null;
  machine_key: MachineKeySummary;
  /** `coord.devices.credential_revoked_at` — the device-scoped deny. */
  credential_revoked_at: string | null;
  /** An operator authorization the runner has not yet picked up, or null. */
  pending_redeem: {
    expires_at: string;
    /** When the runner collected the code, or null while uncollected. */
    delivered_at?: string | null;
  } | null;
}

export interface DeviceCredentialOverview {
  devices: DeviceCredentialOverviewRow[];
}

export interface AuthorizeRedeemResponse {
  device_id: string;
  /** When the authorization lapses if the runner never checks in. */
  expires_at: string;
}

export interface RevokeMachineCredentialResponse {
  device_id: string;
  revoked_at: string;
}

/**
 * An API failure carrying the backend's typed refusal code when it sent one.
 *
 * The real app's `http_exception_handler` flattens a typed refusal into the
 * TOP LEVEL of the body:
 * `{"error": "<code>", "code": "<code>", "message": "...", "timestamp", "path"}`.
 * A bare router (and older backends) answer `{"detail": {"code", "message"}}`
 * instead, so both shapes are read.
 */
export class DeviceCredentialApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DeviceCredentialApiError";
    this.status = status;
    this.code = code;
  }
}

interface RefusalBody {
  error?: unknown;
  code?: unknown;
  message?: unknown;
  detail?: string | { message?: unknown; code?: unknown };
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The typed refusal code: top-level (the app handler), else `detail.code`. */
export function refusalCode(body: RefusalBody): string | undefined {
  const detail = typeof body.detail === "object" ? body.detail : undefined;
  return asText(body.code) ?? asText(body.error) ?? asText(detail?.code);
}

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body = ((await response.json().catch(() => ({}))) ??
      {}) as RefusalBody;
    const detail = body.detail;
    const message =
      asText(body.message) ??
      (typeof detail === "string" ? asText(detail) : asText(detail?.message)) ??
      `${fallback} (HTTP ${response.status})`;
    throw new DeviceCredentialApiError(
      message,
      response.status,
      refusalCode(body)
    );
  }
  return (await response.json()) as T;
}

/** Per-device machine-key and deny state for the caller's tenant. */
export async function getDeviceCredentialOverview(): Promise<DeviceCredentialOverview> {
  const response = await httpClient.fetch(`${API}/devices/credential-overview`);
  const body = await handleResponse<Partial<DeviceCredentialOverview>>(
    response,
    "Failed to load device credentials"
  );
  return { devices: Array.isArray(body.devices) ? body.devices : [] };
}

/**
 * Authorize one runner to re-authenticate on its next check-in.
 *
 * The target is the PATH segment only — no body field names a device.
 */
export async function authorizeDeviceRedeem(
  deviceId: string
): Promise<AuthorizeRedeemResponse> {
  const response = await httpClient.fetch(
    `${API}/devices/${encodeURIComponent(deviceId)}/authorize-redeem`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return handleResponse<AuthorizeRedeemResponse>(
    response,
    "Failed to authorize the runner"
  );
}

/** Revoke a runner's machine key and deny its credential refresh. */
export async function revokeDeviceMachineCredential(
  deviceId: string
): Promise<RevokeMachineCredentialResponse> {
  const response = await httpClient.fetch(
    `${API}/devices/${encodeURIComponent(deviceId)}/machine-credential/revoke`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return handleResponse<RevokeMachineCredentialResponse>(
    response,
    "Failed to revoke the machine key"
  );
}
