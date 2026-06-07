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

import type { ContinuationSpawn, GatePredicate, GateRow } from "./types";

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

// ---------------------------------------------------------------------------
// Continuation LIFECYCLE chip (honesty: show what actually happened to a
// dispatched continuation, never an inferred liveness claim)
//
// Plan `2026-06-07-coord-continuation-cancel-and-outcome.md` Phase 5. Distinct
// from `summarizeContinuation` above (that is the register-time spawn INTENT);
// this reads the runtime lifecycle stamps coord Phase 2 adds to the gate row.
// ---------------------------------------------------------------------------

/** A pending continuation older than this (ms) renders with a warning accent —
 *  the honest "is it stalled?" signal is age, NOT device liveness (the panel
 *  has no liveness feed). The operator judges; coord never claims "stalled". */
const CONTINUATION_PENDING_STALE_MS = 15 * 60 * 1_000;

/**
 * The lifecycle state of a dispatched continuation, in precedence order. A gate
 * that never dispatched a continuation yields `null` (no chip at all).
 *
 * - `cancelled`    — withdrawn before a runner consumed it.
 * - `spawn_failed` — the runner consumed it but the terminal/headless session
 *                    failed to open (silently-lost work, surfaced honestly).
 * - `spawned`      — the runner consumed it and the session opened.
 * - `pending`      — dispatched, not yet consumed/cancelled. Carries the
 *                    dispatch age + target device so the operator can judge
 *                    whether it has stalled.
 */
export type ContinuationLifecycleState =
  | "cancelled"
  | "spawn_failed"
  | "spawned"
  | "pending";

/** Visual accent for the lifecycle chip — maps to the panel's badge idioms.
 *  `error` for spawn_failed, `warning` for a stale-pending row, `neutral`
 *  otherwise (cancelled/spawned/fresh-pending). */
export type ContinuationLifecycleAccent = "error" | "warning" | "neutral";

export interface ContinuationLifecycle {
  state: ContinuationLifecycleState;
  /** Short chip label, e.g. `cancelled: taken over`, `spawn_failed: <detail>`,
   *  `spawned`, `pending — dispatched 3m ago, target abcdef12`. */
  label: string;
  accent: ContinuationLifecycleAccent;
}

/** Compact "Ns/Nm/Nh/Nd ago" — a local copy of `utils.relativeTime`'s shape so
 *  this module stays pure (no util import) and the test is deterministic via the
 *  injectable `now`. `null`/unparseable → "an unknown time ago". */
function relativeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  if (Number.isNaN(diffMs)) return "an unknown time ago";
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** The lifecycle stamps this reads — a structural subset of `GateRow` so the
 *  function is testable with a minimal object. */
type ContinuationLifecycleFields = Pick<
  GateRow,
  | "continuation_dispatched_at"
  | "continuation_consumed_at"
  | "continuation_consumed_outcome"
  | "continuation_cancelled_at"
  | "continuation_cancel_reason"
> & { continuation_spawn?: ContinuationSpawn | null };

/**
 * Reduce a gate's continuation lifecycle stamps to a single chip descriptor in
 * strict precedence: cancelled > spawn_failed > spawned > pending. Returns
 * `null` when the continuation was never dispatched (no chip — a coord that
 * predates Phase 2 omits these fields entirely, so the row degrades silently).
 *
 * Honesty: a pending chip carries the dispatch AGE (warning-accented past ~15m)
 * and the target device's short id — it never asserts the device is online or
 * the continuation "stalled". The operator reads the age and judges.
 *
 * `now` is injectable for deterministic tests; defaults to `Date.now()`.
 */
export function summarizeContinuationLifecycle(
  gate: ContinuationLifecycleFields,
  now: number = Date.now(),
): ContinuationLifecycle | null {
  // Cancelled wins outright — a withdrawn continuation must never read as
  // pending/spawned even if a later stamp also landed.
  if (gate.continuation_cancelled_at) {
    const reason = gate.continuation_cancel_reason?.trim();
    return {
      state: "cancelled",
      label: reason ? `cancelled: ${reason}` : "cancelled",
      accent: "neutral",
    };
  }

  // No chip at all when the continuation was never dispatched.
  if (!gate.continuation_dispatched_at) return null;

  const outcome = gate.continuation_consumed_outcome?.trim();

  // spawn_failed — the runner consumed it but the session failed to open. The
  // outcome is `spawn_failed: <detail>` (coord stores the detail inline); show
  // it verbatim, error-accented. Match on the prefix so a bare `spawn_failed`
  // (no detail) still surfaces.
  if (outcome && outcome.startsWith("spawn_failed")) {
    return { state: "spawn_failed", label: outcome, accent: "error" };
  }

  // spawned — consumed and the session opened.
  if (outcome === "spawned") {
    return { state: "spawned", label: "spawned", accent: "neutral" };
  }

  // pending — dispatched, not yet consumed (no outcome) or a pre-outcome ack.
  // Honest signal = age; warning accent once it's older than the stale window.
  const ago = relativeAgo(gate.continuation_dispatched_at, now);
  const target = shortDevice(gate.continuation_spawn?.target_device_id);
  const dispatchedMs = new Date(gate.continuation_dispatched_at).getTime();
  const stale =
    !Number.isNaN(dispatchedMs) &&
    now - dispatchedMs >= CONTINUATION_PENDING_STALE_MS;
  return {
    state: "pending",
    label: `pending — dispatched ${ago}, target ${target}`,
    accent: stale ? "warning" : "neutral",
  };
}
