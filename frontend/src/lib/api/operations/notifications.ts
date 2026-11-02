/**
 * `/operations/notifications` — coord's per-principal notification feed (one
 * keyset page plus the `total` / `unread_count` scalars) and the mark-read
 * write.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 9). Same conventions as `coordMembers.ts`: `httpClient.fetch`
 * on the RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated,
 * and a non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` —
 * the string `httpClient.get` / `post` threw before, so `isMigrationPending`
 * and the pages' error lines read a rejection exactly as they did.
 *
 * Handlers: `get_coord_notifications` and `post_coord_notifications_mark_read`
 * in `backend/app/api/v1/endpoints/operations/__init__.py`. The envelope and
 * selection types are owned by `components/admin/coord/notificationStatus.ts`,
 * which every reader of them already imports, and are not redeclared here.
 *
 * The retry budget is the caller's: the pollers pass
 * `NOTIFICATIONS_REQUEST_OPTIONS` (503 opted out of the 5xx chain) and the
 * mark-read button `NOTIFICATIONS_MARK_READ_OPTIONS` (429 and 503 opted out).
 */

import type {
  MarkReadResponse,
  MarkReadSelection,
  NotificationsResponse,
} from "@/components/admin/coord/notificationStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * The query `GET /notifications` honours. Keys are sent in this order and an
 * absent (or false) one is omitted, never sent empty.
 */
export interface NotificationsQuery {
  /** Page size asked of coord. Coord owns the clamp; this is a request. */
  limit: number;
  /** A notification kind; absent for any kind. */
  kind?: string;
  /** `unread_only=true` when set. */
  unreadOnly?: boolean;
  /** `detail.via` filter, e.g. `agent_evidence` for agent clearances. */
  via?: string;
  /** Only ever a `next_cursor` coord minted for THIS query. */
  cursor?: string | null;
}

/** `GET /notifications` (handler `get_coord_notifications`) — one page of the feed. */
export async function fetchNotifications(
  query: NotificationsQuery,
  options: HttpOptions = {}
): Promise<NotificationsResponse> {
  const qs = new URLSearchParams();
  qs.set("limit", String(query.limit));
  if (query.kind) qs.set("kind", query.kind);
  if (query.unreadOnly) qs.set("unread_only", "true");
  if (query.via) qs.set("via", query.via);
  if (query.cursor) qs.set("cursor", query.cursor);
  const url = `${OPERATIONS_BASE}/notifications?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<NotificationsResponse>(res, `GET ${url}`);
}

/**
 * `POST /notifications/mark-read` (handler `post_coord_notifications_mark_read`).
 *
 * The selection object IS the wire body — `{notification_ids: [...]}` or
 * `{all: true}`. `idempotent: false`, the method's own rule: a 5xx is not
 * re-sent. The answer is read (its `unread_count` is a delivery of the
 * badge scalar), so an unparseable 2xx rejects as it did before.
 */
export async function markNotificationsRead(
  selection: MarkReadSelection,
  options: HttpOptions = {}
): Promise<MarkReadResponse> {
  const url = `${OPERATIONS_BASE}/notifications/mark-read`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(selection),
    idempotent: false,
  });
  return readJson<MarkReadResponse>(res, `POST ${url}`);
}
