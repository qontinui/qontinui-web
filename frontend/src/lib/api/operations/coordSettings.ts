/**
 * The tenant/operator settings routes under `/operations`: the autonomous
 * next-step settings (own tenant and fleet), tenant priority sets and
 * composition rules, the tenant policy flags (transcript sync, automatic
 * resume), the fleet-wide unfinished-sessions read and its row actions, the
 * operator audit feed, and the per-repo follow-up dials (post-merge scope and
 * continuation-delivery mode).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline, states its retry policy, and returns
 * the PARSED body through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`; a caller reads the status with
 * `httpStatusOf` and the operator sentence with `operationsErrorMessage`.
 *
 * Each name below mirrors the web-backend proxy handler in
 * `backend/app/api/v1/endpoints/operations/__init__.py` (or
 * `repo_followup_dials.py` for the follow-up dials) it calls.
 */

import type {
  ContinuationDeliveryModeView,
  ContinuationDeliveryModeWriteResult,
  DeliveryMode,
  FollowupScope,
  PostMergeFollowupScopeView,
  PostMergeFollowupScopeWriteResult,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import type { AutonomyLevel as FleetAutonomyLevel } from "@/app/(app)/admin/coord/policies/policyAutonomyStatus";
import type {
  TranscriptSyncView,
  TranscriptSyncWriteResult,
} from "@/app/(app)/admin/coord/tenant-policy/types";
import type {
  ResumeUnfinishedView,
  ResumeUnfinishedWriteResult,
  UnfinishedSessionsView,
} from "@/app/(app)/admin/coord/unfinished/types";
import type { PrioritySetRow } from "@/app/(app)/settings/coordination/_hooks/priority-set-delivery";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ── next-step settings ──────────────────────────────────────────────────────

export type AutonomyLevel = "always_escalate" | "guidance_only" | "auto_decide";

export interface NextStepDomain {
  decision_domain: string;
  label: string;
  description: string;
  autonomy_level: AutonomyLevel;
  default_autonomy_level: AutonomyLevel;
  mode: string;
  resolved_from: "system" | "tenant" | "repo";
  /**
   * Where `autonomy_level` came from. `code_fallback` means NO policy row
   * matched: the level is coord's labelled built-in default, and the real
   * resolver escalates until a row exists. Absent on an older coord.
   */
  autonomy_level_source?: "policy_row" | "code_fallback";
  requires_master: boolean;
  effective: boolean;
  /**
   * coord's three-valued verdict. `effective` is only its `effective` arm, so a
   * domain with an unobserved conjunct (pr_fix) reads `effective: false` even
   * when nothing visible is off — `unknown` is how coord says so.
   */
  effective_state?: "effective" | "not_effective" | "unknown";
}

/** `GET` / `PUT /coord/next-step-settings` — the caller's per-coord-tenant settings. */
export interface NextStepSettings {
  master_enabled: boolean;
  can_edit: boolean;
  domains: NextStepDomain[];
}

/** One domain a `PUT /coord/next-step-settings` save writes. */
export interface NextStepDomainWrite {
  decision_domain: string;
  autonomy_level: AutonomyLevel;
}

/** One tenant's row of the fleet read. */
export interface TenantPolicySetting {
  tenant_id: string;
  slug: string;
  autonomy_level: FleetAutonomyLevel;
  effective: boolean;
  updated_at: string;
}

/** `GET /coord/next-step-settings/fleet`. */
export interface FleetResponse {
  master_enabled: boolean;
  tenants: TenantPolicySetting[];
}

/** `GET /coord/next-step-settings` — loads the caller's settings. */
export async function fetchNextStepSettings(): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<NextStepSettings>(res, `GET ${url}`);
}

/**
 * `PUT /coord/next-step-settings` — writes the changed domains; the answer is
 * the authoritative new state, which re-seeds the form.
 */
export async function putNextStepSettings(
  domains: NextStepDomainWrite[]
): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ domains }),
    idempotent: true,
  });
  return readJson<NextStepSettings>(res, `PUT ${url}`);
}

