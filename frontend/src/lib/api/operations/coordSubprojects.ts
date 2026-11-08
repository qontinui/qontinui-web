/**
 * `/operations/subprojects*` — coord's subprojects: the list (served from the
 * verdict coord's reconciler tick cached), one subproject with its verdict
 * computed live, and the operator's writes (rename / goal / note / status,
 * merge, members, and Continue).
 *
 * Plan `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6. Same conventions as `coordPlans.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting through {@link readJson} with
 * `<METHOD> <url> failed: <status> - <body>` — the string `isNotFoundError`,
 * `httpStatusOf` and `httpBodyOf` read.
 *
 * The wire types are the plan's binding contract (the shapes coord serves,
 * snake_case), proxied VERBATIM by the handlers in
 * `backend/app/api/v1/endpoints/operations/__init__.py` (`get_subprojects`
 * and its five siblings). Every field coord may leave out or send as `null`
 * is typed so: an absent value is UNKNOWN, and the readers in
 * `components/admin/coord/subprojects/subprojectStatus.ts` render it as such.
 *
 * Retry policy: the reads are idempotent GETs carrying the caller's options
 * (the pages poll with `COORD_DASHBOARD_POLL_OPTIONS`, so the next tick is the
 * retry). Every write is `idempotent: false` — a 5xx is never re-sent, because
 * a gateway timeout can arrive after coord committed. Continue is stricter
 * still, like `spawnAgent`: `maxRetries: 0` and a RAW `Response`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ─────────────────────────────── the shapes ───────────────────────────────

/** A pointer at the thing a reason or a next step is about. A PR's `id` is
 *  `owner/repo#N`. `type` is one of `gate | pr | session | work_unit |
 *  subproject | question` today; typed `string` so a newer coord's type
 *  still renders (as an unlinked label). */
export interface SubprojectRef {
  type: string;
  id: string;
  label: string;
}

/** One reason the headline is what it is. `kind` is coord's vocabulary
 *  (`gate_dependency_unowned`, `abandoned`, …); `summary` is coord's sentence. */
export interface SubprojectReason {
  kind: string;
  summary: string;
  refs: SubprojectRef[];
  detail: Record<string, unknown> | null;
}

/** One evidence source the verdict read, and whether the read landed. */
export interface SubprojectSource {
  source: string;
  state: "read" | "could_not_read" | "stale" | "unknown" | (string & {});
  as_of: string | null;
  error: string | null;
}

export interface SubprojectVerdict {
  headline: string;
  reasons: SubprojectReason[];
  sources: SubprojectSource[];
  as_of: string;
}

/** A next step, with where coord took it from (D7). */
export interface SubprojectNextStep {
  source: string;
  text: string;
  refs: SubprojectRef[];
  remedy_kind: string | null;
}

/** A count coord may not have been able to take: `null` is UNKNOWN. */
export interface SubprojectSessionCounts {
  live: number | null;
  total: number | null;
}

export interface SubprojectUnitCounts {
  total: number | null;
  open: number | null;
}

export interface SubprojectSummary {
  id: string;
  slug: string;
  title: string;
  title_source: string;
  goal: string | null;
  origin: string;
  status: string;
  merged_into: string | null;
  root_agent_session_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  /** From the cached verdict; `"unknown"` when the tick has not reached it. */
  headline: string;
  top_reason: SubprojectReason | null;
  reasons_count: number;
  sessions: SubprojectSessionCounts;
  work_units: SubprojectUnitCounts;
  last_activity_at: string | null;
  /** When the cached verdict was computed; `null` ⇒ headline `unknown`. */
  verdict_as_of: string | null;
  /**
   * coord's own answer to "is this a one-off?" — the rule its
   * `counts.folded.one_off` counts by (one member session whose work is
   * `finished`, no work unit, a `done` headline). `null` is coord saying it
   * could not tell; absent is a coord that predates the field.
   */
  one_off?: boolean | null;
}

export interface SubprojectUnattachedUnits {
  count: number | null;
  by_class: Record<string, number> | null;
}

/** Every headline's count over the read's status/origin filter (a null
 *  `last_verdict` counts as `unknown`). */
export interface SubprojectHeadlineCounts {
  needs_you: number;
  stalled: number;
  working: number;
  waiting: number;
  done: number;
  unknown: number;
}

/** The subprojects the list folds into All, counted over the same filter.
 *  A one-off is exactly one member session whose work is `finished`, no work
 *  unit, and a `done` headline — a stalled or needs-you subproject is never
 *  one. */
export interface SubprojectFoldedCounts {
  one_off: number;
  scheduled: number;
  merged: number;
}

/** The list's `counts` facet: one grouped query over the read's status and
 *  origin filter — or `null` when coord could not take it (never zeros). */
export interface SubprojectCountsFacet {
  by_headline: SubprojectHeadlineCounts;
  folded: SubprojectFoldedCounts;
  as_of: string;
}

