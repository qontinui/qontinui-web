/**
 * `/operations/project-state`: the web proxy of coord's operator one-screen
 * synthesis door (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`,
 * Phase 4).
 *
 * Part of the typed `/operations` client. Unlike its siblings this goes
 * through `httpClient.get` rather than `httpClient.fetch` + `readJson`: both
 * callers classify a failed read with `describeCoordPollError` or show its
 * message, which read the status and body off `httpClient.get`'s error, so the
 * error shape is kept exactly. The body is returned unparsed (`unknown`);
 * `parseProjectState` is the one reader of coord's wire.
 *
 * ## The door is slow by design, so neither caller may multiply it
 *
 * The proxy waits up to coord's whole door budget (25 s,
 * `_COORD_PROJECT_STATE_TIMEOUT` in the backend's operations module), because
 * coord degrades a slow sub-read inside a 200 rather than failing the door. A
 * `504` therefore means coord used ALL of that budget, and `httpClient`'s
 * default retries would ask it again up to four times. The 60 s poll on
 * `/admin/coord/home` sends `COORD_DASHBOARD_POLL_OPTIONS` (no retries: the
 * next tick is the retry). The `/overview` progress panel reads once, with no
 * next tick, so it sends {@link PROJECT_STATE_ONE_SHOT_OPTIONS}.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** The route, relative like every `/operations` client URL. */
export const PROJECT_STATE_URL = `${OPERATIONS_BASE}/project-state`;

/**
 * Options for a ONE-SHOT read of the door (a page that reads it once, with no
 * poll behind it). A `504` is never retried: it is the proxy giving up after
 * coord's full budget, so an immediate retry costs coord another full budget
 * while it is already slow. A fast failure (a `502` while coord restarts, a
 * `503` from the web backend) keeps `httpClient`'s retries, because a page
 * with no next tick would otherwise show it until a manual reload.
 */
export const PROJECT_STATE_ONE_SHOT_OPTIONS: HttpOptions = {
  noRetryStatuses: [504],
};

/** `GET /project-state` — coord's body, passed through untouched. */
export function fetchProjectState(options?: HttpOptions): Promise<unknown> {
  return httpClient.get<unknown>(PROJECT_STATE_URL, options);
}
