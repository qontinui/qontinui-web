/**
 * Level vocabularies for the tenant-policy page's fleet-policy dials: the
 * egress switches, the command-safety rewrite, the account-selection mode and
 * image generation. All are coord fleet-policy domains; the wire shape — the
 * fleet-policy view — lives with its client in
 * `@/lib/api/operations/tenantPolicy`.
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

// ───────────────────────────── image generation dial ─────────────────────────────

/**
 * The fleet-policy domain that switches image generation per tenant, with a
 * per-repo override. Plan `2026-10-13-image-generation-and-visual-judgment`
 * Phase 12 (D1.7: it ships on, with off-switches at tenant and machine scope).
 *
 * Studio is to read it before each image request, naming the repo it is
 * generating for (`GET /coord/fleet-policy?domain=image_generation&repo=<owner/name>`
 * — Phase 12 step 3; no Studio build reads it yet), so
 * unlike the two dials above this one IS decided with a repo in hand — hence
 * the per-repo overrides. coord's no-row default is `on`; its PUT refuses any
 * level outside {@link IMAGE_GENERATION_LEVELS} (plus `inherit` on the repo
 * band) and any repo key that is not `owner/name`.
 */
export const IMAGE_GENERATION_DOMAIN = "image_generation";

export const IMAGE_GENERATION_LEVELS = ["on", "local_only", "off"] as const;
export type ImageGenerationLevel = (typeof IMAGE_GENERATION_LEVELS)[number];

/** coord's no-row default for the domain: what "nobody chose" resolves. */
export const IMAGE_GENERATION_DEFAULT_LEVEL: ImageGenerationLevel = "on";

/**
 * What a repo override can be set to. `inherit` clears it, so the repo
 * follows the tenant setting again (coord has no DELETE for a policy row).
 */
export const IMAGE_GENERATION_REPO_CHOICES = [
  "inherit",
  ...IMAGE_GENERATION_LEVELS,
] as const;
export type ImageGenerationRepoChoice =
  (typeof IMAGE_GENERATION_REPO_CHOICES)[number];

/**
 * A served level, matched EXACTLY — coord stores a canonical spelling or
 * refuses the write — or `null`: UNKNOWN, never a guessed level. A spelling
 * coord would refuse today can still be served by a row written before its
 * vocabulary existed, and guessing which level it meant is how a console
 * starts showing "on" for a repo studio treats as something else.
 */
export function parseImageGenerationLevel(
  raw: string | null | undefined
): ImageGenerationLevel | null {
  return typeof raw === "string" &&
    (IMAGE_GENERATION_LEVELS as readonly string[]).includes(raw)
    ? (raw as ImageGenerationLevel)
    : null;
}

/**
 * coord's rule for a repo-band key of this domain (`is_owner_name` in
 * qontinui-coord `ci_hosting_policy.rs`): no whitespace, exactly one `/`, a
 * non-empty owner and name. Checked here only so the console can say why a
 * write would be refused before sending it; coord is the authority.
 */
export function isOwnerName(key: string): boolean {
  if (/\s/.test(key)) return false;
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return false;
  return !key.slice(slash + 1).includes("/");
}