/** `GET /subprojects` — one page of the tenant's subprojects. */
export interface SubprojectListResponse {
  items: SubprojectSummary[];
  next_cursor: string | null;
  truncated: boolean;
  /** The size of the whole filtered population; `null` when coord did not
   *  count it — UNKNOWN, never zero. */
  total: number | null;
  unattached_units: SubprojectUnattachedUnits;
  /** Absent on a coord that predates the facet; `null` when it could not
   *  take the counts. Either way the page falls back to one read per view. */
  counts?: SubprojectCountsFacet | null;
  generated_at: string;
}

/** One session's subproject, as `by-sessions` names it. */
export interface SubprojectOfSession {
  id: string;
  title: string;
  headline: string;
}

/** `GET /subprojects/by-sessions` — the subproject of each session asked
 *  about; a session with no live membership (a pending one included) is
 *  under `missing`. */
export interface SubprojectsBySessionsResponse {
  items: Record<string, SubprojectOfSession>;
  missing: string[];
}

/** coord's bound on one `by-sessions` read. */
export const SUBPROJECT_LOOKUP_MAX_IDS = 200;

/** A member session. `pending` is an allocation coord spawned whose harness
 *  session has not reported yet (D8), so it has no `agent_session_id`. */
export interface SubprojectMemberSession {
  agent_session_id: string | null;
  coord_session_id: string | null;
  allocation_agent_id: string | null;
  pending: boolean;
  name: string | null;
  device_id: string | null;
  device_name: string | null;
  liveness: "live" | "stale" | "closed" | "unknown" | (string & {});
  session_status: string | null;
  finish_reason: string | null;
  first_seen: string | null;
  last_seen: string | null;
  closed_at: string | null;
  joined_via: string;
  via_ref: string | null;
  added_at: string;
}

export interface SubprojectMemberUnit {
  work_unit_id: string;
  slug: string;
  title: string | null;
  status: string;
  project_state_class: string | null;
  /** `null` is UNKNOWN (the citations door could not say), never "none". */
  phases_remaining: number[] | null;
  joined_via: string;
}

export interface SubprojectGateMover {
  state:
    | "landed"
    | "watched"
    | "retired"
    | "not_watched"
    | "unknown"
    | (string & {});
  summary: string;
}

export interface SubprojectMemberGate {
  gate_id: string;
  phase_name: string | null;
  predicate_kind: string;
  verdict: string;
  attribution: "proven" | "uncertain" | (string & {});
  registered_by_session: string | null;
  mover: SubprojectGateMover;
  continuation_state: string | null;
}

export interface SubprojectMemberPr {
  repo: string;
  number: number;
  state: string | null;
  author_agent_session_id: string | null;
  url: string | null;
}

export interface SubprojectHistoryEntry {
  at: string;
  event: string;
  detail: unknown;
}

/** The detail's summary carries the authored next-steps note beside it. */
export interface SubprojectDetailSummary extends SubprojectSummary {
  next_steps_note: string | null;
  next_steps_note_by: string | null;
  next_steps_note_at: string | null;
}

/** `GET /subprojects/{id}` — the verdict is computed LIVE (D1). */
export interface SubprojectDetailResponse {
  subproject: SubprojectDetailSummary;
  verdict: SubprojectVerdict;
  next_steps: SubprojectNextStep[];
  sessions: SubprojectMemberSession[];
  work_units: SubprojectMemberUnit[];
  gates: SubprojectMemberGate[];
  prs: SubprojectMemberPr[];
  history: SubprojectHistoryEntry[];
  /** Present when the id asked for was merged into this one. */
  resolved_from?: string;
}

/** `PATCH /subprojects/{id}` — every key optional; send only what changes. */
export interface SubprojectPatch {
  title?: string;
  goal?: string;
  next_steps_note?: string;
  status?: "open" | "done" | "archived";
}

/** `POST /subprojects/{id}/members`. `action` names what happens to the
 *  member relative to `{id}`: attach an unattached one, move one here from
 *  wherever it is, or remove one from here. */
export interface SubprojectMembersRequest {
  action: "attach" | "move" | "remove";
  member_kind: "session" | "work_unit";
  agent_session_id?: string;
  work_unit_id?: string;
  work_unit_slug?: string;
}

export interface SubprojectMembersResponse {
  member: Record<string, unknown>;
}

export interface SubprojectMergeResponse {
  merged_into: string;
  moved_members: number;
}

export type SubprojectEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** `POST /subprojects/{id}/spawn` — Continue (D8). */
export interface SubprojectSpawnRequest {
  effort: SubprojectEffort;
  ultracode?: boolean;
  prompt_addendum?: string;
  target_device_id?: string;
  account?: string;
  repos?: Array<{ repo: string }>;
}

