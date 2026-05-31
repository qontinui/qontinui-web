/**
 * Client-side API + types for the UI Bridge co-pilot activity feed
 * (§4.8 of the production-safe plan).
 *
 * Backed by ``GET /api/v1/users/me/co-pilot/activity`` — see
 * ``backend/app/api/v1/endpoints/co_pilot_activity.py``.
 */

import { httpClient } from "@/services/service-factory";

export interface BridgeAuditLogEntry {
  id: string;
  session_id: string | null;
  tab_id: string | null;
  command_name: string;
  target_element_id: string | null;
  path: string;
  method: string;
  origin: string | null;
  status_code: number;
  occurred_at: string;
  payload_summary: Record<string, unknown> | null;
}

export interface BridgeAuditLogListResponse {
  items: BridgeAuditLogEntry[];
  next_before: string | null;
}

export interface CoPilotActivityFilters {
  /** Inclusive lower bound on `occurred_at`. */
  after?: string;
  /** Cursor for "older than" pagination (exclusive). */
  before?: string;
  /** Exact `command_name` filter. */
  command?: string;
  /** Coarse status filter: `success` = HTTP 2xx, `failed` = anything else. */
  status?: "success" | "failed";
  /** Page size (default 100, max 500). */
  limit?: number;
}

/**
 * Fetch a page of the calling user's UI Bridge co-pilot activity feed.
 *
 * Routes through `httpClient.get` so the Bearer auth + 401 refresh +
 * retry behavior matches every other backend call in the app.
 */
export async function fetchCoPilotActivity(
  filters: CoPilotActivityFilters = {},
): Promise<BridgeAuditLogListResponse> {
  const params = new URLSearchParams();
  if (filters.after) params.set("after", filters.after);
  if (filters.before) params.set("before", filters.before);
  if (filters.command) params.set("command", filters.command);
  if (filters.status) params.set("status", filters.status);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const url = `/api/v1/users/me/co-pilot/activity${qs ? `?${qs}` : ""}`;
  return httpClient.get<BridgeAuditLogListResponse>(url);
}
