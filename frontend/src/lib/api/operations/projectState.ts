/**
 * `/operations/project-state`: the web proxy of coord's operator one-screen
 * synthesis door (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`,
 * Phase 4).
 *
 * Part of the typed `/operations` client. Unlike its siblings this goes
 * through `httpClient.get` rather than `httpClient.fetch` + `readJson`: both
 * callers classify a failed poll with `describeCoordPollError`, which reads
 * the status and body off `httpClient.get`'s error, so the error shape is kept
 * exactly. The body is returned unparsed (`unknown`); `parseProjectState` is
 * the one reader of coord's wire.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** The route, relative like every `/operations` client URL. */
export const PROJECT_STATE_URL = `${OPERATIONS_BASE}/project-state`;

/** `GET /project-state` — coord's body, passed through untouched. */
export function fetchProjectState(options?: HttpOptions): Promise<unknown> {
  return httpClient.get<unknown>(PROJECT_STATE_URL, options);
}