/**
 * `GET /coord/next-step-settings/fleet` — every tenant's chosen level.
 * `options` carries the caller's retry budget: the dashboard poll passes
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request; the next tick is the retry).
 */
export async function fetchNextStepSettingsFleet(
  options: HttpOptions = {}
): Promise<FleetResponse> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings/fleet`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<FleetResponse>(res, `GET ${url}`);
}

// ── priority sets and composition rules ─────────────────────────────────────

/** Payload for creating a tenant priority set (v1 uses bare-string ordering). */
export interface CreatePrioritySetInput {
  set_name: string;
  /** null = tenant-wide. */
  repo: string | null;
  ordering: string[];
  non_factors: string[];
}

/**
 * Partial payload for a PATCH edit. Only the changed fields are sent (minimal
 * diff computed by the caller). `ordering` is v1 bare-string only — an edit
 * writes back bare strings even if the row's wire ordering was object-shaped
 * (`{name, weight}`), the same simplification as create.
 */
export interface UpdatePrioritySetInput {
  set_name?: string;
  /** null = tenant-wide. */
  repo?: string | null;
  ordering?: string[];
  non_factors?: string[];
  enabled?: boolean;
}

/**
 * `GET /coord/priority-sets` — an envelope (`{priority_sets, total}`) or a
 * bare list; the caller unwraps defensively (see `priority-set-delivery.ts`),
 * so the body is `unknown` here.
 */
export async function fetchPrioritySets(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /coord/composition-rules` — as {@link fetchPrioritySets}, `unknown` for the same reason. */
export async function fetchCompositionRules(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/composition-rules`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `POST /coord/priority-sets` — never re-sent on a 5xx. */
export async function createPrioritySet(
  input: CreatePrioritySetInput
): Promise<PrioritySetRow | null> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(input),
    idempotent: false,
  });
  return readJson<PrioritySetRow>(res, `POST ${url}`, { unparseable: "null" });
}

/** `PATCH /coord/priority-sets/:id` — the minimal diff. Never re-sent on a 5xx. */
export async function updatePrioritySet(
  id: string,
  partial: UpdatePrioritySetInput
): Promise<PrioritySetRow | null> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(partial),
    idempotent: false,
  });
  return readJson<PrioritySetRow>(res, `PATCH ${url}`, { unparseable: "null" });
}

/** `DELETE /coord/priority-sets/:id` — a soft delete ("disable"; may answer 204). */
export async function deletePrioritySet(id: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}

// ── tenant policy flags ─────────────────────────────────────────────────────

/** `GET /tenant-policy/transcript-sync` — the tenant's transcript-sync consent. */
export async function fetchTranscriptSync(): Promise<TranscriptSyncView> {
  const url = `${OPERATIONS_BASE}/tenant-policy/transcript-sync`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<TranscriptSyncView>(res, `GET ${url}`);
}

/**
 * `PATCH /tenant-policy/transcript-sync` — write the flag; the answer carries
 * coord's own post-write re-read. Not re-sent on a 5xx (`idempotent: false`):
 * the caller treats a `504` as UNKNOWN, not failed, and a blind repeat would
 * hide that.
 */
export async function patchTranscriptSync(
  enabled: boolean
): Promise<TranscriptSyncWriteResult> {
  const url = `${OPERATIONS_BASE}/tenant-policy/transcript-sync`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ transcript_sync_enabled: enabled }),
    idempotent: false,
  });
  return readJson<TranscriptSyncWriteResult>(res, `PATCH ${url}`);
}

/** `GET /tenant-policy/resume-unfinished` — the tenant's automatic-resume flag. */
export async function fetchResumeUnfinished(): Promise<ResumeUnfinishedView> {
  const url = `${OPERATIONS_BASE}/tenant-policy/resume-unfinished`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ResumeUnfinishedView>(res, `GET ${url}`);
}

/** `PATCH /tenant-policy/resume-unfinished` — as {@link patchTranscriptSync}. */
export async function patchResumeUnfinished(
  enabled: boolean
): Promise<ResumeUnfinishedWriteResult> {
  const url = `${OPERATIONS_BASE}/tenant-policy/resume-unfinished`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ resume_unfinished_enabled: enabled }),
    idempotent: false,
  });
  return readJson<ResumeUnfinishedWriteResult>(res, `PATCH ${url}`);
}

// ── unfinished sessions ─────────────────────────────────────────────────────

/** `GET /unfinished-sessions` — the fleet-wide read (`state: "unknown"` carries `sessions: null`). */
export async function fetchUnfinishedSessions(): Promise<UnfinishedSessionsView> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<UnfinishedSessionsView>(res, `GET ${url}`);
}

/** `POST /unfinished-sessions/:claude_session_id/dismiss` — mark the session finished. */
export async function dismissUnfinishedSession(
  claudeSessionId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions/${encodeURIComponent(claudeSessionId)}/dismiss`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /unfinished-sessions/:coord_session_id/resume` — ask the device to
 * resume under `account`. Never re-sent on a 5xx: a repeat could request a
 * second resume.
 */
export async function resumeUnfinishedSession(
  coordSessionId: string,
  body: { target_device_id: string | null; account: string }
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions/${encodeURIComponent(coordSessionId)}/resume`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

// ── operator audit ──────────────────────────────────────────────────────────

/** The query of `GET /coord/audit/recent`. */
export interface OperatorAuditQuery {
  limit: number;
  action?: string;
  via?: string;
  resource_key?: string;
}

/**
 * `GET /coord/audit/recent?limit=&action=&via=&resource_key=` — the recent
 * operator-audit rows. The body is `unknown`: `parseAuditPayload` validates it.
 */
export async function fetchOperatorAudit(
  query: OperatorAuditQuery
): Promise<unknown> {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.action) params.set("action", query.action);
  if (query.via) params.set("via", query.via);
  if (query.resource_key) params.set("resource_key", query.resource_key);
  const url = `${OPERATIONS_BASE}/coord/audit/recent?${params.toString()}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

// ── per-repo follow-up dials ────────────────────────────────────────────────

/** The body of `PUT /post-merge-followup-scope`. */
export interface PostMergeFollowupScopeBody {
  repo: string;
  scope: FollowupScope;
  code_paths?: string[];
}

/** `GET /post-merge-followup-scope?repo=` — the repo's scope and the fleet rollout mode. */
export async function fetchPostMergeFollowupScope(
  repo: string
): Promise<PostMergeFollowupScopeView> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<PostMergeFollowupScopeView>(res, `GET ${url}`);
}

/** `PUT /post-merge-followup-scope` — write the scope; the answer carries a fresh read-back. */
export async function putPostMergeFollowupScope(
  body: PostMergeFollowupScopeBody
): Promise<PostMergeFollowupScopeWriteResult> {
  const url = `${OPERATIONS_BASE}/post-merge-followup-scope`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
    idempotent: true,
  });
  return readJson<PostMergeFollowupScopeWriteResult>(res, `PUT ${url}`);
}

/** `GET /continuation-delivery-mode?repo=` — how work is delivered back to an author session. */
export async function fetchContinuationDeliveryMode(
  repo: string
): Promise<ContinuationDeliveryModeView> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode?repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ContinuationDeliveryModeView>(res, `GET ${url}`);
}

/** `PUT /continuation-delivery-mode` — write the mode; the answer carries a fresh read-back. */
export async function putContinuationDeliveryMode(
  repo: string,
  mode: DeliveryMode
): Promise<ContinuationDeliveryModeWriteResult> {
  const url = `${OPERATIONS_BASE}/continuation-delivery-mode`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ repo, mode }),
    idempotent: true,
  });
  return readJson<ContinuationDeliveryModeWriteResult>(res, `PUT ${url}`);
}
