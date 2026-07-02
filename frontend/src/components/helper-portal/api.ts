/**
 * Typed fetch wrappers for the helper-task portal.
 *
 * Requests go through the shared `httpClient` (Bearer token, 401 handling,
 * retry) against the web backend's `/api/v1/helper-tasks` proxy (Part B of
 * the helper-task-queue plan Phase 1.4) — never against coord directly.
 */

import { httpClient } from "@/services/service-factory";
import type {
  HelperAnswer,
  HelperAnswerRequest,
  HelperStatusResponse,
  HelperTasksResponse,
} from "./types";

const HELPER_TASKS_API = "/api/v1/helper-tasks";

/**
 * Best-effort HTTP status from an `httpClient` error.
 *
 * `HttpClient`'s verb helpers throw plain `Error`s shaped
 * `"<METHOD> <url> failed: <status> - <body>"` — there is no structured
 * status field to read, so parse it back out. Returns null when the error
 * is not one of those (network failure, abort, ...).
 */
export function errorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /\bfailed: (\d{3}) -/.exec(err.message);
  return match ? Number(match[1]) : null;
}

/** Fetch the caller's-tenant open helper tasks (the portal work queue). */
export async function fetchHelperTasks(): Promise<HelperTasksResponse> {
  return httpClient.get<HelperTasksResponse>(HELPER_TASKS_API);
}

/** Submit a verdict for a task. Resolves to the recorded answer (201). */
export async function submitHelperAnswer(
  taskId: string,
  body: HelperAnswerRequest
): Promise<HelperAnswer> {
  return httpClient.post<HelperAnswer>(
    `${HELPER_TASKS_API}/${encodeURIComponent(taskId)}/answer`,
    body
  );
}

/** Fetch the caller's helper standing (drives the /help lock-in redirect). */
export async function fetchHelperStatus(): Promise<HelperStatusResponse> {
  return httpClient.get<HelperStatusResponse>(`${HELPER_TASKS_API}/status`);
}
