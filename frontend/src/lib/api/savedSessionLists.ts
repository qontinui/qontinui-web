/**
 * The saved tab lists' client — `/api/v1/saved-session-lists`.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. The four routes Phase 2 serves: capture (`POST`), list (`GET`), one
 * list with its layout (`GET /{list_id}`) and delete (`DELETE /{list_id}`).
 *
 * The wire types are the generated ones (`lib/api-client/generated-types.ts`,
 * from the backend's OpenAPI snapshot), so a backend shape change is a type
 * error here, not a silent drift. Conventions are the taste client's: every
 * call goes through `httpClient.fetch` on a RELATIVE URL written inline (so
 * `route-walker.test.ts` checks each one against the snapshot), and a non-2xx
 * rejects with a {@link BackendError}. Its `status` is what a caller branches
 * on and its reading is what `BackendErrorMessage` renders, including the
 * capture's typed refusals (`runner_predates_terminal_layout`,
 * `runner_egress_off`, the relay's own `device_not_owned` /
 * `runner_not_connected`, …) — {@link refusalDiscriminator} names which one.
 *
 * A 2xx whose body is not the promised shape also rejects (R6, "ask the
 * delivery question of the envelope"): a list read that carried no array is a
 * read that delivered nothing, never an empty list.
 */

import type { components } from "@/lib/api-client/generated-types";
import { BackendError, backendError } from "@/lib/errors/backend-error-message";
import { httpClient } from "@/services/service-factory";

type Schemas = components["schemas"];
/** One saved list without its layout: the list route's row. */
export type SavedSessionListSummary = Schemas["SavedSessionListSummary"];
/** One saved list with its layout and coord's per-session answers. */
export type SavedSessionListDetail = Schemas["SavedSessionListDetail"];
/** The capture's body: which device's runner to read, and a title. */
export type SavedSessionListCreate = Schemas["SavedSessionListCreate"];
/** coord's work-axis answer for one session, read at capture. */
export type SavedSessionListCoordStatus =
  Schemas["SavedSessionListCoordStatus"];
export type TerminalLayout = Schemas["TerminalLayout"];
export type TerminalLayoutRunner = Schemas["TerminalLayoutRunner"];
export type TerminalLayoutPage = Schemas["TerminalLayoutPage"];
export type TerminalLayoutSession = Schemas["TerminalLayoutSession"];

export const SAVED_SESSION_LISTS_BASE = "/api/v1/saved-session-lists";

/** The longest title the backend stores (`SavedSessionListCreate.title`). */
export const SAVED_SESSION_LIST_TITLE_MAX = 200;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The fields every list row is read by. */
function isSummary(value: unknown): value is SavedSessionListSummary {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.device_id === "string" &&
    typeof value.captured_at === "string" &&
    typeof value.expires_at === "string"
  );
}

/** A summary that also carries the layout the detail renders. */
function isDetail(value: unknown): value is SavedSessionListDetail {
  if (!isSummary(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    isObject(v.layout) &&
    Array.isArray(v.layout.pages) &&
    isObject(v.coord_status)
  );
}

async function readDetail(res: Response): Promise<SavedSessionListDetail> {
  if (!res.ok) throw await backendError(res);
  const body: unknown = await res.json();
  if (!isDetail(body)) {
    throw new Error(
      "the saved tab list answer carried no list: its layout was missing"
    );
  }
  return body;
}

/** The caller's unexpired saved lists, newest first, without layouts. */
export async function listSavedSessionLists(
  options: { signal?: AbortSignal } = {}
): Promise<SavedSessionListSummary[]> {
  const res = await httpClient.fetch(SAVED_SESSION_LISTS_BASE, {
    method: "GET",
    signal: options.signal,
  });
  if (!res.ok) throw await backendError(res);
  const body: unknown = await res.json();
  if (!Array.isArray(body) || !body.every(isSummary)) {
    throw new Error(
      "the saved tab lists read answered without a list of saved lists"
    );
  }
  return body;
}

/** One unexpired saved list with its layout. Rejects 404 when it is gone. */
export async function getSavedSessionList(
  listId: string,
  options: { signal?: AbortSignal } = {}
): Promise<SavedSessionListDetail> {
  const res = await httpClient.fetch(
    `${SAVED_SESSION_LISTS_BASE}/${encodeURIComponent(listId)}`,
    { method: "GET", signal: options.signal }
  );
  return readDetail(res);
}

/**
 * Save the per-tab session list of the runner that owns `device_id`'s relay
 * socket. Resolves with the new list (layout included); rejects with the
 * capture's typed refusal otherwise.
 *
 * Never retried by the client: a POST is not idempotent, and a 5xx here is a
 * typed answer (the runner timed out, answered an error, …), not a blip.
 */
export async function saveSessionList(
  body: SavedSessionListCreate
): Promise<SavedSessionListDetail> {
  const res = await httpClient.fetch(SAVED_SESSION_LISTS_BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readDetail(res);
}

/** Delete one saved list. Rejects 404 when it is already gone. */
export async function deleteSavedSessionList(listId: string): Promise<void> {
  const res = await httpClient.fetch(
    `${SAVED_SESSION_LISTS_BASE}/${encodeURIComponent(listId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw await backendError(res);
}

/**
 * The site-specific refusal code a structured backend refusal carries
 * (`runner_predates_terminal_layout`, `device_not_owned`,
 * `saved_session_list_not_found`, …), or `null` for anything else.
 */
export function refusalDiscriminator(err: unknown): string | null {
  if (!(err instanceof BackendError)) return null;
  const reading = err.reading;
  return reading.kind === "refusal" ? reading.refusal.discriminator : null;
}

/**
 * Did the backend ANSWER that this list is not there (expired, deleted, or on
 * a device the caller no longer owns)? A 404 is an answer, never an outage
 * (style guide R6) — branched on the error's status field, not its message.
 */
export function isSavedListGone(err: unknown): boolean {
  return err instanceof BackendError && err.status === 404;
}

/**
 * Could a failed capture still have saved a list?
 *
 * Every typed refusal is raised before the row is written, and a 4xx is the
 * backend refusing the request. What is left — no answer at all (a timeout,
 * a dropped connection) or a 5xx carrying no refusal (a gateway between the
 * browser and the backend) — says nothing about whether the write landed, so
 * the caller re-reads the lists rather than inviting a second save.
 */
export function saveMayHaveLanded(err: unknown): boolean {
  if (!(err instanceof BackendError)) return true;
  return err.status >= 500 && err.reading.kind !== "refusal";
}