/** What Continue answers. `effort_requested` is what was ASKED; no field
 *  reports the effort a runner applied yet (plan 2026-10-27 Phase 8). */
export interface SubprojectSpawnResponse {
  subproject_id: string;
  allocation_agent_id: string;
  target_device_id: string | null;
  placement: "pinned" | "pool" | (string & {});
  effort_requested: string;
  ultracode_requested: boolean;
  repos: string[];
  brief_preview: string;
}

// ─────────────────────────────── the reads ───────────────────────────────

/**
 * `GET /subprojects?<query>` (`get_subprojects`). `query` carries any of
 * `status`, `headline` (one value, or several comma-separated),
 * `exclude_headline` (likewise — `done` reads every open subproject that is
 * not done in one read), `origin`, `limit` and `cursor`, exactly as the caller
 * built them; the backend forwards each one it declares, and these are all of
 * them. An empty query sends no `?` (coord then lists `status=open`). A coord
 * that predates a parameter refuses it: `400 {"error":
 * "unknown_query_parameter", "unknown": [<names>]}`.
 */
export async function fetchSubprojects(
  query: URLSearchParams,
  options: HttpOptions = {}
): Promise<SubprojectListResponse> {
  let url = `${OPERATIONS_BASE}/subprojects`;
  const qs = query.toString();
  if (qs) url += `?${qs}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<SubprojectListResponse>(res, `GET ${url}`);
}

/**
 * `GET /subprojects/by-sessions?ids=…` (`get_subprojects_by_sessions`) — one
 * batch of a page's session lookup. The caller sends at most
 * {@link SUBPROJECT_LOOKUP_MAX_IDS} harness session ids a read (more go in
 * further batches); the backend refuses more before it calls coord.
 */
export async function fetchSubprojectsBySessions(
  sessionIds: readonly string[],
  options: HttpOptions = {}
): Promise<SubprojectsBySessionsResponse> {
  // The commas stay literal (`ids=a,b`), the separator coord splits on; each
  // id is encoded on its own, so an id can never smuggle one in.
  const ids = sessionIds.map((id) => encodeURIComponent(id)).join(",");
  const url = `${OPERATIONS_BASE}/subprojects/by-sessions?ids=${ids}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<SubprojectsBySessionsResponse>(res, `GET ${url}`);
}

/** `GET /subprojects/{id}` (`get_subproject`) — the verdict computed live. */
export async function fetchSubproject(
  id: string,
  options: HttpOptions = {}
): Promise<SubprojectDetailResponse> {
  const url = `${OPERATIONS_BASE}/subprojects/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<SubprojectDetailResponse>(res, `GET ${url}`);
}

// ─────────────────────────────── the writes ───────────────────────────────

/** `PATCH /subprojects/{id}` (`patch_subproject`) — answers the summary. */
export async function updateSubproject(
  id: string,
  patch: SubprojectPatch
): Promise<SubprojectSummary> {
  const url = `${OPERATIONS_BASE}/subprojects/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    idempotent: false,
  });
  return readJson<SubprojectSummary>(res, `PATCH ${url}`);
}

/** `POST /subprojects/{id}/merge` (`post_subproject_merge`) — merge `id`
 *  INTO `intoId`; `id` resolves to `intoId` from then on. */
export async function mergeSubproject(
  id: string,
  intoId: string
): Promise<SubprojectMergeResponse> {
  const url = `${OPERATIONS_BASE}/subprojects/${encodeURIComponent(id)}/merge`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ into_id: intoId }),
    idempotent: false,
  });
  return readJson<SubprojectMergeResponse>(res, `POST ${url}`);
}

/** `POST /subprojects/{id}/members` (`post_subproject_members`). */
export async function changeSubprojectMember(
  id: string,
  request: SubprojectMembersRequest
): Promise<SubprojectMembersResponse> {
  const url = `${OPERATIONS_BASE}/subprojects/${encodeURIComponent(id)}/members`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    idempotent: false,
  });
  return readJson<SubprojectMembersResponse>(res, `POST ${url}`);
}

/**
 * `POST /subprojects/{id}/spawn` (`post_subproject_spawn`) — Continue.
 * Returns the RAW `Response`, for the reason `spawnAgent` does: the dialog
 * reads the status AND the unparsed body text to describe a refusal, and a
 * 2xx IS the spawn landing, so it must never fold into a thrown error.
 *
 * At most one request reaches the handler: `idempotent: false` keeps a 5xx
 * from being re-issued (a `504` can arrive after coord placed the session),
 * and `maxRetries: 0` suppresses the 429 arm too — a blind retry could start
 * two sessions.
 */
export function continueSubproject(
  id: string,
  request: SubprojectSpawnRequest
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/subprojects/${encodeURIComponent(id)}/spawn`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      idempotent: false,
      maxRetries: 0,
    }
  );
}
