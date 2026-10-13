/**
 * Level vocabularies for the tenant-policy page's fleet-policy dials (the
 * command-safety rewrite and the account-selection mode). The wire shapes —
 * the fleet-policy view and the transcript-sync consent proxy — live with
 * their client in `@/lib/api/operations/tenantPolicy`.
 */

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
