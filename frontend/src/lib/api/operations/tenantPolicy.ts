/**
 * Tenant-band policy routes: coord's fleet-policy dials (`/fleet-policy`). The
 * transcript-sync consent flag (`/tenant-policy/transcript-sync`) is gone:
 * transcript sync is the `egress_transcript_sync` fleet-policy domain (plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 8).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 5). Same conventions as `repos.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>` — what the
 * `httpClient.get` / `put` / `patch` helpers these calls used to go through
 * threw. Callers read refusal codes and the `failed: 504` lost-answer arm out
 * of that message, so its shape is load-bearing.
 *
 * The wire types moved here from `admin/coord/_shared/fleetPolicy.ts` and
 * `admin/coord/tenant-policy/types.ts`; each names the backend model it
 * mirrors in `backend/app/api/v1/endpoints/operations/__init__.py`.
 *
 * **The distinction the fleet-policy types exist to protect:**
 * `resolved_scope` separates "off because nobody ever wrote a row" (`"none"`)
 * from "off because someone turned it off" (a real band). Coord folds
 * `master_enabled` into `effective_level`, so both render as the string
 * `"off"` — and a consumer that cannot tell them apart cannot implement a code
 * default without also overriding an operator's explicit decision.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

// ───────────────────────────────── fleet policy ─────────────────────────────────

/**
 * Mirrors `FleetPolicyRepoOverride`: one repo-band row that overrides the
 * tenant band for its repo (coord's `repo_overrides` entry).
 */
export interface FleetPolicyRepoOverride {
  /** The row's key as coord stored it — `owner/name` for the domains keyed that way. */
  repo: string;
  /** The level the row carries. Opaque: a level a page does not know is the page's to name. */
  level: string;
  master_enabled: boolean;
  /** What a reader of that repo resolves from the row: `level`, or `off` under a disabled master. */
  effective_level: string;
}

/** Mirrors `FleetPolicyView` (`get_fleet_policy`, proxying coord's `GET /coord/fleet-policy`). */
export interface FleetPolicyView {
  domain: string;
  /** What devices ACTUALLY resolve — not necessarily what was last written. */
  effective_level: string;
  master_enabled: boolean;
  /** `"repo" | "tenant" | "system"`, or `"none"` when NO row matched. */
  resolved_scope: string;
  /**
   * Whether the caller may write, computed with the SAME effective-tenant rule
   * the PUT is gated on — not coord's cross-tenant `is_admin` union. Gating a
   * write button on `is_admin` lights it for an operator the write is about to
   * 403.
   */
  can_edit: boolean;
  /**
   * Control blocks coord returned that this view does not carry. Named rather
   * than silently dropped, so a reader who wonders where `controls` went gets
   * an answer.
   */
  keys_not_shown: string[];
  /**
   * `"fleet_resources_row"` — those blocks are a DIFFERENT domain's data and
   * must never be read as this domain's. `"this_domain"` — the caller asked
   * about `fleet_resources` itself. `null` — coord sent none.
   */
  keys_not_shown_source: "fleet_resources_row" | "this_domain" | null;
  /**
   * Every repo-band row of this domain that overrides the tenant band, ordered
   * by repo; an `inherit` row clears an override and is not listed. Absent or
   * `null` is UNKNOWN — the coord answering sends no list, or sent one the
   * backend could not read whole — never "no overrides".
   */
  repo_overrides?: FleetPolicyRepoOverride[] | null;
  /**
   * Where a NO-ROW answer's level came from: `"deployment_profile"` (a
   * self-hosted coord's egress default) or `"product"` (the product's own
   * default). `null` when a row decided, or when coord predates the field —
   * absent is UNKNOWN, never a guessed source. Optional because a backend that
   * predates the field omits it.
   */
  default_source?: string | null;
}

/** Mirrors `FleetPolicyWriteResult` (`put_fleet_policy`). */
export interface FleetPolicyWriteResult {
  ok: boolean;
  domain: string;
  written_level: string | null;
  written_master_enabled: boolean | null;
  versioned: boolean | null;
  version: number | null;
  updated_by: string | null;
  /** A SECOND, fresh read. `null` + `readback_error` = UNKNOWN, not "applied". */
  effective: FleetPolicyView | null;
  readback_error: string | null;
}

/** The `put_fleet_policy` request body, as the console's dials send it. */
export interface FleetPolicyWrite {
  domain: string;
  scope_band: "tenant" | "repo";
  /** `null` at the tenant band; the repo slug (`owner/name`) at the repo band. */
  scope_key: string | null;
  level: string;
  master_enabled: boolean;
  change_note: string;
}

/**
 * `GET /fleet-policy?domain=[&repo=]` (`get_fleet_policy`) — what one domain
 * resolves. With `repo`, coord resolves as that repo would, so a repo-band row
 * for it can win; without it, repo-band rows never match.
 */
export async function fetchFleetPolicy(
  domain: string,
  repo?: string
): Promise<FleetPolicyView> {
  let url = `${OPERATIONS_BASE}/fleet-policy?domain=${encodeURIComponent(domain)}`;
  if (repo) url += `&repo=${encodeURIComponent(repo)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<FleetPolicyView>(res, `GET ${url}`);
}

/**
 * `PUT /fleet-policy` (`put_fleet_policy`) — write one level at one scope
 * band. Declared `idempotent: false`: the write is versioned coord-side, so it
 * is not ours to call repeat-safe (the client's method rule still treats a PUT
 * as retryable, exactly as the `httpClient.put` this replaced did).
 */
export async function putFleetPolicy(
  write: FleetPolicyWrite
): Promise<FleetPolicyWriteResult> {
  const url = `${OPERATIONS_BASE}/fleet-policy`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(write),
    idempotent: false,
  });
  return readJson<FleetPolicyWriteResult>(res, `PUT ${url}`);
}
