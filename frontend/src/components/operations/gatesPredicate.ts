// ============================================================================
// Gate predicate humanization
//
// Pure presentation logic for the gates panel (plan
// 2026-06-05-plan-gate-web-surface-and-productization Phase 2). Turns the
// serde-tagged `GatePredicate` JSON (coord `gates.rs`) into a short, honest
// human string. Exported separately from the panel so it's unit-testable.
//
// Honesty-about-uncertainty: an unknown / future predicate kind renders as
// its raw `kind` (never a blank cell, never a throw), so a coord predicate
// the web hasn't been taught about still shows up legibly.
// ============================================================================

import type { ContinuationSpawn, GatePredicate } from "./types";

/** Max characters of the continuation prompt's first line shown in the summary. */
const CONTINUATION_PROMPT_MAX = 80;

/** Characters of a device UUID shown when no friendlier name is available. */
const DEVICE_ID_SHORT = 8;

const OP_SYMBOL: Record<string, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/** Render a `{k: v}` label filter as a Prometheus-style `{k="v", ...}`. */
function formatLabels(labels: Record<string, string> | null | undefined): string {
  if (!labels) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const inner = entries
    .map(([k, v]) => `${k}="${v}"`)
    .join(", ");
  return `{${inner}}`;
}

/** Humanize a duration given in seconds, e.g. 604800 → "7d", 3600 → "1h". */
export function humanizeDurationSecs(secs: number | undefined): string {
  if (secs === undefined || secs === null || Number.isNaN(secs)) return "?";
  if (secs <= 0) return "0s";
  const units: [number, string][] = [
    [86_400, "d"],
    [3_600, "h"],
    [60, "m"],
    [1, "s"],
  ];
  for (const [size, label] of units) {
    if (secs % size === 0 || secs >= size) {
      const n = Math.floor(secs / size);
      if (n >= 1) return `${n}${label}`;
    }
  }
  return `${secs}s`;
}

/** Render an absolute timestamp compactly (date + HH:MM, locale-aware). */
function formatAbsTs(iso: string | undefined): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Turn a gate predicate into a one-line human description. Defensive: any
 * field the variant expects may be missing (lagging coord deploy / malformed
 * row) — we fall back to the raw `kind` rather than rendering a partial or
 * crashing.
 */
export function humanizePredicate(p: GatePredicate | null | undefined): string {
  if (!p || typeof p.kind !== "string") return "unknown predicate";
  switch (p.kind) {
    case "pr_merged":
      if (p.repo && p.pr_number !== undefined) {
        return `pr_merged: ${p.repo} #${p.pr_number}`;
      }
      return "pr_merged";
    case "deploy_healthy":
      if (p.service) {
        return `deploy_healthy: ${p.service}${
          p.expected_rev ? ` @ ${p.expected_rev}` : ""
        }`;
      }
      return "deploy_healthy";
    case "claim_terminal":
      if (p.claim_kind && p.resource_key) {
        return `claim_terminal: ${p.claim_kind}:${p.resource_key}`;
      }
      return "claim_terminal";
    case "operator_approval":
      return p.prompt ? `operator_approval: "${p.prompt}"` : "operator_approval";
    case "ci_green":
      if (p.repo) {
        const sha = p.head_sha ? ` @ ${p.head_sha.slice(0, 7)}` : "";
        return `ci_green: ${p.repo}${sha}`;
      }
      return "ci_green";
    case "ref_exists":
      if (p.repo && p.ref_name) {
        const at = p.expected_sha ? ` @ ${p.expected_sha.slice(0, 7)}` : "";
        return `ref_exists: ${p.repo} ${p.ref_name}${at}`;
      }
      return "ref_exists";
    case "metric_threshold": {
      if (p.metric && p.op && p.value !== undefined) {
        const labels = formatLabels(p.labels);
        const op = OP_SYMBOL[p.op] ?? p.op;
        const sustain = p.window_secs
          ? ` for ${humanizeDurationSecs(p.window_secs)}`
          : "";
        return `metric_threshold: ${p.metric}${labels} ${op} ${p.value}${sustain}`;
      }
      return "metric_threshold";
    }
    case "time_elapsed":
      if (p.duration_secs !== undefined) {
        const from = p.since ? ` from ${formatAbsTs(p.since)}` : "";
        return `time_elapsed: ${humanizeDurationSecs(p.duration_secs)}${from}`;
      }
      return "time_elapsed";
    case "plan_ready":
      // "Plan ready to implement" — clears when the named plan is vetted and
      // all its sibling gates clear. Show the slug where other kinds show
      // their key params.
      return p.plan_slug
        ? `Plan ready to implement: ${p.plan_slug}`
        : "Plan ready to implement";
    default:
      // Unknown / future kind — show the raw tag, never a blank cell.
      return p.kind;
  }
}

