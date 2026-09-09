/**
 * View types, per-kind configuration and write-boundary validation for the
 * `/admin/coord/agent-commands` and `/admin/coord/agent-skills` console pages.
 *
 * Both routes are the SAME editor over one corpus, parameterized by `kind`.
 * Everything that differs between a slash command and an agent skill lives in
 * a `UnitKindConfig` below, so adding the third kind (`.claude/agents/*.md`,
 * which has the identical delivery gap) is a config entry rather than a second
 * page.
 *
 * The validators here MIRROR the backend's
 * `app/services/agent_text_unit_service.py` — `validate_unit_name`,
 * `validate_relative_path`. They exist so the operator gets the refusal while
 * typing instead of on submit; the corpus boundary is still the backend's, and
 * a rule that disagrees is a bug in this file, not a second policy.
 */

import type {
  AgentTextUnit,
  AgentTextUnitDefault,
} from "@/lib/api/agent-text-units";

// =============================================================================
// Kinds
// =============================================================================

export const KIND_COMMAND = "command";
export const KIND_SKILL = "skill";

/** Everything the shared console needs to know about one unit kind. */
export interface UnitKindConfig {
  /** The wire value of `kind`. */
  kind: string;
  /** Plural, for headings and counts. */
  label: string;
  /** Singular, for prose inside a sentence. */
  singular: string;
  /** This kind's console route. */
  route: string;
  /** One sentence under the page heading. */
  description: string;
  /**
   * How the harness invokes a unit of this kind by name, or `null` when it is
   * not invoked by name at all. `"/"` renders `/vet-plan`; a skill is
   * discovered from disk and invoked as `Skill(name)`, so it gets `null` and
   * the list renders `name/` (a directory) instead.
   */
  invokePrefix: string | null;
  /** True when a unit may carry siblings beside its entrypoint. */
  multiFile: boolean;
  /** Where the runner provisions it, for the "what this does" copy. */
  provisionTarget: string;
  /**
   * Stated when the runner does NOT yet provision this kind, so the page
   * cannot claim a save reaches a session. `null` once it does.
   */
  deliveryCaveat: string | null;
  /**
   * Names the runner is known to ship EMBEDDED.
   *
   * A DISPLAY SEED, not a schema: qontinui-web holds no inventory of the
   * runner's embedded bundle (the bodies live in the binary via `include_str!`),
   * so this only decides which un-stored units get a visible row. Nothing else
   * keys off it. Keep it a plain list so adding an Nth name is a one-line
   * change, and never assume its length.
   */
  knownEmbedded: readonly string[];
  /** Placeholder for the "add a file" input. */
  newFilePlaceholder: string;
}

const COMMAND_CONFIG: UnitKindConfig = {
  kind: KIND_COMMAND,
  label: "Agent Commands",
  singular: "command",
  route: "/admin/coord/agent-commands",
  description:
    "The slash-command procedures the runner writes into every session it " +
    "spawns. A command is one markdown file; the runner resolves account " +
    "override → fleet default → the copy embedded in its binary.",
  invokePrefix: "/",
  multiFile: false,
  provisionTarget: ".claude/commands/<name>.md",
  deliveryCaveat: null,
  knownEmbedded: ["implement-plan", "vet-plan"],
  newFilePlaceholder: "notes.md",
};

const SKILL_CONFIG: UnitKindConfig = {
  kind: KIND_SKILL,
  label: "Agent Skills",
  singular: "skill",
  route: "/admin/coord/agent-skills",
  description:
    "The fleet's agent skills. A skill is a DIRECTORY — SKILL.md plus any " +
    "siblings it invokes by relative path — so the whole bundle is edited and " +
    "versioned together.",
  invokePrefix: null,
  multiFile: true,
  provisionTarget: ".claude/skills/<name>/",
  // Honest today: the runner has no `agent_skills` module and no spawn-time
  // provisioning for this kind until Phase 4 of
  // `2026-08-20-fleet-served-agent-skills.md`. Saying "newly spawned sessions
  // pick this up" here would be the silent-improvisation failure the plan
  // exists to close, restated as UI copy.
  deliveryCaveat:
    "Nothing provisions skills into a session yet — the runner's agent_skills " +
    "module and its spawn-time write land in Phase 4 of this plan. Text saved " +
    "here is stored and versioned; it reaches no session until then.",
  // Nothing is embedded for skills yet: the runner has no `agent_skills`
  // module until Phase 4 and no bundled corpus until Phase 5. An empty seed is
  // the honest statement of that, not an oversight.
  knownEmbedded: [],
  newFilePlaceholder: "helper.sh",
};

