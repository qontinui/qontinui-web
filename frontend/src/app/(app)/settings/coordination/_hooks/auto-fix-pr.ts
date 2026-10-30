/**
 * Pure wire helpers for the tenant "Spawn fixer sessions for stuck PRs" dial
 * (`coord.tenant_merge_settings.auto_fix_pr`, plan
 * `2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author`
 * Phase 4b).
 *
 * The contract is coord's, read through the existing web proxy
 * `GET/PATCH /api/v1/operations/pr-merge/settings`:
 *
 * - PATCH body `auto_fix_pr: true | false | null` — `null` clears the tenant
 *   override so the tenant follows the default.
 * - GET profile fields:
 *   - `auto_fix_pr_tenant: boolean | null` — the raw tenant column;
 *   - `auto_fix_pr: boolean` — the value coord resolved at TENANT level;
 *   - `auto_fix_pr_source: "default" | "tenant" | "repo" | "unknown"`.
 *
 * Coord resolves, not this file — including what the default is. The rule is:
 * an explicit OFF at any scope wins; otherwise an explicit ON; otherwise the
 * default. This file renders what coord decided. The one thing it adds is
 * refusing to render an `unknown` source as on: served policy
 * `agent-spawn-authorization` v11 says an unreadable preference never
 * resolves permissive.
 */

import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { NO_CONNECTION_MESSAGE } from "@/services/http-client";

export type AutoFixPrSource = "default" | "tenant" | "repo" | "unknown";

/** The three positions of the tenant dial — one per tenant column value. */
export type AutoFixPrChoice = "default" | "on" | "off";

export interface AutoFixPrState {
  /** Raw `tenant_merge_settings.auto_fix_pr`: NULL = follow the default. */
  tenant: boolean | null;
  /** Coord's resolved value at tenant level. */
  effective: boolean;
  /** The layer that decided `effective`. */
  source: AutoFixPrSource;
}

const KNOWN_SOURCES: readonly AutoFixPrSource[] = [
  "default",
  "tenant",
  "repo",
  "unknown",
];

/**
 * Read the dial off a coord `EffectiveProfile`.
 *
 * Returns `null` when the profile does not carry a well-formed dial — the
 * coord build does not serve the fields yet, or a field has a shape outside
 * the contract. That is "not settable here", which the UI must say instead of
 * inventing a value. A source string outside the contract, or a missing
 * resolved boolean, is read as `unknown`, never as whatever `auto_fix_pr`
 * claims.
 */
export function readAutoFixPr(profile: unknown): AutoFixPrState | null {
  if (profile === null || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  if (!("auto_fix_pr_source" in p) || !("auto_fix_pr_tenant" in p)) {
    return null;
  }
  const rawTenant = p.auto_fix_pr_tenant;
  if (rawTenant !== null && typeof rawTenant !== "boolean") {
    // A stored value we cannot represent must not render as "Default".
    return null;
  }
  const rawSource = p.auto_fix_pr_source;
  let source: AutoFixPrSource =
    typeof rawSource === "string" &&
    (KNOWN_SOURCES as readonly string[]).includes(rawSource)
      ? (rawSource as AutoFixPrSource)
      : "unknown";
  if (typeof p.auto_fix_pr !== "boolean") source = "unknown";
  const effective = source === "unknown" ? false : p.auto_fix_pr === true;
  return { tenant: rawTenant, effective, source };
}

/**
 * Classify a failed PATCH: did the write POSSIBLY land?
 *
 * Two kinds of failure leave the outcome unknown, and both must be reported
 * that way — never as saved, and never as a clean failure that invites a
 * blind retry. The caller reloads and shows what coord actually serves.
 *
 * 1. coord refuses with 503
 *    `{error: "auto_fix_pr_column_unavailable", cause, written}`, and
 *    `written` is null (`cause: "commit_unconfirmed"`): coord cannot tell
 *    whether the commit landed. An explicit `written: false` (or `true`) is a
 *    definite answer and is NOT unconfirmed.
 * 2. The request timed out after it may have been processed. That is either the
 *    web proxy's 504 "timeout waiting for coord", or HttpClient's own abort
 *    ("Request timeout - …").
 *
 * A 502 (coord unreachable) is a clean failure, because nothing was sent. For
 * a failure with no status at all, see {@link isUnconfirmedFailure}.
 *
 * What the browser sees: the proxy raises `HTTPException(detail=<coord body
 * text>)`, and the backend's error handler wraps it as
 * `{error, message: <coord body text>, timestamp, path}`. HttpClient then
 * throws `PATCH <url> failed: <status> - <that envelope>`. So coord's body
 * arrives JSON-escaped inside the message, and this reads the message text.
 */
export function isUnconfirmedWrite(errorMessage: string): boolean {
  const match = errorMessage.match(/\\?"written\\?"\s*:\s*(null|true|false)/);
  if (match) return match[1] === "null";
  if (/commit_unconfirmed/.test(errorMessage)) return true;
  if (/ failed: 504 - /.test(errorMessage)) return true;
  return /^Request timeout/.test(errorMessage);
}

/**
 * {@link isUnconfirmedWrite} for what a write's call actually threw, which also
 * covers a failure that carries no HTTP status at all. A fetch that rejected
 * says nothing about whether the request reached the server and only its answer
 * was lost, and a 2xx whose body would not parse did reach it, so neither is a
 * refusal: `null` from `httpStatusOf` must not fall into a calm arm. The one
 * statusless failure kept as a refusal is the browser reporting it is offline.
 */
export function isUnconfirmedFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (isUnconfirmedWrite(message)) return true;
  if (httpStatusOf(err) !== null) return false;
  return message !== NO_CONNECTION_MESSAGE;
}

export function choiceFromTenant(tenant: boolean | null): AutoFixPrChoice {
  if (tenant === null) return "default";
  return tenant ? "on" : "off";
}

/** The PATCH value for a choice — `null` is "clear the override". */
export function tenantFromChoice(choice: AutoFixPrChoice): boolean | null {
  if (choice === "default") return null;
  return choice === "on";
}

export interface TenantSummary {
  /** "On" / "Off" / "Unknown (treated as off)". */
  value: string;
  tone: "on" | "off" | "unknown";
  /** Where the value came from, as a sentence fragment. */
  from: string;
}

export function tenantSummary(state: AutoFixPrState): TenantSummary {
  if (state.source === "unknown") {
    return {
      value: "Unknown (treated as off)",
      tone: "unknown",
      from: "coord could not read this preference",
    };
  }
  const onOff = state.effective ? "on" : "off";
  const from =
    state.source === "default"
      ? `the default (${onOff})`
      : state.source === "tenant"
        ? "this tenant's setting"
        : "a repo's .qontinui/config.yml";
  return {
    value: state.effective ? "On" : "Off",
    tone: state.effective ? "on" : "off",
    from,
  };
}