/**
 * A short anchor label for grouping. Plan-anchored gates group under
 * `<plan_slug | plan_id> · phase_name`; claim-anchored gates get their own
 * group keyed by `claim_kind · resource_key`. Returns a stable key + a display
 * label.
 *
 * The display prefers the human-readable `plan_slug` when coord supplies it,
 * falling back to the raw `plan_id` UUID — rendered defensively because prod
 * coord may briefly lag the new field (a row without a slug still groups and
 * labels correctly). The grouping KEY stays anchored on `plan_id` so a mix of
 * slug-bearing and slug-less rows for the same plan still collapses into one
 * group.
 */
export function gateAnchor(gate: {
  plan_id: string | null;
  phase_name: string | null;
  plan_slug?: string | null;
  claim_kind: string | null;
  resource_key: string | null;
}): { key: string; label: string; kind: "plan" | "claim" } {
  if (gate.plan_id) {
    const phase = gate.phase_name ?? "(no phase)";
    const planLabel = gate.plan_slug || gate.plan_id;
    return {
      key: `plan:${gate.plan_id}:${phase}`,
      label: `${planLabel} · ${phase}`,
      kind: "plan",
    };
  }
  if (gate.claim_kind) {
    const rk = gate.resource_key ?? "(no resource)";
    return {
      key: `claim:${gate.claim_kind}:${rk}`,
      label: `${gate.claim_kind} · ${rk}`,
      kind: "claim",
    };
  }
  return { key: "unanchored", label: "Unanchored", kind: "claim" };
}

// ---------------------------------------------------------------------------
// Continuation summary (predictability: the gate row says what clearing does)
//
// Plan `2026-06-05-visible-gate-continuations-and-plan-ready-predicate.md` P3.
// ---------------------------------------------------------------------------

/** First line of a multi-line prompt, trimmed. Empty string for empty input. */
function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

/**
 * Shorten a device id for display: prefer a resolved hostname when the caller
 * has one (the page's device-status data), else the first 8 chars of the UUID.
 * Returns `"an unknown device"` when nothing identifies the target.
 */
function shortDevice(
  deviceId: string | undefined,
  hostname?: string | null,
): string {
  if (hostname) return hostname;
  if (deviceId) return deviceId.slice(0, DEVICE_ID_SHORT);
  return "an unknown device";
}

/**
 * One-line, honest summary of what clearing a gate's anchor will spawn — so
 * the operator knows what the button does BEFORE they click (predictability).
 *
 * - `presentation` absent OR `"terminal"` → a VISIBLE terminal session the
 *   operator can watch/interrupt (coord's serde default; absent == terminal).
 * - `presentation: "headless"` → a background agent session, no interactive
 *   surface.
 *
 * The prompt is reduced to its first line, truncated to ~80 chars with an
 * ellipsis. `hostnameFor` lets the caller substitute a friendly device name
 * when the page already has device data; without it we show the short UUID
 * (we do NOT build a device-lookup pipeline just for this — honest short id).
 *
 * Returns `null` when there is nothing to summarize (no continuation, or a
 * continuation with no usable fields) so the row renders no summary at all
 * rather than an empty/misleading line.
 */
export function summarizeContinuation(
  spawn: ContinuationSpawn | null | undefined,
  hostnameFor?: (deviceId: string) => string | null | undefined,
): string | null {
  if (!spawn || typeof spawn !== "object") return null;

  const headless = spawn.presentation === "headless";
  const hostname =
    spawn.target_device_id && hostnameFor
      ? hostnameFor(spawn.target_device_id)
      : undefined;
  const device = shortDevice(spawn.target_device_id, hostname);

  const lead = headless
    ? `Clearing spawns a headless agent session on ${device}`
    : `Clearing opens a visible terminal session on ${device}`;

  const prompt =
    typeof spawn.initial_prompt === "string"
      ? firstLine(spawn.initial_prompt)
      : "";
  if (!prompt) return lead;

  const shown =
    prompt.length > CONTINUATION_PROMPT_MAX
      ? `${prompt.slice(0, CONTINUATION_PROMPT_MAX)}…`
      : prompt;
  return `${lead} · prompt: "${shown}"`;
}
