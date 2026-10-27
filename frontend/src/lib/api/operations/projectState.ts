/**
 * `/operations/project-state`: the web proxy of coord's operator one-screen
 * synthesis door (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`,
 * Phase 4).
 *
 * Part of the typed `/operations` client, on its one transport (`./base`, D6
 * and its amendment): a RELATIVE, same-origin `httpClient.fetch`, parsed by
 * `readJson`. `httpClient.get` would prefix `ApiConfig.getBaseUrl()` and make
 * this read cross-origin wherever `NEXT_PUBLIC_API_URL` is set. `readJson`
 * rejects in `httpClient.get`'s own message shape
 * (`GET /api/v1/operations/project-state failed: <status> - <body>`), so both
 * callers read a failure exactly as they would from the helpers: the home
 * page's classification (through `httpStatusOf` / `httpBodyOf`) and the
 * `/overview` panel's `LoadFailure`. The body is returned unparsed
 * (`unknown`); `parseProjectState` is the one reader of coord's wire.
 *
 * ## The door is slow by design, so neither caller may multiply it
 *
 * The proxy waits up to coord's whole door budget (25 s to read, 5 s to
 * connect: `_COORD_PROJECT_STATE_TIMEOUT` in the backend's operations module),
 * because coord degrades a slow sub-read inside a 200 rather than failing the
 * door. Its `504` is that wait running out — coord took its whole 25 s, or did
 * not accept the connection within 5 s — and `httpClient`'s default retries
 * would wait it out again up to four times. The 60 s poll on
 * `/admin/coord/home` sends `COORD_DASHBOARD_POLL_OPTIONS` (no retries: the
 * next tick is the retry). The `/overview` progress panel reads once, with no
 * next tick, so it sends {@link PROJECT_STATE_ONE_SHOT_OPTIONS}.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The route, relative like every `/operations` client URL. */
export const PROJECT_STATE_URL = `${OPERATIONS_BASE}/project-state`;

/**
 * Options for a ONE-SHOT read of the door (a page that reads it once, with no
 * poll behind it). A `504` is never retried: it is the proxy's timeout on
 * coord running out, so an immediate retry waits it out again — up to coord's
 * full budget, while it is already slow. A fast failure (a `502` while coord restarts, a
 * `503` from the web backend) keeps `httpClient`'s retries, because a page
 * with no next tick would otherwise show it until a manual reload.
 */
export const PROJECT_STATE_ONE_SHOT_OPTIONS: HttpOptions = {
  noRetryStatuses: [504],
};

/** `GET /project-state` — coord's body, passed through untouched. */
export async function fetchProjectState(
  options: HttpOptions = {}
): Promise<unknown> {
  const res = await httpClient.fetch(PROJECT_STATE_URL, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${PROJECT_STATE_URL}`);
}
