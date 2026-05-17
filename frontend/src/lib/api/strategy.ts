/**
 * Strategy Collaboration API (Phase 1 + 2.3).
 *
 * Proxies to the backend `/api/v1/strategy/*`, which forwards to
 * qontinui-coord behind the service-account bridge. Cookie auth
 * (relative fetch) — same pattern as the other domain api modules.
 *
 * Phase 1: read-only doc proxy
 * Phase 2.3: thread/post/mention CRUD + @mention user lookups
 *
 * Real-time refresh (WS subscriptions) is Phase 2.4 — not wired here.
 */

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
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// --- Phase 1 ---------------------------------------------------------------

export async function listStrategyDocs(): Promise<StrategyDocSummary[]> {
  const res = await fetch("/api/v1/strategy/docs", {
    credentials: "include",
  });
  const body = await unwrap<{ docs: StrategyDocSummary[] }>(res);
  return body.docs;
}

export async function getStrategyDoc(name: string): Promise<StrategyDoc> {
  const res = await fetch(`/api/v1/strategy/docs/${encodeURIComponent(name)}`, {
    credentials: "include",
  });
  return unwrap<StrategyDoc>(res);
}

// --- Phase 2.3 threads + posts --------------------------------------------

export async function listThreads(docName: string): Promise<StrategyThread[]> {
  const res = await fetch(
    `/api/v1/strategy/docs/${encodeURIComponent(docName)}/threads`,
    { credentials: "include" }
  );
  const body = await unwrap<{ threads: StrategyThread[] } | StrategyThread[]>(
    res
  );
  // Coord may return either {threads: [...]} or a bare array; tolerate both.
  return Array.isArray(body) ? body : body.threads;
}

export async function createThread(
  docName: string,
  payload: { title: string; anchor?: string | null; body_markdown: string }
): Promise<StrategyThreadDetail> {
  const res = await fetch(
    `/api/v1/strategy/docs/${encodeURIComponent(docName)}/threads`,
    jsonInit("POST", payload)
  );
  return unwrap<StrategyThreadDetail>(res);
}

export async function getThread(
  threadId: string
): Promise<StrategyThreadDetail> {
  const res = await fetch(
    `/api/v1/strategy/threads/${encodeURIComponent(threadId)}`,
    { credentials: "include" }
  );
  return unwrap<StrategyThreadDetail>(res);
}

export async function createPost(
  threadId: string,
  payload: { body_markdown: string; parent_post_id?: string | null }
): Promise<StrategyPost> {
  const res = await fetch(
    `/api/v1/strategy/threads/${encodeURIComponent(threadId)}/posts`,
    jsonInit("POST", payload)
  );
  return unwrap<StrategyPost>(res);
}

export async function editPost(
  postId: string,
  body_markdown: string
): Promise<StrategyPost> {
  const res = await fetch(
    `/api/v1/strategy/posts/${encodeURIComponent(postId)}`,
    jsonInit("PATCH", { body_markdown })
  );
  return unwrap<StrategyPost>(res);
}

export async function softDeletePost(postId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/strategy/posts/${encodeURIComponent(postId)}`,
    { method: "DELETE", credentials: "include" }
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
  const res = await fetch(
    `/api/v1/strategy/threads/${encodeURIComponent(threadId)}/resolve`,
    jsonInit("POST")
  );
  return unwrap<StrategyThread>(res);
}

// --- Phase 2.3 mentions ---------------------------------------------------

export async function listUnreadMentions(): Promise<StrategyMention[]> {
  const res = await fetch("/api/v1/strategy/mentions/unread", {
    credentials: "include",
  });
  const body = await unwrap<
    { mentions: StrategyMention[] } | StrategyMention[]
  >(res);
  return Array.isArray(body) ? body : body.mentions;
}

export async function markMentionRead(mentionId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/strategy/mentions/${encodeURIComponent(mentionId)}/mark-read`,
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

// --- User directory (web-side, no coord proxy) ----------------------------

export async function searchUsers(
  query: string,
  limit = 10
): Promise<UserSummary[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/v1/users/search?${params.toString()}`, {
    credentials: "include",
  });
  return unwrap<UserSummary[]>(res);
}

export async function lookupUsers(ids: string[]): Promise<UserSummary[]> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return [];
  const params = new URLSearchParams({ ids: unique.join(",") });
  const res = await fetch(`/api/v1/users/lookup?${params.toString()}`, {
    credentials: "include",
  });
  return unwrap<UserSummary[]>(res);
}
