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
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const FLEET_API = `${ApiConfig.API_BASE_URL}/api/v1/fleet`;

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

async function handleResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    let message = fallback;
    if (typeof body === "object" && body !== null && "detail" in body) {
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
    throw new Error(message);
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
    { method: "PATCH", body: JSON.stringify(body) }
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
