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
 * refusing to render an `unknown` source as any value. Coord's own answer then
 * is the last value it read, or off when it holds none — served policy
 * `production-and-cost`, clause `agent-spawn-authorization`: "An UNREADABLE
 * preference retains the last known value and never resolves to the
 * permissive default". That last known value may be On, and this read cannot
 * tell which it is, so it is neither on nor off here.
 */

import { isWriteFailureUnknown } from "@/components/admin/coord/writeOutcome";

export type AutoFixPrSource = "default" | "tenant" | "repo" | "unknown";

/** The three positions of the tenant dial — one per tenant column value. */
export type AutoFixPrChoice = "default" | "on" | "off";

export interface AutoFixPrState {
  /** Raw `tenant_merge_settings.auto_fix_pr`: NULL = follow the default. */
  tenant: boolean | null;
  /**
   * Coord's resolved value at tenant level. Always `false` while `source` is
   * `unknown`, and never shown then: nothing is claimed about the value.
   */
  effective: boolean;
  /** The layer that decided `effective`. */
  source: AutoFixPrSource;
  /**
   * The `unknown` is this page's: coord answered outside the contract, and did
   * not say it could not read the preference.
   */
  offContract?: true;
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
 * resolved boolean, is read as `unknown` and marked `offContract`, never as
 * whatever `auto_fix_pr` claims.
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
  if (rawSource === "unknown") {
    return { tenant: rawTenant, effective: false, source: "unknown" };
  }
  if (
    typeof rawSource !== "string" ||
    !(KNOWN_SOURCES as readonly string[]).includes(rawSource) ||
    typeof p.auto_fix_pr !== "boolean"
  ) {
    return {
      tenant: rawTenant,
      effective: false,
      source: "unknown",
      offContract: true,
    };
  }
  return {
    tenant: rawTenant,
    effective: p.auto_fix_pr,
    source: rawSource as AutoFixPrSource,
  };
}

/** Why {@link readAutoFixPr} found no dial in a profile. */
export type AutoFixPrAbsence = "no_profile" | "not_served" | "malformed";

export function autoFixPrAbsence(profile: unknown): AutoFixPrAbsence {
  if (profile === null || typeof profile !== "object") return "no_profile";
  const served =
    "auto_fix_pr_source" in profile && "auto_fix_pr_tenant" in profile;
  return served ? "malformed" : "not_served";
}

/**
 * Classify a failed PATCH: did the write POSSIBLY land?
 *
 * A failure that leaves the outcome open must be reported that way — never as
 * saved, and never as a clean failure that invites a blind retry. The caller
 * reloads and shows what coord actually serves.
 *
 * Coord can say so itself: it refuses with 503
 * `{error: "auto_fix_pr_column_unavailable", cause, written}`, where
 * `written: null` (`cause: "commit_unconfirmed"`) means it cannot tell whether
 * the commit landed, and an explicit `written: false` (or `true`) is a definite
 * answer and is NOT unconfirmed. Coord sends `cause` only beside `written`
 * (`auto_fix_pr_refusal_body`), so `written` is what is read. Without it, the
 * status decides, by the rule every coord write shares
 * ({@link isWriteFailureUnknown}).
 *
 * What the browser sees: the proxy raises `HTTPException(detail=<coord body
 * text>)`, and the backend's error handler wraps it as
 * `{error, message: <coord body text>, timestamp, path}`. HttpClient then
 * throws `PATCH <url> failed: <status> - <that envelope>`. So coord's body
 * arrives JSON-escaped inside the message, and this reads the message text.
 */
export function isUnconfirmedFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const written = message.match(/\\?"written\\?"\s*:\s*(null|true|false)/);
  if (written) return written[1] === "null";
  return isWriteFailureUnknown(err);
}

export function choiceFromTenant(tenant: boolean | null): AutoFixPrChoice {
  if (tenant === null) return "default";
  return tenant ? "on" : "off";
}

/**
 * The position coord's answer holds the dial at, or `null` when it does not say.
 * Coord's `auto_fix_pr_tenant: null` means "not set" OR "not readable", and only
 * the source separates them, so an `unknown` source is no position at all.
 */
export function dialChoice(
  state: AutoFixPrState | null
): AutoFixPrChoice | null {
  if (state === null || state.source === "unknown") return null;
  return choiceFromTenant(state.tenant);
}

/** The PATCH value for a choice — `null` is "clear the override". */
export function tenantFromChoice(choice: AutoFixPrChoice): boolean | null {
  if (choice === "default") return null;
  return choice === "on";
}

export interface TenantSummary {
  /** "On" / "Off" / "Unknown". */
  value: string;
  tone: "on" | "off" | "unknown";
  /** Where the value came from, or why there is none, as a sentence fragment. */
  detail: string;
}

export function tenantSummary(state: AutoFixPrState): TenantSummary {
  if (state.source === "unknown") {
    return {
      value: "Unknown",
      tone: "unknown",
      detail: state.offContract
        ? "coord's answer for this preference is not one this page can read"
        : "coord could not read this preference",
    };
  }
  const onOff = state.effective ? "on" : "off";
  const detail =
    state.source === "default"
      ? `from the default (${onOff})`
      : state.source === "tenant"
        ? "from this tenant's setting"
        : "from a repo's .qontinui/config.yml";
  return {
    value: state.effective ? "On" : "Off",
    tone: state.effective ? "on" : "off",
    detail,
  };
}
