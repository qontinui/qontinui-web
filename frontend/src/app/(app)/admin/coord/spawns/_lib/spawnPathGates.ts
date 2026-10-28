/**
 * spawnPathGates — one SWITCH that governs a spawn path, as the matrix shows
 * it: where it is set, at what scope, whether it is enforced, and what coord
 * says its value is. Pure: every reading is a function of what the reads
 * returned, so each arm is unit-tested (`spawnPathMatrix.test.ts`).
 *
 * ## The effective state is coord's, never this page's
 *
 * Each gate shows the value ONE served read gives it — the agent registry's
 * effective row, the next-step settings' own `effective_state`, the merge
 * settings' resolved dial, the follow-up scope read. A path governed by
 * several switches lists every one, each with its own value, and the page
 * never folds them into one verdict: coord's authorization fold (strictest of
 * the path's own row and its class row) is coord's, and a second copy here
 * could drift from it (served policy `production-and-cost`
 * `agent-spawn-authorization`; the drift is how the 2026-08-03 outage looked).
 *
 * ## After a write, the read-back — never the value asked for
 *
 * A gate's value is always the latest READ. A write records what was asked
 * (`SwitchWrite`); the gate then compares the read that follows with it and
 * says whether coord reads back what was asked, or contradicts it. A write
 * whose read-back failed makes the gate UNKNOWN, whatever was retained.
 *
 * ## UNKNOWN names its source
 *
 * Every value a read could not supply renders UNKNOWN with the read named and
 * why; a stale value (the latest refresh failed, the last answer kept) says
 * it is stale. In presentation mode the reason is fixed words
 * (`presentedFailureReason`): a failure text can quote a URL or coord's words.
 */

