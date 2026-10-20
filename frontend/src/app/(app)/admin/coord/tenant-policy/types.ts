/**
 * Level vocabularies for the tenant-policy page's fleet-policy dials (the
 * command-safety rewrite, permission-prompt capture, the account-selection
 * mode and image generation).
 * The wire shapes — the fleet-policy view and the transcript-sync consent
 * proxy — live with their client in `@/lib/api/operations/tenantPolicy`.
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

// ─────────────────────── permission-prompt capture dial ───────────────────────

/**
 * The fleet-policy domain the permission-prompt capture toggle writes. Levels:
 * `on` | `off`; coord's no-row default is `on` — set by coord's Phase 1
 * change of this plan (`PERMISSION_PROMPT_CAPTURE_DEFAULT`, not on coord's
 * main yet; this console's PR is ordered after it).
 *
 * When `on`, a runner registers a capture hook in the settings carrier it
 * hands each Claude Code session, and records every permission prompt that
 * session raises — the tool and its first command word, counts, first/last
 * seen, permission modes and redacted command excerpts, once an hour per
 * kind of prompt and per machine (the prompt's own wording is not in any hook
 * payload, plan Phase 0) — as a finding in this tenant's coord findings,
 * which the findings steward folds into one dossier per prompt class. A
 * separate consent from
 * {@link COMMAND_SAFETY_REWRITE_DOMAIN} because it sends command text. Like
 * that dial, the runner decides at spawn, so a change reaches only terminals
 * and agent sessions started after it. Plan
 * `2026-10-14-permission-prompts-are-never-recorded-so-guard-rules-grow-on-anecdote`
 * D6/D7.
 */
export const PERMISSION_PROMPT_CAPTURE_DOMAIN = "permission_prompt_capture";

export const PERMISSION_PROMPT_CAPTURE_LEVELS = ["on", "off"] as const;
export type PermissionPromptCaptureLevel =
  (typeof PERMISSION_PROMPT_CAPTURE_LEVELS)[number];

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
 * The levels this console offers. The last five are the runner's
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
  "weighted_random",
  "alternating_handoff",
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
 * return it only when it is one of the six known
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
