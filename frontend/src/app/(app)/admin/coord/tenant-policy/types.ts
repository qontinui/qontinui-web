/**
 * Wire types for the tenant-policy page: the egress switches and the
 * command-safety rewrite / account-selection dials. All are coord fleet-policy
 * domains, whose wire shape is the shared `_shared/fleetPolicy.ts` one.
 */

// ────────────────────────────── egress switches ──────────────────────────────

/**
 * The six outbound data flows a runner can send off its machine, each a
 * tenant-band coord fleet-policy domain with levels `on` | `off` (plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary`, C4). Coord's no-row
 * default is `on` for a hosted deployment and `off` for a coord started with
 * `COORD_DEPLOYMENT_PROFILE=self_hosted`; the read's `default_source` says
 * which.
 *
 * The runner enforces each switch where the flow's bytes would leave (C5), so a
 * flow that is off sends nothing — coord's ingest refusal is only a second
 * line. `appliesAtNextStart` marks the flows a runner reads at boot.
 */
export const EGRESS_FLOWS = [
  {
    flow: "transcript_sync",
    domain: "egress_transcript_sync",
    label: "Transcript sync",
    description:
      "Claude Code session transcripts, and the tenant memory sync and memory queries that ride the same consent, are sent from each runner to this project's coord.",
    appliesAtNextStart: false,
  },
  {
    flow: "code_mirror",
    domain: "egress_code_mirror",
    label: "Code mirror",
    description:
      "Each runner pushes its agents' working branches to coord's git mirror about every five minutes. Turning this off also removes that protection against losing unpushed work with a machine.",
    appliesAtNextStart: false,
  },
  {
    flow: "terminal_stream",
    domain: "egress_terminal_stream",
    label: "Terminal streaming",
    description:
      "Live terminal output from runner sessions is streamed to coord and to this web console, and the console can attach to a runner's terminal.",
    appliesAtNextStart: false,
  },
  {
    flow: "telemetry",
    domain: "egress_telemetry",
    label: "Telemetry",
    description:
      "Crash reports, OpenTelemetry traces and UI error reports are sent from runners to the configured error-reporting and tracing services.",
    appliesAtNextStart: true,
  },
  {
    flow: "update_check",
    domain: "egress_update_check",
    label: "Update check",
    description:
      "Runners ask GitHub's release feed whether a newer runner version exists, at startup and when asked.",
    appliesAtNextStart: false,
  },
  {
    flow: "skill_mirror",
    domain: "egress_skill_mirror",
    label: "Skill mirror",
    description:
      "Runners fetch the latest Claude skills and commands from the public qontinui-claude-config repository on GitHub; when off they serve the bundle built into the runner.",
    appliesAtNextStart: false,
  },
] as const;

export type EgressFlow = (typeof EGRESS_FLOWS)[number]["flow"];
export type EgressFlowSpec = (typeof EGRESS_FLOWS)[number];

export const EGRESS_LEVELS = ["on", "off"] as const;
export type EgressLevel = (typeof EGRESS_LEVELS)[number];

// ──────────────────────── command-safety rewrite dial ────────────────────────

/**
 * The fleet-policy domain the command-safety rewrite toggle writes. Levels:
 * `on` | `off`; coord's no-row default is `on`.
 *
 * When `on`, a runner adds a `PreToolUse` `Bash` hook to the settings carrier
 * it hands each Claude Code session, so a command Claude Code's built-in
 * safety check would stop on is denied with rewrite instructions instead of
 * prompting. The runner decides this at spawn, so a change reaches only
 * terminals and agent sessions started after it. Plan
 * `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts` D5/D6.
 */
export const COMMAND_SAFETY_REWRITE_DOMAIN = "command_safety_rewrite";

export const COMMAND_SAFETY_REWRITE_LEVELS = ["on", "off"] as const;
export type CommandSafetyRewriteLevel =
  (typeof COMMAND_SAFETY_REWRITE_LEVELS)[number];

// ───────────────────────── account-selection mode dial ─────────────────────────

/**
 * The fleet-policy domain carrying the fleet's Claude account-selection mode.
 * Mirrors the runner's `ACCOUNT_SELECTION_DOMAIN`
 * (`qontinui-runner/src-tauri/src/mcp/fleet_policy_poller.rs`).
 *
 * A runner FORCE-APPLIES a recognised mode over its own local mode, unless the
 * machine is pinned (`account_selection_pinned`, machine-global) — then the
 * local mode wins. Tenant-band for the reason the runner gives: the mode is a
 * machine-global fact, and a machine is not repo-scoped. Plan
 * `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 * Phase 3.
 */
export const ACCOUNT_SELECTION_DOMAIN = "account_selection_mode";

/**
 * The levels this console offers. The last three are the runner's
 * `AccountSelectionMode::as_str` wire spellings, byte for byte; `off` is how
 * the console spells **no fleet opinion** — coord's own no-row fallback for an
 * unlisted domain, which the runner's `normalize_account_selection_level`
 * reads (like any level it does not recognise) as "no fleet opinion", so each
 * runner keeps its local mode.
 */
export const ACCOUNT_SELECTION_LEVELS = [
  "off",
  "manual",
  "least_usage",
  "highest_expected_usage",
] as const;
export type AccountSelectionLevel = (typeof ACCOUNT_SELECTION_LEVELS)[number];

/**
 * What a tenant with NO row resolves: `off`, no fleet opinion. The runner maps
 * a `resolved_scope: "none"` answer to "no fleet opinion" whatever level string
 * rides along, so this is the honest reading of the no-row case.
 */
export const ACCOUNT_SELECTION_DEFAULT_LEVEL: AccountSelectionLevel = "off";

/**
 * Normalise a served level the way the runner does — trimmed, ASCII
 * case-insensitive (it matches the runner for every realistic input; JS
 * `trim()` also strips U+FEFF, which Rust's `str::trim` does not) — and
 * return it only when it is one of the four known
 * levels. Anything else is `null`: UNKNOWN, never a guessed level (a guessed
 * mode is exactly what a runner would force-apply over every unpinned
 * machine).
 */
export function parseAccountSelectionLevel(
  raw: string | null | undefined
): AccountSelectionLevel | null {
  if (typeof raw !== "string") return null;
  // ASCII-only folding, as Rust's `to_ascii_lowercase`: `toLowerCase` would
  // also fold non-ASCII look-alikes the runner does not.
  const level = raw.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
  return (ACCOUNT_SELECTION_LEVELS as readonly string[]).includes(level)
    ? (level as AccountSelectionLevel)
    : null;
}
