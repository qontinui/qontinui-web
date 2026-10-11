/**
 * `/operations/notifications` — the operator's notification feed and its
 * mark-read write.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Wire types live beside the status logic in
 * `components/admin/coord/notificationStatus`. The caller owns the query
 * string and the retry policy (`options`), since both differ between its
 * timer-driven and click-driven reads.
 */

import type {
  MarkReadResponse,
  MarkReadSelection,
  NotificationsResponse,
} from "@/components/admin/coord/notificationStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** `GET /notifications?<query>` — one page of the feed. */
export async function fetchNotifications(
  query: string,
  options?: HttpOptions
): Promise<NotificationsResponse> {
  const url = `${OPERATIONS_BASE}/notifications?${query}`;
  const res = await httpClient.fetch(url, { ...options, method: "GET" });
  return readJson<NotificationsResponse>(res, `GET ${url}`);
}

/**
 * `POST /notifications/mark-read` — the selection object IS the wire body
 * (`{notification_ids: [...]}` or `{all: true}`).
 */
export async function markNotificationsRead(
  selection: MarkReadSelection,
  options?: HttpOptions
): Promise<MarkReadResponse> {
  const url = `${OPERATIONS_BASE}/notifications/mark-read`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(selection),
  });
  return readJson<MarkReadResponse>(res, `POST ${url}`);
}
