/**
 * `/operations` reads and writes behind the Coordination settings page: the
 * tenant `auto_fix_pr` dial (on the pr-merge settings route), the per-tenant
 * "autonomous next-step" settings, and the priority sets + composition rules.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` with its URL inline and returns the PARSED body
 * through `readJson`; a non-2xx rejects with `<METHOD> <url> failed: <status> -
 * <body>`, the shape the settings hooks' error mappers already read.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ---- pr-merge settings: the `auto_fix_pr` dial -----------------------------

/**
 * The envelope of `GET` / `PATCH /pr-merge/settings`, with the profile left
 * `unknown`: the dial's reader (`readAutoFixPr`) decides whether the coord
 * build serves the fields at all.
 */
export interface AutoFixPrSettingsResponse {
  tenant_id: string;
  profile: unknown;
}

/** `GET /pr-merge/settings` — `get_pr_merge_settings`, read for the dial. */
export async function fetchAutoFixPrSettings(): Promise<AutoFixPrSettingsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<AutoFixPrSettingsResponse>(res, `GET ${url}`);
}

/**
 * `PATCH /pr-merge/settings` with only `{auto_fix_pr}` — `patch_pr_merge_settings`.
 * Resolves coord's echo, which the caller reads back to confirm the write.
 * Not re-sent on a 5xx (`idempotent: false`).
 */
export async function patchAutoFixPr(
  autoFixPr: unknown
): Promise<AutoFixPrSettingsResponse> {
  const url = `${OPERATIONS_BASE}/pr-merge/settings`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ auto_fix_pr: autoFixPr }),
    idempotent: false,
  });
  return readJson<AutoFixPrSettingsResponse>(res, `PATCH ${url}`);
}

// ---- Next-step autonomy settings -------------------------------------------

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

export interface NextStepSettings {
  master_enabled: boolean;
  can_edit: boolean;
  domains: NextStepDomain[];
}

/** One domain write of `PUT /coord/next-step-settings`. */
export interface NextStepDomainWrite {
  decision_domain: string;
  autonomy_level: AutonomyLevel;
}

/** `GET /coord/next-step-settings` — the caller's per-coord-tenant settings. */
export async function fetchNextStepSettings(): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<NextStepSettings>(res, `GET ${url}`);
}

/**
 * `PUT /coord/next-step-settings` — writes the changed domains and resolves the
 * authoritative new state, which re-seeds the form.
 */
export async function putNextStepSettings(
  domains: NextStepDomainWrite[]
): Promise<NextStepSettings> {
  const url = `${OPERATIONS_BASE}/coord/next-step-settings`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ domains }),
  });
  return readJson<NextStepSettings>(res, `PUT ${url}`);
}

// ---- Priority sets + composition rules --------------------------------------

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
 * `GET /coord/priority-sets`. Resolves `unknown`: coord returns a
 * `{priority_sets, total}` envelope (or a bare list), unwrapped defensively by
 * `unwrapPrioritySets`.
 */
export async function fetchPrioritySets(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `GET /coord/composition-rules`. Resolves `unknown`: a
 * `{composition_rules, total}` envelope (or a bare list), unwrapped by
 * `unwrapCompositionRules`.
 */
export async function fetchCompositionRules(): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/composition-rules`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `POST /coord/priority-sets` — creates a tenant priority set. */
export async function createPrioritySet(
  input: CreatePrioritySetInput
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return readJson<unknown>(res, `POST ${url}`);
}

/** `PATCH /coord/priority-sets/{id}` — edits the changed fields of one set. */
export async function updatePrioritySet(
  id: string,
  partial: UpdatePrioritySetInput
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${id}`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify(partial),
  });
  return readJson<unknown>(res, `PATCH ${url}`);
}

/** `DELETE /coord/priority-sets/{id}` — soft-deletes (disables) one set. */
export async function deletePrioritySet(id: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/priority-sets/${id}`;
  const res = await httpClient.fetch(url, { method: "DELETE" });
  // A DELETE may answer 204 No Content.
  if (res.status === 204) return undefined;
  return readJson<unknown>(res, `DELETE ${url}`);
}
