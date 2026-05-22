/**
 * Strategy Collaboration API (Phase 1 + 2.3).
 *
 * Proxies to the backend `/api/v1/strategy/*`, which forwards to
 * qontinui-coord behind the service-account bridge. Goes through
 * httpClient.fetch so Authorization: Bearer is attached in remote/staging
 * mode (cross-origin cookies don't work there) while local cookie auth
 * keeps working.
 *
 * Phase 1: read-only doc proxy
 * Phase 2.3: thread/post/mention CRUD + @mention user lookups
 *
 * Real-time refresh (WS subscriptions) is Phase 2.4 — not wired here.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1`;

export interface StrategyProvenance {
  commit_sha: string;
  committed_at: string;
  author: string;
}

export interface StrategyDocSummary {
  name: string;
  title: string;
  provenance: StrategyProvenance;
}

export interface StrategyDoc extends StrategyDocSummary {
  content: string;
}

export interface StrategyThread {
  thread_id: string;
  doc_id: string;
  title: string;
  anchor: string | null;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  post_count?: number;
}

export interface StrategyPost {
  post_id: string;
  thread_id: string;
  parent_post_id: string | null;
  author_id: string;
  body_markdown: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface StrategyThreadDetail {
  thread: StrategyThread;
  posts: StrategyPost[];
}

export interface StrategyMention {
  mention_id: string;
  post_id: string;
  thread_id: string;
  mentioned_user_id: string;
  read_at: string | null;
  created_at: string;
  // Optional enrichment from coord — author of the post + thread title
  // for the notification dropdown UX. Tolerated as undefined.
  author_id?: string;
  thread_title?: string;
}

export interface UserSummary {
  id: string;
  display: string;
  email: string;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body.detail || body.error || detail;
    } catch {
      /* non-JSON body — keep the status-based message */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

// --- Phase 1 ---------------------------------------------------------------

export async function listStrategyDocs(): Promise<StrategyDocSummary[]> {
  const res = await httpClient.fetch(`${API}/strategy/docs`);
  const body = await unwrap<{ docs: StrategyDocSummary[] }>(res);
  return body.docs;
}

export async function getStrategyDoc(name: string): Promise<StrategyDoc> {
  const res = await httpClient.fetch(
    `${API}/strategy/docs/${encodeURIComponent(name)}`
  );
  return unwrap<StrategyDoc>(res);
}

// --- Phase 2.3 threads + posts --------------------------------------------

export async function listThreads(docName: string): Promise<StrategyThread[]> {
  const res = await httpClient.fetch(
    `${API}/strategy/docs/${encodeURIComponent(docName)}/threads`
  );
  const body = await unwrap<
    | { items: StrategyThread[] }
    | { threads: StrategyThread[] }
    | StrategyThread[]
  >(res);
  // Coord (Phase 2.2 `list_threads`) returns
  // `{items: [...], next_before: ...}` — see `proj_strategy_phase_2_endpoints`
  // memory + `qontinui-coord/src/strategy_threads.rs`. The legacy
  // `{threads:[...]}` and bare-array shapes are tolerated for any
  // older mock or proxy setups, but `items` is the live contract.
  if (Array.isArray(body)) return body;
  if ("items" in body) return body.items;
  return body.threads;
}

export async function createThread(
  docName: string,
  payload: { title: string; anchor?: string | null; body_markdown: string }
): Promise<StrategyThreadDetail> {
  const res = await httpClient.fetch(
    `${API}/strategy/docs/${encodeURIComponent(docName)}/threads`,
    jsonInit("POST", payload)
  );
  return unwrap<StrategyThreadDetail>(res);
}

export async function getThread(
  threadId: string
): Promise<StrategyThreadDetail> {
  const res = await httpClient.fetch(
    `${API}/strategy/threads/${encodeURIComponent(threadId)}`
  );
  return unwrap<StrategyThreadDetail>(res);
}

export async function createPost(
  threadId: string,
  payload: { body_markdown: string; parent_post_id?: string | null }
): Promise<StrategyPost> {
  const res = await httpClient.fetch(
    `${API}/strategy/threads/${encodeURIComponent(threadId)}/posts`,
    jsonInit("POST", payload)
  );
  return unwrap<StrategyPost>(res);
}

export async function editPost(
  postId: string,
  body_markdown: string
): Promise<StrategyPost> {
  const res = await httpClient.fetch(
    `${API}/strategy/posts/${encodeURIComponent(postId)}`,
    jsonInit("PATCH", { body_markdown })
  );
  return unwrap<StrategyPost>(res);
}

export async function softDeletePost(postId: string): Promise<void> {
  const res = await httpClient.fetch(
    `${API}/strategy/posts/${encodeURIComponent(postId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      detail = j.detail || j.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
}

export async function resolveThread(threadId: string): Promise<StrategyThread> {
  const res = await httpClient.fetch(
    `${API}/strategy/threads/${encodeURIComponent(threadId)}/resolve`,
    jsonInit("POST")
  );
  return unwrap<StrategyThread>(res);
}

// --- Phase 2.3 mentions ---------------------------------------------------

export async function listUnreadMentions(): Promise<StrategyMention[]> {
  const res = await httpClient.fetch(`${API}/strategy/mentions/unread`);
  const body = await unwrap<
    | { items: StrategyMention[] }
    | { mentions: StrategyMention[] }
    | StrategyMention[]
  >(res);
  // Coord (Phase 2.2 `list_unread_mentions`) returns `{items: [...]}`.
  // Legacy shapes kept as fallbacks.
  if (Array.isArray(body)) return body;
  if ("items" in body) return body.items;
  return body.mentions;
}

export async function markMentionRead(mentionId: string): Promise<void> {
  const res = await httpClient.fetch(
    `${API}/strategy/mentions/${encodeURIComponent(mentionId)}/mark-read`,
    jsonInit("POST")
  );
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      detail = j.detail || j.error || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
}

/**
 * Phase 2.5 — bulk-clear every unread mention the current user has on
 * a single post. Used by the doc-visit deep-link
 * (`/strategy/<doc>?post=<post_id>`) so opening the mentioning post
 * clears all your badges for it in one round-trip.
 *
 * Returns the server-reported `marked_read` count so callers can skip
 * cache invalidation when nothing changed (the page-visit case is
 * naturally idempotent).
 */
export async function markPostMentionsRead(postId: string): Promise<number> {
  const res = await httpClient.fetch(
    `${API}/strategy/posts/${encodeURIComponent(postId)}/mentions/mark-read`,
    jsonInit("POST")
  );
  const body = await unwrap<{ post_id: string; marked_read: number }>(res);
  return body.marked_read ?? 0;
}

// --- User directory (web-side, no coord proxy) ----------------------------

export async function searchUsers(
  query: string,
  limit = 10
): Promise<UserSummary[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await httpClient.fetch(`${API}/users/search?${params.toString()}`);
  return unwrap<UserSummary[]>(res);
}

export async function lookupUsers(ids: string[]): Promise<UserSummary[]> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return [];
  const params = new URLSearchParams({ ids: unique.join(",") });
  const res = await httpClient.fetch(`${API}/users/lookup?${params.toString()}`);
  return unwrap<UserSummary[]>(res);
}