/**
 * `satisfies` rather than an annotated `Record<string, UnitKindConfig>`: the
 * annotation would give this an index signature, and under
 * `noUncheckedIndexedAccess` every lookup would then be
 * `UnitKindConfig | undefined` — an impossible branch the console would have to
 * carry. As an object type keyed by `UnitKind`, a lookup is total.
 */
export const UNIT_KIND_CONFIGS = {
  [KIND_COMMAND]: COMMAND_CONFIG,
  [KIND_SKILL]: SKILL_CONFIG,
} satisfies Record<string, UnitKindConfig>;

/** The kinds this console can render. Widening it is adding a config above. */
export type UnitKind = keyof typeof UNIT_KIND_CONFIGS;

/**
 * Per-kind entrypoint filename, mirroring `KIND_ENTRYPOINTS` /
 * `entrypoint_path` in `app/models/agent_text_unit.py`. A kind absent here
 * uses `<name>.md` — the `.claude/commands/` and `.claude/agents/` convention
 * that the unit IS one file named for the unit.
 *
 * A stored unit carries the server's own `entrypoint`; use that. This is for
 * the unit that does not exist yet, where there is no row to read it from.
 */
const KIND_ENTRYPOINTS: Record<string, string> = {
  [KIND_SKILL]: "SKILL.md",
};

export function entrypointFor(kind: string, name: string): string {
  return KIND_ENTRYPOINTS[kind] ?? `${name}.md`;
}

// =============================================================================
// Layers
// =============================================================================

/**
 * Which layer a spawned session's copy of a unit actually resolves from.
 *
 * `"embedded"` is the absence of an EDITABLE row: nothing is stored at either
 * stored layer, so the runner falls through to the copy compiled into its
 * binary. It is not necessarily the absence of TEXT — when a runner has
 * published its roster to this account, `UnitRow.embedded` carries that copy
 * as a display baseline (labelled by the runner version that published it,
 * never as "the default"). When no runner has, qontinui-web holds no copy and
 * says so rather than inventing one.
 */
export type UnitLayer = "account" | "fleet" | "embedded";

/** The layer a write is directed at. `"embedded"` is not writable. */
export type WritableLayer = Extract<UnitLayer, "account" | "fleet">;

export const LAYER_LABEL: Record<UnitLayer, string> = {
  account: "Account override",
  fleet: "Fleet default",
  embedded: "Embedded default",
};

// =============================================================================
// Rows
// =============================================================================

/**
 * One row of the unit list — a `(kind, name)` seen across BOTH stored layers.
 *
 * The console fetches the two layers separately rather than the server's
 * resolved view, because the resolved view drops the shadowed fleet row and
 * that row is exactly what an operator needs to see: an account override with
 * a fleet default behind it means fleet edits stop reaching this account.
 */
export interface UnitRow {
  kind: string;
  name: string;
  /** Where a newly spawned session's copy comes from. */
  layer: UnitLayer;
  /** This account's override, or `null`. */
  account: AgentTextUnit | null;
  /** The fleet default, or `null`. */
  fleet: AgentTextUnit | null;
  /** The row that actually wins: `account ?? fleet ?? null`. */
  resolved: AgentTextUnit | null;
  /**
   * The runner-published embedded default for this name, or `null`.
   *
   * A DISPLAY baseline, not a third editable layer: it is what the diff view
   * puts on the left and what the reset dialog previews. `null` is UNKNOWN-or-
   * absent — no runner has published to this account, the roster it published
   * does not carry this name, or the read failed — and every consumer keeps
   * an honest "unavailable" arm for it rather than treating it as empty text.
   */
  embedded: AgentTextUnitDefault | null;
  /** True when an account override hides a STORED fleet default. */
  shadowsFleet: boolean;
  /**
   * True when the account override and the fleet default carry byte-identical
   * files. The override then changes nothing today and silently pins the
   * account to a snapshot, so a later fleet edit never reaches it.
   */
  pinsFleet: boolean;
  /** False for a copy-source spec — carried, provisioned, never invocable. */
  isInvocable: boolean;
}

