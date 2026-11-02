/**
 * The runner's SDK and trust posture, read from its `/health` body — every
 * pure derivation the "Capabilities and trust" panel renders (style guide R8).
 *
 * The body is the WHOLE `/health` answer (`relayReads.ts` keeps the envelope),
 * shaped by qontinui-runner `mcp_api.rs` `health`:
 *
 *     { success, data: { gitSha, buildId, uiBridgeBinding, … },
 *       uiBridge, buildId, provenance, sdkFeatures, sdkFeaturesDocUrl, … }
 *
 * - `sdkFeatures` is TOP-level only — the feature inventory baked in at
 *   compile time (qontinui-schemas `rust/src/sdk_features.rs`). Absent means
 *   the build predates the inventory: UNKNOWN, never "no features".
 * - `data.uiBridgeBinding` is the relay registration binding (qontinui-runner
 *   `mcp/relay_binding.rs` `health_json`): the configured and active modes
 *   (`enforce` / `shadow` / `off`) and each rule's `wouldRefuse` / `refused`
 *   counters. Absent means a build that predates the binding: UNKNOWN.
 * - The build is `buildId` (top level, mirrored in `data`) and `data.gitSha`.
 *   A build stamped without a frontend bundle reports `unstamped-<sha>`;
 *   `provenance.unstamped` says so explicitly.
 *
 * A count the body does not carry is `null`, which renders `–` — never `0`.
 */

import type { BuildReading } from "./relaySource";

export interface BindingRuleCount {
  readonly rule: string;
  /** Shadow-mode sightings: requests the rule WOULD have refused. */
  readonly wouldRefuse: number | null;
  /** Requests the rule did refuse (enforce mode). */
  readonly refused: number | null;
}

export interface BindingPosture {
  /** The configured mode (`enforce` / `shadow` / `off`), or null when absent. */
  readonly mode: string | null;
  /** The mode the runner is actually applying, or null when absent. */
  readonly activeMode: string | null;
  /** Per-rule counters, in rule order. */
  readonly rules: readonly BindingRuleCount[];
  /** Registrations refused because the app registry was full. */
  readonly registryFullRefusals: number | null;
}

export interface RunnerPosture {
  readonly buildId: string | null;
  readonly gitSha: string | null;
  /** `true` for a build with no stamped frontend bundle; null when unsaid. */
  readonly unstamped: boolean | null;
  /** The SDK feature inventory; null when the body carries none (UNKNOWN). */
  readonly sdkFeatures: readonly string[] | null;
  readonly sdkFeaturesDocUrl: string | null;
  /** The relay registration binding; null when the body carries none (UNKNOWN). */
  readonly binding: BindingPosture | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** Rule ids in their natural order: `R2` before `R10`, unknown shapes last. */
function ruleOrder(a: string, b: string): number {
  const na = /^R(\d+)/i.exec(a);
  const nb = /^R(\d+)/i.exec(b);
  if (na && nb) {
    const d = Number(na[1]) - Number(nb[1]);
    if (d !== 0) return d;
  } else if (na) return -1;
  else if (nb) return 1;
  return a.localeCompare(b);
}

function readBinding(v: unknown): BindingPosture | null {
  if (!isRecord(v)) return null;
  const rules: BindingRuleCount[] = [];
  if (isRecord(v.rules)) {
    for (const [rule, c] of Object.entries(v.rules)) {
      const counters = isRecord(c) ? c : {};
      rules.push({
        rule,
        wouldRefuse: count(counters.wouldRefuse),
        refused: count(counters.refused),
      });
    }
  }
  rules.sort((a, b) => ruleOrder(a.rule, b.rule));
  return {
    mode: text(v.binding),
    activeMode: text(v.activeBinding),
    rules,
    registryFullRefusals: count(v.registryFullRefusals),
  };
}

/**
 * The posture in a `/health` body, or `null` when the body is not a health
 * answer at all (not an object).
 */
export function readRunnerPosture(body: unknown): RunnerPosture | null {
  if (!isRecord(body)) return null;
  const data = isRecord(body.data) ? body.data : {};
  const provenance = isRecord(body.provenance)
    ? body.provenance
    : isRecord(data.provenance)
      ? data.provenance
      : {};
  const features = Array.isArray(body.sdkFeatures)
    ? body.sdkFeatures.filter(
        (f): f is string => typeof f === "string" && f.trim().length > 0
      )
    : null;
  return {
    buildId: text(body.buildId) ?? text(data.buildId),
    gitSha: text(data.gitSha) ?? text(provenance.gitSha),
    unstamped:
      typeof provenance.unstamped === "boolean" ? provenance.unstamped : null,
    sdkFeatures: features,
    sdkFeaturesDocUrl: text(body.sdkFeaturesDocUrl),
    binding: readBinding(data.uiBridgeBinding),
  };
}

/**
 * The build reading every UNKNOWN on the page names: from a posture when the
 * health read answered, otherwise why it did not.
 */
export function buildReadingOf(
  posture: RunnerPosture | null,
  unknownReason: string
): BuildReading {
  if (posture === null) return { state: "unknown", reason: unknownReason };
  return { state: "known", buildId: posture.buildId, gitSha: posture.gitSha };
}

/** The binding mode in an operator's words. */
export function bindingModeLabel(mode: string | null): string {
  switch (mode) {
    case "enforce":
      return "enforcing";
    case "shadow":
      return "shadow (counting, not refusing)";
    case "off":
      return "off";
    case null:
      return "–";
    default:
      return mode;
  }
}

/** Sum of a counter over every rule; null when no rule carries it. */
export function totalOf(
  rules: readonly BindingRuleCount[],
  key: "wouldRefuse" | "refused"
): number | null {
  let total: number | null = null;
  for (const r of rules) {
    const v = r[key];
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
}
