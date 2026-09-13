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
 * Classify a failed PATCH by coord's refusal body.
 *
 * coord answers a write it could not complete with 503
 * `{error: "auto_fix_pr_column_unavailable", cause, written}`:
 * - `written: false` — nothing was written, so the refusal is a clean failure;
 * - `written: null` (`cause: "commit_unconfirmed"`) — coord cannot tell whether
 *   the commit landed. That is UNCONFIRMED, never saved and never a clean
 *   failure: the caller must reload and show what coord actually serves.
 *
 * The web proxy surfaces coord's body as text inside the thrown error message,
 * so this reads the message rather than a structured response. Anything that
 * does not carry an explicit `written: null` is a plain failure.
 */
export function isUnconfirmedWrite(errorMessage: string): boolean {
  const match = errorMessage.match(/\\?"written\\?"\s*:\s*(null|true|false)/);
  if (match) return match[1] === "null";
  return /commit_unconfirmed/.test(errorMessage);
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
