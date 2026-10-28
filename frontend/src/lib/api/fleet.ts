/**
 * Fleet-fresh API — wraps the `/api/v1/fleet` endpoint surface (P5).
 *
 * Backs the `/settings/fleet` page's three sections:
 * - app config editor (`project.apps` — update strategy + build/start
 *   commands),
 * - test-host designations (`coord.test_targets` — designate + auto_fresh
 *   toggle),
 * - per-(device, app) deployment freshness (`project.app_deploy_state`,
 *   written by the runner's auto-fresh engine).
 *
 * Response shapes are typed locally against the backend's
 * `app/schemas/fleet_targets.py` Pydantic models (the generated api-client
 * snapshot is regenerated separately; local interfaces keep this page
 * decoupled from that regen, matching the `runners.ts` precedent).
 *
 * The app config read and write (`GET /apps`, `PATCH /apps/{app_id}`) are for
 * platform admins only: an app's build and start commands run on every fleet
 * machine that auto-freshes it, and `project.apps` is not kept per project
 * (coord finding `b27adf71-4de5-49bc-ad89-7a8acd372035`). Anyone else gets the
 * refusal {@link isPlatformAdminRefusal} recognises, which the UI renders as
 * {@link APP_CONFIG_ADMIN_ONLY} — never as an empty registry or a generic error.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const FLEET_API = `${ApiConfig.API_BASE_URL}/api/v1/fleet`;

/**
 * The sentence the backend's `require_admin` refuses an active user who is not
 * a platform admin with (`backend/app/api/admin_deps.py`
 * `ADMIN_REQUIRED_DETAIL`). It is what tells THIS 403 apart from any other — a
 * proxy's or a WAF's — which must not be explained as an access rule, so the
 * two copies must stay equal. Each side's tests read the other's:
 * `fleet.test.ts` checks the backend's assignment, and the backend's
 * `tests/test_fleet_apps_platform_admin_gate.py` checks this declaration,
 * which it expects on one line in exactly this form.
 */
export const PLATFORM_ADMIN_REFUSAL = "Not authorized. Admin access required.";

/** What the fleet UI says in place of the app registry and its editors. */
export const APP_CONFIG_ADMIN_ONLY =
  "App configuration is limited to platform administrators.";

/**
 * Whether a response is the platform-admin refusal of an app-config route.
 *
 * The production backend serves the sentence as the error envelope's
 * top-level `message` (`app/middleware/error_handler.py`); a bare FastAPI app
 * nests it as `detail`. Both are read. Any other 403 is NOT this refusal, so
 * its body is never promoted to "you are not a platform admin".
 */
export function isPlatformAdminRefusal(
  status: number | null,
  body: unknown
): boolean {
  if (status !== 403 || typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return (
    record.message === PLATFORM_ADMIN_REFUSAL ||
    record.detail === PLATFORM_ADMIN_REFUSAL
  );
}

/**
 * A failed `/api/v1/fleet` call: the readable sentence, plus the status and
 * parsed body it was read from, so a caller can tell a refusal apart from a
 * failure (see {@link isPlatformAdminRefusal}).
 */
export class FleetApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FleetApiError";
    this.status = status;
    this.body = body;
  }
}

/** How the runner keeps a designated host's build of an app current. */
export type UpdateStrategy = "pull_only" | "pull_build";

/** Registered app + its fleet-fresh config (`project.apps`). */
export interface FleetApp {
  app_id: string;
  display_name: string;
  repo_root: string;
  update_strategy: UpdateStrategy;
  build_command: string | null;
  start_command: string | null;
}

/** Partial update of an app's fleet-fresh config. */
export interface FleetAppUpdate {
  update_strategy?: UpdateStrategy;
  build_command?: string;
  start_command?: string;
}

