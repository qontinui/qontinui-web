// ============================================================================
// Prompt-injection audit-log API client
//
// Typed fetch wrappers for the admin prompt-injections surface
// (`/api/v1/admin/prompt-injections*`) — the web backend's proxy over coord's
// `GET /coord/prompt-injections` list + `GET /coord/prompt-injections/:id`
// detail (Phase 4 of the "Unified Coord Prompt-Injection Audit Log" plan).
// Shapes mirror the coord wire contract exactly; the web backend proxies
// coord's JSON verbatim.
//
// Same conventions as `agent-sessions-api.ts`: requests go through the shared
// `httpClient` (Bearer token, 401-refresh, 429/5xx retry) and errors carry the
// HTTP status so callers can branch on 404 (detail: not-found).
// ============================================================================

import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";

/** Base URL for the admin prompt-injections surface. */
export const PROMPT_INJECTIONS_API = `${ApiConfig.API_BASE_URL}/api/v1/admin/prompt-injections`;

// ---------------------------------------------------------------------------
// Wire shapes — mirror the coord wire contract exactly.
// ---------------------------------------------------------------------------

/** The `source` vocabulary — the six coord injection origins. */
export type PromptInjectionSource =
  | "question_auto_answer"
  | "regex_submit_prompt"
  | "regex_resolve_scoring"
  | "session_bus_message"
  | "continuation_dispatch"
  | "spawned_session_initial";

/** One row from `GET /api/v1/admin/prompt-injections`. */
export interface PromptInjectionRow {
  event_id: string;
  source: PromptInjectionSource | string;
  session_name: string | null;
  agent_session_id: string | null;
  terminal_id: string | null;
  agent_id: string | null;
  device_id: string | null;
  trigger_kind: string;
  trigger_preview: string | null;
  injected_preview: string;
  truncated: boolean;
  policy_id: string | null;
  rule_id: string | null;
  created_at: string;
}

export interface PromptInjectionsListResponse {
  events: PromptInjectionRow[];
  count: number;
}

/**
 * Full event from `GET /api/v1/admin/prompt-injections/{event_id}` — the lazy
 * detail expand. Carries the FULL trigger output (`trigger_text`) and injected
 * prompt (`injected_prompt`).
 */
export interface PromptInjectionDetail {
  event_id: string;
  tenant_id: string | null;
  source: PromptInjectionSource | string;
  agent_session_id: string | null;
  session_name: string | null;
  terminal_id: string | null;
  agent_id: string | null;
  device_id: string | null;
  trigger_kind: string;
  /** The FULL output that triggered the injection. */
  trigger_text: string | null;
  /** The FULL prompt that was injected. */
  injected_prompt: string;
  policy_id: string | null;
  rule_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Error handling — mirrors AgentSessionsApiError (status-carrying Error).
// ---------------------------------------------------------------------------

export class PromptInjectionsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PromptInjectionsApiError";
    this.status = status;
  }
}

async function parseError(res: Response): Promise<PromptInjectionsApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) {
      message = body.detail;
    }
  } catch {
    // Non-JSON body — keep the status-based default message.
  }
  return new PromptInjectionsApiError(res.status, message);
}

async function request<T>(path: string): Promise<T> {
  const res = await httpClient.fetch(`${PROMPT_INJECTIONS_API}${path}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ListPromptInjectionsParams {
  limit?: number;
  source?: PromptInjectionSource | string;
  session_name?: string;
  agent_session_id?: string;
  since?: string;
}

export function listPromptInjections(
  params: ListPromptInjectionsParams = {}
): Promise<PromptInjectionsListResponse> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.source) search.set("source", params.source);
  if (params.session_name) search.set("session_name", params.session_name);
  if (params.agent_session_id)
    search.set("agent_session_id", params.agent_session_id);
  if (params.since) search.set("since", params.since);
  const qs = search.toString();
  return request<PromptInjectionsListResponse>(qs ? `?${qs}` : "");
}

/** Fetch the full event detail. Throws status 404 on not-found. */
export function getPromptInjection(
  eventId: string
): Promise<PromptInjectionDetail> {
  return request<PromptInjectionDetail>(`/${encodeURIComponent(eventId)}`);
}
