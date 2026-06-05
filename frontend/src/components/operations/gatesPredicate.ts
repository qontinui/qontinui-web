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

import type { GatePredicate } from "./types";

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
    default:
      // Unknown / future kind — show the raw tag, never a blank cell.
      return p.kind;
  }
}

/**
 * A short anchor label for grouping. Plan-anchored gates group under
 * `plan_id · phase_name`; claim-anchored gates get their own group keyed by
 * `claim_kind · resource_key`. Returns a stable key + a display label.
 */
export function gateAnchor(gate: {
  plan_id: string | null;
  phase_name: string | null;
  claim_kind: string | null;
  resource_key: string | null;
}): { key: string; label: string; kind: "plan" | "claim" } {
  if (gate.plan_id) {
    const phase = gate.phase_name ?? "(no phase)";
    return {
      key: `plan:${gate.plan_id}:${phase}`,
      label: `${gate.plan_id} · ${phase}`,
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