// =============================================================================
// Validation (mirrors the backend's write boundary)
// =============================================================================

export const MAX_NAME_LENGTH = 64;
export const MAX_PATH_BYTES = 255;
export const MAX_PATH_SEGMENTS = 8;
export const MAX_FILES_PER_UNIT = 64;

/**
 * Reserved device stems on Windows — a file named `con.md` or `aux` is not
 * creatable there. Byte-identical to `WINDOWS_RESERVED_STEMS` in
 * `app/services/agent_text_unit_service.py`.
 */
const WINDOWS_RESERVED_STEMS: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Mirrors the backend's `_NAME_RE`. The leading underscore is DELIBERATE and
 * is the corpus's marker for a copy-source spec (`_gate-registration`,
 * `_loop-control`): text the corpus must carry because other units paste from
 * it, which the harness must never offer as `/_…`. Widening the name rule does
 * not widen what can be invoked — a DB CHECK refuses `is_invocable` on such a
 * name.
 */
const NAME_PATTERN = /^_?[a-z0-9][a-z0-9-]*$/;

const DRIVE_LETTER_PATTERN = /^[A-Za-z]:/;

/** A path may carry no C0/C1 control character — checked by code point so the
 *  source of this file stays free of the bytes it is rejecting. */
function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

export function validateUnitName(name: string): string | null {
  if (!name) return "Enter a name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Names are at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return "Use lowercase letters, digits and hyphens (e.g. implement-plan). A single leading underscore marks a copy-source spec.";
  }
  if (WINDOWS_RESERVED_STEMS.has(name.replace(/^_+/, "").toLowerCase())) {
    return `"${name}" is a reserved device name on Windows.`;
  }
  return null;
}

/** True when the name marks a copy-source spec rather than an invocable unit. */
export function isCopySourceName(name: string): boolean {
  return name.startsWith("_");
}

/**
 * Mirrors the backend's `validate_relative_path`. Every rejection below is
 * something that lets a write escape the unit's own directory, or something
 * Windows silently rewrites once it gets there.
 */
export function validateRelativePath(path: string): string | null {
  if (!path) return "Enter a file path.";
  if (new TextEncoder().encode(path).length > MAX_PATH_BYTES) {
    return `File paths are at most ${MAX_PATH_BYTES} bytes.`;
  }
  if (path.includes("\\")) {
    return "Use '/' separators, not '\\'.";
  }
  if (Array.from(path).some(isControlChar)) {
    return "File paths cannot contain control characters.";
  }
  if (path.startsWith("/")) return "File paths must be relative.";
  if (DRIVE_LETTER_PATTERN.test(path)) {
    return "File paths cannot carry a drive letter.";
  }

  const segments = path.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) {
    return `File paths are at most ${MAX_PATH_SEGMENTS} segments deep.`;
  }
  for (const segment of segments) {
    if (!segment) return "File paths cannot contain an empty segment.";
    if (segment === "." || segment === "..") {
      return `File paths cannot contain a '${segment}' segment.`;
    }
    if (segment !== segment.trim()) {
      return "Path segments cannot start or end with whitespace.";
    }
    if (segment.endsWith(".")) return "Path segments cannot end with '.'.";
    if (WINDOWS_RESERVED_STEMS.has((segment.split(".")[0] ?? "").toLowerCase())) {
      return `"${segment}" is a reserved device name on Windows.`;
    }
  }
  return null;
}
