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
 *   - `auto_fix_pr: boolean` — the value coord resolved;
 *   - `auto_fix_pr_source: "default" | "tenant" | "repo" | "unknown"`.
 *
 * Coord resolves, not this file. The rule is: an explicit OFF at any scope
 * wins; otherwise an explicit ON; otherwise the default ON. This file renders
 * what coord decided. The one thing it adds is refusing to render an
 * `unknown` source as on: served policy `agent-spawn-authorization` v11 says an
 * unreadable preference never resolves permissive.
 */

export type AutoFixPrSource = "default" | "tenant" | "repo" | "unknown";

/** The three positions of the tenant dial — one per tenant column value. */
export type AutoFixPrChoice = "default" | "on" | "off";

export interface AutoFixPrState {
  /** Raw `tenant_merge_settings.auto_fix_pr`: NULL = follow the default. */
  tenant: boolean | null;
  /** Coord's resolved value. */
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
 * Returns `null` when the coord build behind the proxy does not serve the
 * fields yet. That is "not settable here", which the UI must say instead of
 * inventing a value. A source string outside the contract is read as
 * `unknown`, not as whatever `auto_fix_pr` claims.
 */
export function readAutoFixPr(profile: unknown): AutoFixPrState | null {
  if (profile === null || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  if (!("auto_fix_pr_source" in p) || !("auto_fix_pr_tenant" in p)) {
    return null;
  }
  const rawTenant = p.auto_fix_pr_tenant;
  const tenant = typeof rawTenant === "boolean" ? rawTenant : null;
  const rawSource = p.auto_fix_pr_source;
  const source: AutoFixPrSource =
    typeof rawSource === "string" &&
    (KNOWN_SOURCES as readonly string[]).includes(rawSource)
      ? (rawSource as AutoFixPrSource)
      : "unknown";
  const effective = typeof p.auto_fix_pr === "boolean" ? p.auto_fix_pr : false;
  return {
    tenant,
    // An unreadable preference is never permissive, whatever the bool says.
    effective: source === "unknown" ? false : effective,
    source: typeof p.auto_fix_pr === "boolean" ? source : "unknown",
  };
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

export interface EffectiveSummary {
  /** "On" / "Off" / "Unknown (treated as off)". */
  value: string;
  tone: "on" | "off" | "unknown";
  /** Where the value came from, as a sentence fragment. */
  from: string;
}

export function effectiveSummary(state: AutoFixPrState): EffectiveSummary {
  if (state.source === "unknown") {
    return {
      value: "Unknown (treated as off)",
      tone: "unknown",
      from: "coord could not read this preference",
    };
  }
  const from =
    state.source === "default"
      ? "the default (on)"
      : state.source === "tenant"
        ? "this tenant's setting"
        : "a repo's .qontinui/config.yml";
  return {
    value: state.effective ? "On" : "Off",
    tone: state.effective ? "on" : "off",
    from,
  };
}
