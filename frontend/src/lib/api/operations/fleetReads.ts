/**
 * `/operations` fleet reads and the runner/machine writes beside them: the
 * resource samples, the CI-runner mirror, the disk volumes, the web-local
 * fleet and task-run reads, a runner's live output, a machine's display name,
 * the per-device session census and a session's control write, and the
 * fault-to-visibility alert read.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and states
 * its retry policy. A function that resolves a parsed body goes through
 * `readJson` (a non-2xx rejects with `GET <url> failed: <status> - <body>`);
 * one that returns `Response` does so because its caller words a 404, a
 * non-2xx status and an unreadable body as different facts.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * `GET /fleet/resource-samples?window_secs=<n>` — the fleet's resource samples
 * over a sparkline window. A poll: no client retries (`maxRetries: 0`), the
 * next tick is the retry.
 */
export async function fetchFleetResourceSamples<T>(
  windowSecs: number
): Promise<T> {
  const url = `${OPERATIONS_BASE}/fleet/resource-samples?window_secs=${encodeURIComponent(
    String(windowSecs)
  )}`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<T>(res, `GET ${url}`);
}

/**
 * `GET /fleet/resource-samples?device_id=<id>&history=false` — one device's
 * latest sample, for its wind-down readiness. A poll: no client retries.
 */
export function fetchDeviceResourceSample(deviceId: string): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/fleet/resource-samples?device_id=${encodeURIComponent(
      deviceId
    )}&history=false`,
    { method: "GET", maxRetries: 0 }
  );
}

/** `GET /fleet/ci-runners` — coord's CI-runner mirror. A poll: no client retries. */
export async function fetchCiRunnerMirror(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/ci-runners`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /fleet/volumes` — the latest volume snapshot per device. A poll: no client retries. */
export function fetchFleetVolumes(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/volumes`, {
    method: "GET",
    maxRetries: 0,
  });
}

/** `GET /devices/{id}/volumes` — one device's latest volume snapshot. */
export function fetchDeviceVolumes(deviceId: string): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/devices/${encodeURIComponent(deviceId)}/volumes`
  );
}

/**
 * `GET /fleet` — the web-local runner registry. Not a coord proxy, so it keeps
 * `httpClient`'s default retries.
 */
export function fetchFleet(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet`);
}

/** `GET /fleet/tasks` — the web-local aggregated task runs. Default retries. */
export function fetchFleetTasks(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/tasks`);
}

/**
 * `GET /fleet/runners/{id}/output?task_run_id=<id>&tail_chars=<n>` — a
 * runner's live AI output through the backend proxy. A poll: no client retries.
 */
export function fetchRunnerOutput(
  runnerId: string,
  taskRunId: string,
  tailChars: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/fleet/runners/${encodeURIComponent(runnerId)}/output?task_run_id=${encodeURIComponent(taskRunId)}&tail_chars=${tailChars}`,
    { method: "GET", maxRetries: 0 }
  );
}

/**
 * `PATCH /fleet/machines/{hostname}` — set (non-empty `name`) or clear (empty)
 * a machine's display name. Safe to re-issue (`idempotent: true`):
 * `rename_machine` UPSERTs the (user, hostname) row, or DELETEs it for an
 * empty name.
 */
export function renameFleetMachine(
  hostname: string,
  name: string
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/fleet/machines/${encodeURIComponent(hostname)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      idempotent: true,
    }
  );
}

/**
 * `GET /sessions/fleet?device_id=<id>&limit=<n>` — one device's session
 * census. A poll: no client retries.
 */
export function fetchDeviceFleetSessions(
  deviceId: string,
  limit: number
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/sessions/fleet?device_id=${encodeURIComponent(
      deviceId
    )}&limit=${limit}`,
    { method: "GET", maxRetries: 0 }
  );
}

/** `POST /sessions/{id}/control` — a wind-down control request for one session. */
export function postSessionControlRequest(
  sessionId: string,
  body: { action: string; reason?: string }
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/control`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/**
 * `GET /alerts/fault-to-visibility` — the trailing-window fault-to-visibility
 * percentile. Resolves `unknown`: only the caller's guard may call a 2xx
 * without the payload shape an answer. A poll: no client retries.
 */
export async function fetchFaultToVisibility(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/alerts/fault-to-visibility`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<unknown>(res, `GET ${url}`);
}