/** A designated (device, app) test host, joined with device + freshness. */
export interface TestTargetRow {
  device_id: string;
  app_id: string;
  auto_fresh: boolean;
  device_name: string;
  hostname: string;
  derived_status: string;
  freshness: string | null;
  deployed_sha: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-(device, app) deployment freshness (`project.app_deploy_state`). */
export interface FreshnessRow {
  device_id: string;
  app_id: string;
  device_name: string;
  hostname: string;
  freshness: string;
  deployed_sha: string | null;
  deployed_at: string;
  last_error: string | null;
  updated_at: string;
}

/**
 * Refusal codes `backend/app/api/v1/endpoints/fleet_targets.py` raises on a
 * test-host designation write. Their `message` is prose the backend wrote for
 * an operator (e.g. which project the device is not bound to, and how to fix
 * it). Plan
 * `2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-bound-to`.
 */
export const DESIGNATION_REFUSAL_CODES: ReadonlySet<string> = new Set([
  // PUT: the selected project has no `coord.tenant_devices` binding for the
  // device, so its runner would never see the designation.
  "device_not_bound_to_project",
  // PUT or DELETE: the (device, app) row is stamped with another project, so
  // the PUT refuses to change it and the DELETE removed nothing.
  "designation_in_other_project",
  // DELETE: coord removed nothing although the row is in the selected
  // project (a concurrent re-designation).
  "designation_not_removed",
  // PUT: coord accepted the write but the row could not be read back.
  "designation_not_visible",
  // PUT: any other coord JSON refusal, re-worded by the backend.
  "coord_refused",
  // PUT or DELETE: coord answered 5xx. The backend replaces coord's text
  // (which can carry SQL context) with its own generic message and status.
  "coord_failed",
]);

/**
 * The operator-facing message of a designation refusal body, or `null`.
 *
 * The production backend answers with a typed envelope — `{"error": "<code>",
 * "message": "<prose>", ...}` at the TOP level (`app/middleware/error_handler.py`
 * splices a dict detail carrying `error` into it); a bare FastAPI app nests the
 * same dict under `detail`. Both are read. Only the codes above are unwrapped,
 * so an unrelated body never has its text promoted to a message.
 */
export function designationRefusalMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.error === "string" &&
    DESIGNATION_REFUSAL_CODES.has(record.error) &&
    typeof record.message === "string" &&
    record.message.length > 0
  ) {
    return record.message;
  }
  return "detail" in record ? designationRefusalMessage(record.detail) : null;
}

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    let message = fallback;
    const refusal = designationRefusalMessage(body);
    if (refusal) {
      message = refusal;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (
        typeof detail === "object" &&
        detail !== null &&
        "message" in detail &&
        typeof (detail as { message: unknown }).message === "string"
      ) {
        message = (detail as { message: string }).message;
      }
    }
    throw new FleetApiError(message, response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/** List registered apps + their fleet-fresh config. */
export async function listFleetApps(): Promise<FleetApp[]> {
  const response = await httpClient.fetch(`${FLEET_API}/apps`);
  return handleResponse<FleetApp[]>(response, "Failed to load apps");
}

/** Update an app's update strategy and/or build/start commands. */
export async function updateFleetApp(
  appId: string,
  body: FleetAppUpdate
): Promise<FleetApp> {
  const response = await httpClient.fetch(
    `${FLEET_API}/apps/${encodeURIComponent(appId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      // Safe to re-issue: `update_app_config` assigns update_strategy/
      // build_command/start_command from the body; unset fields unchanged.
      idempotent: true,
    }
  );
  return handleResponse<FleetApp>(response, "Failed to update app config");
}

/** List test-host designations for the caller's devices. */
export async function listTestTargets(): Promise<TestTargetRow[]> {
  const response = await httpClient.fetch(`${FLEET_API}/test-targets`);
  return handleResponse<TestTargetRow[]>(
    response,
    "Failed to load test-host designations"
  );
}

/** Designate a device as a test host for an app (idempotent upsert). */
export async function designateTestTarget(
  deviceId: string,
  appId: string,
  autoFresh: boolean
): Promise<TestTargetRow> {
  const response = await httpClient.fetch(
    `${FLEET_API}/test-targets/${encodeURIComponent(
      deviceId
    )}/${encodeURIComponent(appId)}`,
    { method: "PUT", body: JSON.stringify({ auto_fresh: autoFresh }) }
  );
  return handleResponse<TestTargetRow>(
    response,
    "Failed to designate test host"
  );
}

/** Remove a test-host designation (idempotent). */
export async function undesignateTestTarget(
  deviceId: string,
  appId: string
): Promise<void> {
  const response = await httpClient.fetch(
    `${FLEET_API}/test-targets/${encodeURIComponent(
      deviceId
    )}/${encodeURIComponent(appId)}`,
    { method: "DELETE" }
  );
  await handleResponse<void>(response, "Failed to remove designation");
}

/** Per-(device, app) deployment freshness across the caller's devices. */
export async function listFreshness(): Promise<FreshnessRow[]> {
  const response = await httpClient.fetch(`${FLEET_API}/freshness`);
  return handleResponse<FreshnessRow[]>(response, "Failed to load freshness");
}
