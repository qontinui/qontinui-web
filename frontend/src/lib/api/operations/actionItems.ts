/**
 * `/operations/action-items` — the operator's owed to-dos (one keyset page
 * plus the per-status `counts`) and the resolve write.
 *
 * Plan `2026-10-12-operator-action-items-pushed-to-the-phone` Phase 3. Same
 * conventions as `notifications.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `<METHOD> <url> failed: <status> - <body>` so `isMigrationPending` and
 * `operationsErrorReading` read a rejection the same way everywhere.
 *
 * Handlers: `get_coord_operator_action_items` and
 * `post_coord_operator_action_items_resolve` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`. The envelope types
 * live in `components/admin/coord/actionItemStatus.ts`.
 */

import type {
  ActionItemResolution,
  ActionItemsResponse,
  ResolveActionItemResponse,
} from "@/components/admin/coord/actionItemStatus";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** The query `GET /action-items` honours. Absent keys are omitted, never sent empty. */
export interface ActionItemsQuery {
  /** `open` | `done` | `dismissed` | `all`; coord defaults to `open`. */
  status?: "open" | "done" | "dismissed" | "all";
  /** Page size asked of coord. Coord owns the clamp (1..200). */
  limit?: number;
  /** Only ever a `next_cursor` coord minted for THIS query. */
  cursor?: string | null;
  /** Return at most this one item, any status. */
  itemId?: string;
}

/** `GET /action-items` (handler `get_coord_operator_action_items`). */
export async function fetchActionItems(
  query: ActionItemsQuery,
  options: HttpOptions = {}
): Promise<ActionItemsResponse> {
  const qs = new URLSearchParams();
  if (query.status) qs.set("status", query.status);
  if (query.limit != null) qs.set("limit", String(query.limit));
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.itemId) qs.set("item_id", query.itemId);
  const search = qs.toString();
  const url = `${OPERATIONS_BASE}/action-items${search ? `?${search}` : ""}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ActionItemsResponse>(res, `GET ${url}`);
}

/**
 * `POST /action-items/resolve` (handler
 * `post_coord_operator_action_items_resolve`). `idempotent: false`: a 5xx is
 * not re-sent from here (coord is idempotent for the same status, but the
 * button's caller decides whether to try again).
 */
export async function resolveActionItem(
  itemId: string,
  status: ActionItemResolution,
  note?: string,
  options: HttpOptions = {}
): Promise<ResolveActionItemResponse> {
  const url = `${OPERATIONS_BASE}/action-items/resolve`;
  const body: { item_id: string; status: ActionItemResolution; note?: string } =
    { item_id: itemId, status };
  if (note) body.note = note;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<ResolveActionItemResponse>(res, `POST ${url}`);
}
