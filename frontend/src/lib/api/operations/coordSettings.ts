/**
 * `/operations/coord/…` tenant-settings routes: the autonomous next-step
 * settings (and the superuser fleet view of them), the tenant's priority sets,
 * and its composition rules — each a proxy onto coord in
 * `backend/app/api/v1/endpoints/operations/__init__.py`.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 5). Same conventions as `repos.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` — what the
 * `httpClient.get` / `put` / `post` / `patch` / `delete` helpers these calls
 * used to go through threw. `friendlyCoordError` matches coord's refusal codes
 * and ` 403` inside that message, so its shape is load-bearing.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ───────────────────────────── next-step settings ─────────────────────────────

/**
 * Coord's tenant autonomy vocabulary, as it arrives on the wire. The one
 * definition: `policies/policyAutonomyStatus.ts` and the settings page import
 * it from here.
 */
export type AutonomyLevel = "always_escalate" | "guidance_only" | "auto_decide";

/** One decision domain of `NextStepSettings` (coord's next-step settings row). */
export interface NextStepDomain {
  decision_domain: string;
  label: string;
  description: string;
  autonomy_level: AutonomyLevel;
  default_autonomy_level: AutonomyLevel;
  /**
   * Where `default_autonomy_level` came from: `system_row` when coord's
   * system-band policy row resolved (the resolver acts on it, and a tenant or
   * repo row outranks it), `code_fallback` when there is no such row and the
   * level is coord's display constant only. Absent on an older coord.
   */
  default_source?: "system_row" | "code_fallback";
  mode: string;
  resolved_from: "system" | "tenant" | "repo";
  /**
   * Where `autonomy_level` came from. `code_fallback` means NO policy row
   * matched: the level is coord's labelled built-in default, and the real
   * resolver escalates until a row exists. Absent on an older coord.
   */
  autonomy_level_source?: "policy_row" | "code_fallback";
  requires_master: boolean;
  /**
   * The env var NAME this domain's autodispatch is gated by (`null` for a
   * domain with no fleet-arming step). Each master domain has its OWN flag —
   * there is no platform-wide switch. Absent on an older coord.
   */
  master_flag?: string | null;
  /** That flag's actual value. Absent on an older coord. */
  master_flag_enabled?: boolean | null;
  effective: boolean;
  /**
   * coord's three-valued verdict. `effective` is only its `effective` arm, so a
   * domain with an unobserved conjunct (pr_fix) reads `effective: false` even
   * when nothing visible is off — `unknown` is how coord says so.
   */
  effective_state?: "effective" | "not_effective" | "unknown";
  /**
   * For `effective_state: "unknown"` only: coord's own words for the conjunct
   * of the real gate this read cannot see (a per-repo or per-tenant knob).
   * Absent on an older coord.
   */
  effective_unknown_reason?: string | null;
}

/**
 * The body `get_next_step_settings` / `put_next_step_settings` pass through
 * from coord.
 */
export interface NextStepSettings {
  master_enabled: boolean;
  can_edit: boolean;
  domains: NextStepDomain[];
}

/** One domain write of the `put_next_step_settings` body. */
export interface NextStepDomainWrite {
  decision_domain: string;
  autonomy_level: AutonomyLevel;
}

/** One tenant of `NextStepSettingsFleet.tenants`. */
export interface TenantNextStepSetting {
  tenant_id: string;
  slug: string;
  autonomy_level: AutonomyLevel;
  effective: boolean;
  updated_at: string;
}

/** The body `get_next_step_settings_fleet` passes through from coord. */
export interface NextStepSettingsFleet {
  master_enabled: boolean;
  tenants: TenantNextStepSetting[];
}

/**
 * `GET /coord/next-step-settings` (`get_next_step_settings`). `options` are
 * merged over the read's own (a dashboard poll passes
 * `COORD_DASHBOARD_POLL_OPTIONS`: one request, the next poll is the retry).
 */
export async function fetchNextStepSettings(
  options: HttpOptions = {}
): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<NextStepSettings>(res, `GET ${url}`);
}

/**
 * `PUT /coord/next-step-settings` (`put_next_step_settings`) — the changed
 * domains; answers the authoritative new state. Sent ONCE (`maxRetries: 0`):
 * the client's method rule would re-send a PUT on any 5xx, and a caller
 * classifying the failure (`writeOutcome.ts`) reads only the last answer — a
 * first 504 after coord committed, then retries answering the proxy's
 * connect-failure 502, would read as a refusal of a write that landed.
 */
export async function putNextStepSettings(
  domains: NextStepDomainWrite[]
): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ domains }),
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<NextStepSettings>(res, `PUT ${url}`);
}

/**
 * `GET /coord/next-step-settings/fleet` (`get_next_step_settings_fleet`) — the
 * platform master flag plus every tenant with a non-default level. `options`
 * carries the caller's retry budget: the dashboard poll passes
 * `COORD_DASHBOARD_POLL_OPTIONS` (one request; the next tick is the retry).
 */
export async function fetchNextStepSettingsFleet(
  options: HttpOptions = {}
): Promise<NextStepSettingsFleet> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings/fleet`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<NextStepSettingsFleet>(res, `GET ${url}`);
}

// ─────────────────────── priority sets + composition rules ───────────────────────

/** The `create_priority_set` body (v1 uses bare-string ordering). */
export interface CreatePrioritySetInput {
  set_name: string;
  /** null = tenant-wide. */
  repo: string | null;
  ordering: string[];
  non_factors: string[];
}

/**
 * The `update_priority_set` body. Only the changed fields are sent (minimal
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
 * `GET /coord/priority-sets` (`list_priority_sets`). The body is coord's
 * `{priority_sets, total}` envelope, passed through untyped; the caller
 * unwraps it defensively (`unwrapPrioritySets`), so it stays `unknown` here.
 */
export async function fetchPrioritySets(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /coord/composition-rules` (`list_composition_rules`) — coord's
 * `{composition_rules, total}` envelope, unwrapped by the caller.
 */
export async function fetchCompositionRules(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/composition-rules`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `POST /coord/priority-sets` (`create_priority_set`). Never re-sent on a 5xx
 * (`idempotent: false`): a repeat after a lost answer would 409
 * `duplicate_set_name` against the row the first attempt created.
 */
export async function createPrioritySet(
  input: CreatePrioritySetInput
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(input),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `PATCH /coord/priority-sets/:id` (`update_priority_set`). */
export async function updatePrioritySet(
  id: string,
  partial: UpdatePrioritySetInput
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(partial),
    idempotent: false,
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

/**
 * `DELETE /coord/priority-sets/:id` (`delete_priority_set`) — coord's soft
 * delete (disables the set). A 204 resolves `undefined`, as
 * `httpClient.delete` did.
 */
export async function deletePrioritySet(id: string): Promise<unknown> {
  // `idempotent: false` is a no-op here: the client still retries a DELETE
  // on a 5xx by method, exactly as `httpClient.delete` did.
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${encodeURIComponent(id)}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: false,
  });
  if (res.status === 204) return undefined;
  return readJson<unknown>(res, `DELETE ${url}`);
}