import type {
  AdminAgentRegistryRow,
  AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import type {
  AutonomyLevel,
  NextStepDomain,
  NextStepSettings,
} from "@/lib/api/operations/coordSettings";
import { presentedFailureReason } from "@/components/operations/presentedFailure";
import {
  choiceFromTenant,
  tenantSummary,
  type AutoFixPrChoice,
  type AutoFixPrState,
} from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import {
  fleetRolloutMode,
  rolloutHeadline,
  summarizeScopes,
  type RepoDialReading,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import type { EnforcedBy, SwitchWhere } from "./spawnPathCatalog";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One read the matrix depends on, as its hook holds it. */
export interface ReadPart<T> {
  /** The last good answer, or `null` before one. */
  data: T | null;
  /** The latest read's failure; `null` after a success. With `data`: stale. */
  error: string | null;
  /** When `data` was true (the answer's arrival); `null` before one. */
  asOfMs: number | null;
  /** No read has settled yet. */
  loading: boolean;
}

/** The merge-settings dial as `useAutoFixPrSetting` holds it. */
export interface AutoFixPrRead {
  loading: boolean;
  error: string | null;
  /** `null` when loaded but this coord does not serve the dial. */
  state: AutoFixPrState | null;
}

/** The per-repo follow-up scopes as `useRepoFollowupDials` holds them. */
export interface FollowupRead {
  loading: boolean;
  repos: string[] | null;
  reposError: string | null;
  readings: Readonly<Record<string, RepoDialReading>>;
}

/** A write the operator made from the matrix, keyed by the gate it targets. */
export interface SwitchWrite {
  /** What was asked, in the gate's own vocabulary (`on` / `off`, a level, a choice). */
  asked: string;
  phase: "writing" | "written" | "refused";
  /** The write was refused; nothing changed as far as coord said. */
  error: string | null;
  /** The write landed but reading it back failed: the value is UNKNOWN. */
  readbackError: string | null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type CellTone = "known" | "unknown" | "contradiction";

/** One value in the matrix. */
export interface GateCell {
  /** Machine-readable value (`on`, `off`, a level, `unknown`, …). */
  state: string;
  /** The words shown. */
  text: string;
  /** More, on hover. */
  title?: string;
  tone: CellTone;
  /** The value is the last good read: the latest refresh failed. */
  stale: boolean;
  /** After a write: what was asked, and whether coord reads it back. */
  readBack?: { asked: string; askedText: string; matches: boolean };
  /** A write's own outcome when it did not reach a read-back. */
  writeNote?: string;
}

export type GateScope = "tenant" | "repo" | "device" | "environment variable";

export type EnforcedKind =
  | "enforce"
  | "shadow"
  | "off"
  | "env-only"
  | "runner-only"
  | "unknown";

export interface GateEnforcement {
  kind: EnforcedKind;
  text: string;
  title: string;
}

/** What a gate's control writes, when it has one. */
export type GateWrite =
  | {
      door: "registry";
      agentName: string;
      /** The tenant default coord reads now. */
      current: boolean;
    }
  | {
      door: "next_step";
      domain: string;
      level: AutonomyLevel;
    }
  | {
      door: "auto_fix_pr";
      choice: AutoFixPrChoice;
    };

/** One switch that governs a path. */
export interface MatrixGate {
  /** Stable key — also the write's key (`registry:<name>`, `autonomy:<domain>` …). */
  key: string;
  /** The switch, named. */
  title: string;
  /** Where it is set. */
  where: string;
  scope: GateScope;
  /** A second scope that can override it, in words. */
  scopeNote?: string;
  enforced: GateEnforcement;
  /** Coord's value for it. */
  effective: GateCell;
  /** The stored value the control moves, where it differs from `effective`. */
  position?: GateCell;
  /** The control, or `null` when this gate is read-only here. */
  write: GateWrite | null;
  /** Why there is no control, when there is none. */
  readOnly?: string;
  /** A link to where it IS set, when that is another console page. */
  setOn?: { href: string; label: string };
  /** This gate is another row's switch, shown here read-only. */
  mirrorOf?: string;
}

// ---------------------------------------------------------------------------
// Shared words
// ---------------------------------------------------------------------------

function failure(reason: string, presenting: boolean): string {
  return presentedFailureReason(reason, presenting);
}

function unknownCell(text: string, title?: string): GateCell {
  return { state: "unknown", text, title, tone: "unknown", stale: false };
}

/** Stamp a write's outcome onto the cell its read produced. */
function withWrite(
  cell: GateCell,
  write: SwitchWrite | undefined,
  askedText: (asked: string) => string,
  presenting: boolean
): GateCell {
  if (!write) return cell;
  if (write.phase === "writing") {
    return { ...cell, writeNote: `Writing ${askedText(write.asked)}…` };
  }
  if (write.phase === "refused") {
    return {
      ...cell,
      writeNote: `Your change to ${askedText(write.asked)} was refused: ${failure(write.error ?? "no reason given", presenting)}. The value shown is what coord reads.`,
    };
  }
  if (write.readbackError !== null) {
    return {
      state: "unknown",
      text: "UNKNOWN",
      title: `Written (${askedText(write.asked)}), but reading it back failed: ${failure(write.readbackError, presenting)}. What coord resolves is unknown until the next read.`,
      tone: "unknown",
      stale: false,
      writeNote: `Written, but reading it back failed — UNKNOWN until the next read.`,
    };
  }
  if (cell.tone === "unknown") return cell;
  const matches = cell.state === write.asked;
  return {
    ...cell,
    tone: matches ? cell.tone : "contradiction",
    readBack: {
      asked: write.asked,
      askedText: askedText(write.asked),
      matches,
    },
  };
}

const ON_OFF_TEXT = (asked: string) => (asked === "on" ? "on" : "off");

// ---------------------------------------------------------------------------
// The agent registry: a path's own row
// ---------------------------------------------------------------------------

/** The served effective row for `name`, or why there is none. */
function effectiveRow(
  read: ReadPart<AgentRegistryEntry[]>,
  name: string,
  presenting: boolean
): { row: AgentRegistryEntry; stale: boolean } | GateCell {
  if (read.data === null) {
    if (read.error !== null) {
      return unknownCell(
        "UNKNOWN",
        `Coord's effective agent registry could not be read: ${failure(read.error, presenting)}.`
      );
    }
    return unknownCell("UNKNOWN", "Coord's effective agent registry is still being read.");
  }
  const row = read.data.find((r) => r.agent_name === name);
  if (!row) {
    return unknownCell(
      "UNKNOWN",
      presenting
        ? "The coordination service lists no switch for this path."
        : `Coord's effective registry serves no row named ${name}, so whether this path is switched on is unknown — not on.`
    );
  }
  return { row, stale: read.error !== null };
}

/** Coord's effective value for a registry row (the fold coord serves). */
export function registryEffectiveCell(
  read: ReadPart<AgentRegistryEntry[]>,
  name: string,
  write: SwitchWrite | undefined,
  presenting: boolean
): GateCell {
  const found = effectiveRow(read, name, presenting);
  if (!("row" in found)) return withWrite(found, write, ON_OFF_TEXT, presenting);
  const { row, stale } = found;
  const fromPref = row.source === "user_pref";
  const title = presenting
    ? row.enabled
      ? "Switched on."
      : "Switched off."
    : [
        `Coord's effective row for ${name}: ${row.enabled ? "enabled" : "disabled"}`,
        fromPref
          ? " — from YOUR OWN preference row. Coord's spawn enforcement reads the tenant default, not preferences, for the paths it starts itself; the tenant default is shown beside this."
          : " — from the tenant default (no preference of yours is recorded).",
        !row.enabled && row.policy_required
          ? ` Policy-required; disposition while off: ${row.disposition}.`
          : "",
        stale ? " The latest refresh failed: this is the last good read." : "",
      ].join("");
  const cell: GateCell = {
    state: row.enabled ? "on" : "off",
    text: `${row.enabled ? "On" : "Off"}${fromPref && !presenting ? " (your preference)" : ""}`,
    title,
    tone: "known",
    stale,
  };
  return withWrite(cell, write, ON_OFF_TEXT, presenting);
}

/** The tenant default the control moves (`default_enabled` on the raw row). */
export function registryPositionCell(
  read: ReadPart<AdminAgentRegistryRow[]>,
  name: string,
  presenting: boolean
): { cell: GateCell; current: boolean | null } {
  if (read.data === null) {
    return {
      cell: unknownCell(
        "UNKNOWN",
        read.error !== null
          ? `The tenant defaults could not be read: ${failure(read.error, presenting)}.`
          : "The tenant defaults are still being read."
      ),
      current: null,
    };
  }
  const row = read.data.find((r) => r.agent_name === name);
  if (!row) {
    return {
      cell: unknownCell(
        "UNKNOWN",
        presenting
          ? "The coordination service lists no default for this path."
          : `Coord's registry holds no row named ${name}, so its tenant default is unknown.`
      ),
      current: null,
    };
  }
  const overrides =
    row.pref_count === 0
      ? "No member has recorded a preference of their own."
      : `${row.pref_count} member${row.pref_count === 1 ? " has" : "s have"} a recorded preference, which a change to the default does not reach.`;
  return {
    cell: {
      state: row.default_enabled ? "on" : "off",
      text: `Tenant default ${row.default_enabled ? "on" : "off"}`,
      title: presenting ? undefined : overrides,
      tone: "known",
      stale: read.error !== null,
    },
    current: row.default_enabled,
  };
}

/** The enforcement of a registry row, by who refuses the spawn. */
export function registryEnforcement(by: EnforcedBy): GateEnforcement {
  return by === "coord"
    ? {
        kind: "enforce",
        text: "enforce",
        title:
          "Coord refuses to start this path's session while the switch is off.",
      }
    : {
        kind: "enforce",
        text: "enforce (each runner)",
        title:
          "Each runner refuses to start sessions of this kind while the switch is off.",
      };
}

export interface RegistryGateInput {
  name: string;
  enforcedBy: EnforcedBy;
  effective: ReadPart<AgentRegistryEntry[]>;
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  write: SwitchWrite | undefined;
  presenting: boolean;
}

/** A path's own registry row: the primary gate of every coord path. */
export function registryGate(input: RegistryGateInput): MatrixGate {
  const { name, presenting } = input;
  const position = registryPositionCell(input.defaults, name, presenting);
  return {
    key: `registry:${name}`,
    title: "Agent registry switch",
    where: presenting
      ? "A switch in the agent registry, for the whole project."
      : `Agent registry row ${name} — the tenant default (PUT /coord/agent-registry/${name}).`,
    scope: "tenant",
    enforced: registryEnforcement(input.enforcedBy),
    effective: registryEffectiveCell(
      input.effective,
      name,
      input.write,
      presenting
    ),
    position: position.cell,
    write:
      position.current === null
        ? null
        : { door: "registry", agentName: name, current: position.current },
    readOnly:
      position.current === null
        ? "The tenant default could not be read, so the switch is not offered: flipping a value nobody read could switch it the wrong way."
        : undefined,
  };
}

/** Another row's registry switch, shown read-only on this path (a class row, or the gate-continuation kind). */
export function mirrorGate(
  input: Omit<RegistryGateInput, "defaults"> & { mirrorLabel: string }
): MatrixGate {
  const { name, presenting } = input;
  return {
    key: `mirror:${name}`,
    title: `${input.mirrorLabel} switch`,
    where: presenting
      ? `The "${input.mirrorLabel}" switch, which has its own row.`
      : `Agent registry row ${name}, which has its own row on this matrix; it is written there.`,
    scope: "tenant",
    enforced: registryEnforcement(input.enforcedBy),
    effective: registryEffectiveCell(input.effective, name, undefined, presenting),
    write: null,
    readOnly: `Written on the "${input.mirrorLabel}" row.`,
    mirrorOf: name,
  };
}

// ---------------------------------------------------------------------------
// Next-step settings: the autonomy level and the fleet flag
// ---------------------------------------------------------------------------

export const AUTONOMY_LEVEL_LABEL: Record<AutonomyLevel, string> = {
  auto_decide: "Auto",
  guidance_only: "Guidance only",
  always_escalate: "Always escalate",
};

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "always_escalate",
  "guidance_only",
  "auto_decide",
];

function domainOf(
  read: ReadPart<NextStepSettings>,
  domain: string
): NextStepDomain | undefined {
  return read.data?.domains.find((d) => d.decision_domain === domain);
}

function verdictWords(
  state: NextStepDomain["effective_state"],
  presenting: boolean
): string {
  const whose = presenting ? "the service's verdict" : "coord's verdict";
  switch (state) {
    case "effective":
      return `${whose}: it dispatches`;
    case "not_effective":
      return `${whose}: it does not dispatch`;
    case "unknown":
      return `${whose}: unknown — it depends on a setting this read cannot see`;
    default:
      return presenting ? "no verdict served" : "coord served no verdict";
  }
}

function nextStepUnread(
  read: ReadPart<NextStepSettings>,
  domain: string,
  presenting: boolean
): GateCell | null {
  if (read.data === null) {
    return unknownCell(
      "UNKNOWN",
      read.error !== null
        ? `Coord's next-step settings could not be read: ${failure(read.error, presenting)}.`
        : "Coord's next-step settings are still being read."
    );
  }
  if (!domainOf(read, domain)) {
    return unknownCell(
      "UNKNOWN",
      presenting
        ? "The coordination service lists no autonomy setting for this path."
        : `Coord's next-step settings serve no ${domain} domain, so this gate is unknown.`
    );
  }
  return null;
}

export function autonomyGate(
  read: ReadPart<NextStepSettings>,
  domain: string,
  write: SwitchWrite | undefined,
  presenting: boolean
): MatrixGate {
  const unread = nextStepUnread(read, domain, presenting);
  const d = domainOf(read, domain);
  const levelText = (asked: string) =>
    AUTONOMY_LEVEL_LABEL[asked as AutonomyLevel] ?? asked;
  let effective: GateCell;
  if (unread !== null || !d) {
    effective = withWrite(
      unread ?? unknownCell("UNKNOWN"),
      write,
      levelText,
      presenting
    );
  } else {
    effective = withWrite(
      {
        state: d.autonomy_level,
        text: `${AUTONOMY_LEVEL_LABEL[d.autonomy_level] ?? d.autonomy_level} · ${verdictWords(d.effective_state, presenting)}`,
        title: presenting
          ? "Auto lets the coordination service start the session on its own; Guidance only frames the next step for a person; Always escalate hands it to a person."
          : `${d.label}: ${d.autonomy_level} (resolved from the ${d.resolved_from} band${d.autonomy_level_source === "code_fallback" ? "; no policy row matched, so this is coord's built-in default and the resolver escalates" : ""}). ${verdictWords(d.effective_state, presenting)}.`,
        tone: "known",
        stale: read.error !== null,
      },
      write,
      levelText,
      presenting
    );
  }
  const canEdit = read.data?.can_edit === true;
  return {
    key: `autonomy:${domain}`,
    title: "Autonomy level",
    where: presenting
      ? "The project's autonomy setting for this decision."
      : `Next-step settings, decision domain ${domain}${d ? ` ("${d.label}")` : ""} — PUT /coord/next-step-settings.`,
    scope: "tenant",
    enforced: {
      kind: "enforce",
      text: "enforce",
      title:
        "Coord starts this path's session only at the Auto level; below it, it frames or escalates instead.",
    },
    effective,
    write:
      d && canEdit
        ? { door: "next_step", domain, level: d.autonomy_level }
        : null,
    readOnly: !d
      ? "The setting could not be read, so it is not offered."
      : canEdit
        ? undefined
        : "Coord says this account may not change the next-step settings.",
  };
}

export function fleetFlagGate(
  read: ReadPart<NextStepSettings>,
  domain: string,
  presenting: boolean
): MatrixGate {
  const unread = nextStepUnread(read, domain, presenting);
  const d = domainOf(read, domain);
  const flag = d?.master_flag ?? null;
  let effective: GateCell;
  if (unread !== null || !d) {
    effective = unread ?? unknownCell("UNKNOWN");
  } else if (d.master_flag_enabled === true || d.master_flag_enabled === false) {
    effective = {
      state: d.master_flag_enabled ? "on" : "off",
      text: d.master_flag_enabled ? "On" : "Off",
      title: presenting
        ? undefined
        : `${flag ?? "The flag"} is ${d.master_flag_enabled ? "set" : "not set"} in coord's environment.`,
      tone: "known",
      stale: read.error !== null,
    };
  } else {
    effective = unknownCell(
      "UNKNOWN",
      presenting
        ? "The coordination service did not say whether this deployment setting is on."
        : `Coord did not say whether ${flag ?? "this domain's flag"} is set (master_flag_enabled absent or null) — unknown, not off.`
    );
  }
  return {
    key: `flag:${domain}`,
    title: "Fleet flag",
    where: presenting
      ? "A deployment setting of the coordination service."
      : `Coord environment variable ${flag ?? "(coord did not name it)"}.`,
    scope: "environment variable",
    enforced: {
      kind: "env-only",
      text: "env-only",
      title:
        "Read from coord's environment when it starts; changing it is a redeploy of coord, not a console write.",
    },
    effective,
    write: null,
    readOnly: presenting
      ? "Changed only by redeploying the coordination service."
      : "Set in coord's deployment environment; this console cannot write it.",
  };
}

// ---------------------------------------------------------------------------
// Merge settings: the PR fixer dial
// ---------------------------------------------------------------------------

const DIAL_CHOICE_TEXT: Record<AutoFixPrChoice, string> = {
  default: "follow the default",
  on: "on",
  off: "off",
};

export function fixerDialGate(
  read: AutoFixPrRead,
  write: SwitchWrite | undefined,
  presenting: boolean
): MatrixGate {
  const askedText = (asked: string) =>
    DIAL_CHOICE_TEXT[asked as AutoFixPrChoice] ?? asked;
  let effective: GateCell;
  if (read.loading && read.state === null && read.error === null) {
    effective = unknownCell("UNKNOWN", "The merge settings are still being read.");
  } else if (read.error !== null) {
    effective = unknownCell(
      "UNKNOWN",
      `The merge settings could not be read: ${failure(read.error, presenting)}. Unknown is treated as off.`
    );
  } else if (read.state === null) {
    effective = unknownCell(
      "UNKNOWN",
      presenting
        ? "The coordination service does not offer this setting yet."
        : "This coord does not serve the auto_fix_pr dial yet, so it is not settable here."
    );
  } else {
    const summary = tenantSummary(read.state);
    effective = {
      state: choiceFromTenant(read.state.tenant),
      text: summary.value,
      title: `From ${summary.from}.`,
      tone: summary.tone === "unknown" ? "unknown" : "known",
      stale: false,
    };
  }
  return {
    key: "dial:auto_fix_pr",
    title: "Fixer dial for stuck PRs",
    where: presenting
      ? "A project setting: whether fixers start for stuck pull requests."
      : "Merge settings: Spawn fixer sessions for stuck PRs (auto_fix_pr) — PATCH /pr-merge/settings.",
    scope: "tenant",
    scopeNote: presenting
      ? "A repository can also switch it off."
      : "A repository can also switch it off in its committed .qontinui/config.yml (merge.auto_fix_pr: false); an explicit off at any scope wins.",
    enforced: {
      kind: "enforce",
      text: "enforce",
      title: "Coord starts no PR fixer while the dial resolves off.",
    },
    effective: withWrite(effective, write, askedText, presenting),
    write:
      read.state === null
        ? null
        : { door: "auto_fix_pr", choice: choiceFromTenant(read.state.tenant) },
    readOnly:
      read.state === null
        ? "The dial could not be read, so it is not offered."
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// The post-merge follow-up: a per-repo scope under a fleet rollout mode
// ---------------------------------------------------------------------------

export const AGENT_REGISTRY_HREF = "/admin/coord/agent-registry";

export function followupScopeGate(
  read: FollowupRead,
  presenting: boolean
): MatrixGate {
  const readings = (read.repos ?? []).map((r) => read.readings[r]);
  const rollout = fleetRolloutMode(readings, { loading: read.loading });
  const headline = rolloutHeadline(rollout);
  const enforced: GateEnforcement =
    rollout.mode === null
      ? { kind: "unknown", text: "UNKNOWN", title: headline.detail }
      : {
          kind:
            rollout.mode === "enforce"
              ? "enforce"
              : rollout.mode === "shadow"
                ? "shadow"
                : "off",
          text: `${rollout.mode}${rollout.stale ? " (stale)" : ""}`,
          title: headline.detail,
        };
  let effective: GateCell;
  if (read.repos === null) {
    effective = unknownCell(
      "UNKNOWN",
      read.reposError !== null
        ? `The project's repositories could not be read: ${failure(read.reposError, presenting)}.`
        : "The project's repositories are still being read."
    );
  } else if (read.repos.length === 0) {
    effective = {
      state: "no_repos",
      text: "No repositories",
      title: "This project has no registered repositories to set a scope on.",
      tone: "known",
      stale: read.reposError !== null,
    };
  } else {
    const s = summarizeScopes(readings);
    const parts = [
      s.all > 0 ? `${s.all} every merge` : null,
      s.code_only > 0 ? `${s.code_only} code changes only` : null,
      s.none > 0 ? `${s.none} never` : null,
      s.unknown > 0 ? `${s.unknown} unknown` : null,
    ].filter((p): p is string => p !== null);
    effective = {
      state: s.unknown > 0 ? "partial" : "known",
      text: `${read.repos.length} repositor${read.repos.length === 1 ? "y" : "ies"}: ${parts.join(" · ")}`,
      title:
        s.stale > 0
          ? `${s.stale} of these values are from the last good read; their latest refresh failed.`
          : "Each repository's scope as coord reads it.",
      tone: s.unknown > 0 ? "unknown" : "known",
      stale: s.stale > 0,
    };
  }
  return {
    key: "scope:post_merge_followup",
    title: "Follow-up scope, per repository",
    where: presenting
      ? "A per-repository setting: every merge, code changes only, or never."
      : "Per repository, under Agent registry → Per-repo follow-up dials (PUT /post-merge-followup-scope); the rollout mode is coord's COORD_POST_MERGE_SCOPE_MODE.",
    scope: "repo",
    enforced,
    effective,
    write: null,
    readOnly: "Set per repository, not for the whole project.",
    setOn: { href: AGENT_REGISTRY_HREF, label: "Set per repository" },
  };
}

// ---------------------------------------------------------------------------
// Runner-local paths: switched on each machine, unseen by coord
// ---------------------------------------------------------------------------

export function runnerGate(
  key: string,
  where: SwitchWhere,
  presenting: boolean
): MatrixGate {
  return {
    key: `runner:${key}`,
    title: "Runner switch",
    where: presenting ? where.presented : where.operator,
    scope: "device",
    enforced: {
      kind: "runner-only",
      text: "runner-only",
      title:
        "Each runner decides this for itself; coord neither sees nor enforces it.",
    },
    effective: unknownCell(
      "UNKNOWN",
      presenting
        ? "Set on each machine; this page does not read it."
        : "Coord does not see this path: its switch lives on each runner, and this console reads no runner's setting."
    ),
    write: null,
    readOnly: presenting ? where.presented : where.operator,
  };
}
