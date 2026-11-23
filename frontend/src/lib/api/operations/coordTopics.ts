/**
 * `/operations/topics*` — coord's topics: the groups of subprojects that serve
 * one goal, each with a headline rolled up from its confirmed members' cached
 * subproject verdicts.
 *
 * Plan `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8 (pages). Same conventions as `coordSubprojects.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting
 * through {@link readJson} with `<METHOD> <url> failed: <status> - <body>` —
 * the string `httpStatusOf` and `httpBodyOf` read.
 *
 * The wire types are the plan's shared contract (the shapes coord serves,
 * snake_case), proxied VERBATIM by `get_topics` / `get_topic` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. Every field coord may
 * send as `null` is typed so: `null` is UNKNOWN, and the readers in
 * `components/admin/coord/topics/topicStatus.ts` render it as `–` or in words,
 * never as zero.
 *
 * Retry policy: both reads are idempotent GETs carrying the caller's options
 * (the pages poll with `COORD_DASHBOARD_POLL_OPTIONS`, so the next tick is the
 * retry). There are no writes here: the operator write doors exist on coord,
 * but no page calls them yet.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One topic as the list serves it — its cached rollup included. */
export interface TopicSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  /** `proposed | active | dormant | retired`; typed `string` so a newer
   *  coord's word still renders. */
  status: string;
  parent_topic_id: string | null;
  /** The rolled-up headline; `null` when coord has never rolled it up. */
  headline: string | null;
  top_reason: string | null;
  subprojects_total: number | null;
  /** `null` is UNKNOWN, never zero. */
  subprojects_working: number | null;
  /** Confirmed members whose verdict could not be read; `null` is UNKNOWN. */
  unknown_members: number | null;
  last_activity_at: string | null;
  last_rollup_as_of: string | null;
}

/** `GET /topics`. A coord whose migration has not applied answers 503
 *  `schema_migration_pending` instead. */
export interface TopicListResponse {
  as_of: string;
  tables_ready: boolean;
  /** Subprojects no topic holds; `null` when coord did not compute it. */
  unassigned_subprojects: number | null;
  topics: TopicSummary[];
}

/** One piece of evidence for a membership. `ref` is `"could_not_read"` and
 *  `score` `null` when the family could not be read. */
export interface TopicBasisEntry {
  /** `plan_family | pr_edge | gate_chain | files | semantic | declared |
   *  intent` today. */
  signal: string;
  ref: string;
  score: number | null;
  note?: string | null;
}

export interface TopicMember {
  subproject_id: string;
  subproject_title: string | null;
  weight: number | null;
  /** `proposed | confirmed | rejected`. */
  state: string;
  /** `coord | agent | steward | operator`. */
  decided_by: string;
  decided_by_session: string | null;
  basis: TopicBasisEntry[] | null;
  /** The member subproject's cached headline; `null` when unknown. */
  headline: string | null;
}

export interface TopicChild {
  id: string;
  slug: string;
  title: string;
  status: string;
}

export interface TopicHistoryEntry {
  at: string;
  action: string;
  by: string;
  reason: string | null;
}

export interface TopicDetail extends TopicSummary {
  next_steps: string | null;
  intent_ref: Record<string, unknown> | null;
  aliases: string[] | null;
  created_by: string;
  merged_into: string | null;
}

/** `GET /topics/{id}`. */
export interface TopicDetailResponse {
  as_of: string;
  topic: TopicDetail;
  members: TopicMember[] | null;
  children: TopicChild[] | null;
  /** May be `[]` when coord keeps no history for topics. */
  history: TopicHistoryEntry[] | null;
}

/** `GET /topics?<query>` (`get_topics`) — `status` and `limit` only. */
export async function fetchTopics(
  query: URLSearchParams = new URLSearchParams(),
  options: HttpOptions = {}
): Promise<TopicListResponse> {
  let url = `${OPERATIONS_BASE}/topics`;
  const qs = query.toString();
  if (qs) url += `?${qs}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<TopicListResponse>(res, `GET ${url}`);
}

/** `GET /topics/{id}` (`get_topic`). */
export async function fetchTopic(
  id: string,
  options: HttpOptions = {}
): Promise<TopicDetailResponse> {
  const url = `${OPERATIONS_BASE}/topics/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<TopicDetailResponse>(res, `GET ${url}`);
}
