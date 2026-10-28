/**
 * followupGates — the two kinds of switch nothing in the registry serves:
 *
 * - the post-merge follow-up's per-repository scope, read through the agent
 *   registry page's own hook (`useRepoFollowupDials`), under coord's fleet
 *   rollout mode (`mode` on `GET /coord/post-merge-followup-scope`, which this
 *   gate shows as its enforcement: `shadow`, `enforce` or `off`);
 * - a runner-local path's switch, which lives on each machine and which coord
 *   neither sees nor enforces: UNKNOWN here by construction, saying where it
 *   is set.
 *
 * The rollout mode is read THROUGH a repository's scope read, so when it is
 * unknown the reason is the read that failed: the repository list, or every
 * repository's scope — never "no repositories" for a list nobody read. The
 * words are this page's (nothing here is "set below"), each with a
 * presentation arm.
 */

import {
  fleetRolloutMode,
  readErrorText,
  summarizeScopes,
  type FleetRollout,
  type RepoDialReading,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import type { SwitchWhere } from "./spawnPathCatalog";
import {
  unknownCell,
  type GateCell,
  type GateEnforcement,
  type FollowupRead,
  type MatrixGate,
} from "./spawnPathGates";

export const AGENT_REGISTRY_HREF = "/admin/coord/agent-registry";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Why each unknown repository's scope is unknown, de-duplicated, in operator words. */
function scopeUnknownReasons(
  readings: ReadonlyArray<RepoDialReading | undefined>
): string[] {
  const out = new Set<string>();
  for (const r of readings) {
    if (!r) {
      out.add("not read yet");
    } else if (r.scopeReadbackError) {
      out.add(`a write's read-back failed (${r.scopeReadbackError})`);
    } else if (r.scope === null) {
      out.add(r.scopeError ? readErrorText(r.scopeError) : "not read yet");
    }
  }
  return [...out];
}

const STALE_NOTE = {
  operator: " (as of the last good read — the latest refresh failed)",
  presented: " (from the last good read)",
};

/** The rollout mode in force, as this page states it. */
function modeEnforcement(
  rollout: FleetRollout & { mode: NonNullable<FleetRollout["mode"]> },
  presenting: boolean
): GateEnforcement {
  const stale = rollout.stale
    ? presenting
      ? STALE_NOTE.presented
      : STALE_NOTE.operator
    : "";
  const text = `${rollout.mode}${rollout.stale ? " (stale)" : ""}`;
  switch (rollout.mode) {
    case "shadow":
      return {
        kind: "shadow",
        text,
        title: presenting
          ? `Recorded only: every merged pull request still gets its follow-up, whatever its repository's setting${stale}.`
          : `Coord's rollout mode (COORD_POST_MERGE_SCOPE_MODE) is shadow: it records what each repository's scope would skip but suppresses nothing — every merged PR still starts its follow-up${stale}.`,
      };
    case "enforce":
      return {
        kind: "enforce",
        text,
        title: presenting
          ? `Applied: a merged pull request its repository's setting excludes gets no follow-up${stale}.`
          : `Coord enforces each repository's scope: a merged PR its repository's scope excludes starts no follow-up${stale}.`,
      };
    case "off":
      return {
        kind: "off",
        text,
        title: presenting
          ? `Not applied: every merged pull request gets its follow-up${stale}.`
          : `Coord's scope check is switched off (COORD_POST_MERGE_SCOPE_MODE): every merged PR starts its follow-up, whatever its repository's scope${stale}.`,
      };
  }
}

function unknownEnforcement(title: string): GateEnforcement {
  return { kind: "unknown", text: "UNKNOWN", title };
}

/** Whether coord acts on the scopes, or why that is unknown — naming the read. */
function followupEnforcement(
  read: FollowupRead,
  readings: ReadonlyArray<RepoDialReading | undefined>,
  presenting: boolean
): GateEnforcement {
  if (read.repos === null) {
    if (read.reposError === null) {
      return unknownEnforcement(
        presenting
          ? "Still being read."
          : "Reading the project's repositories, through which coord's rollout mode is read…"
      );
    }
    return unknownEnforcement(
      presenting
        ? "Whether the service applies these settings is unknown: the project's repositories could not be read."
        : `Whether coord acts on these scopes is unknown: its rollout mode is read through a repository's scope, and the project's repositories could not be read (${read.reposError}).`
    );
  }
  const rollout = fleetRolloutMode(readings, { loading: read.loading });
  if (rollout.mode !== null) {
    return modeEnforcement({ ...rollout, mode: rollout.mode }, presenting);
  }
  switch (rollout.unknownCause) {
    case "loading":
      return unknownEnforcement(
        presenting
          ? "Still being read."
          : "Reading whether coord acts on these scopes…"
      );
    case "no_repos":
      return unknownEnforcement(
        presenting
          ? "Not known: the project has no repository to read it through."
          : "Whether coord acts on these scopes is unknown: its rollout mode is read through a repository's scope, and this project has no registered repository."
      );
    case "missing":
      return unknownEnforcement(
        presenting
          ? "Not reported by the coordination service."
          : "Whether coord acts on these scopes is unknown: coord answered without saying which rollout mode is in force."
      );
    case "disagree":
      return unknownEnforcement(
        presenting
          ? "Not known: the service gave two different answers."
          : "Whether coord acts on these scopes is unknown: the reads reported different rollout modes (coord may have just been redeployed)."
      );
    default:
      return unknownEnforcement(
        presenting
          ? "Whether the service applies these settings is unknown: no repository's setting could be read."
          : `Whether coord acts on these scopes is unknown: no repository's scope could be read (${scopeUnknownReasons(readings).join("; ")}).`
      );
  }
}

function followupEffective(
  read: FollowupRead,
  readings: ReadonlyArray<RepoDialReading | undefined>,
  presenting: boolean
): GateCell {
  if (read.repos === null) {
    return unknownCell(
      "UNKNOWN",
      read.reposError !== null
        ? presenting
          ? "The project's repositories could not be read."
          : `The project's repositories could not be read: ${read.reposError}.`
        : presenting
          ? "Still being read."
          : "The project's repositories are still being read."
    );
  }
  if (read.repos.length === 0) {
    return {
      state: "no_repos",
      text: "No repositories",
      title: "This project has no registered repositories to set a scope on.",
      tone: "known",
      stale: read.reposError !== null,
    };
  }
  const s = summarizeScopes(readings);
  const parts = [
    s.all > 0 ? `${s.all} every merge` : null,
    s.code_only > 0 ? `${s.code_only} code changes only` : null,
    s.none > 0 ? `${s.none} never` : null,
    s.unknown > 0 ? `${s.unknown} unknown` : null,
  ].filter((p): p is string => p !== null);
  const staleNote =
    s.stale > 0
      ? presenting
        ? ` ${s.stale} of these values are from the last good read.`
        : ` ${s.stale} of these values are from the last good read; their latest refresh failed.`
      : "";
  const title =
    s.unknown > 0
      ? presenting
        ? `${plural(s.unknown, "repository's setting", "repositories' settings")} could not be read.${staleNote}`
        : `${plural(s.unknown, "repository's scope", "repositories' scopes")} could not be read: ${scopeUnknownReasons(readings).join("; ")}.${staleNote}`
      : s.stale > 0
        ? staleNote.trim()
        : presenting
          ? "Each repository's setting, as the service reads it."
          : "Each repository's scope as coord reads it.";
  return {
    state: s.unknown > 0 ? "partial" : "known",
    text: `${plural(read.repos.length, "repository", "repositories")}: ${parts.join(" · ")}`,
    title,
    tone: s.unknown > 0 ? "unknown" : "known",
    stale: s.stale > 0,
  };
}

export function followupScopeGate(
  read: FollowupRead,
  presenting: boolean
): MatrixGate {
  const readings = (read.repos ?? []).map((r) => read.readings[r]);
  return {
    key: "scope:post_merge_followup",
    title: "Follow-up scope, per repository",
    where: presenting
      ? "A per-repository setting: every merge, code changes only, or never."
      : "Per repository, under Agent registry → Per-repo follow-up dials (PUT /post-merge-followup-scope); the rollout mode is coord's COORD_POST_MERGE_SCOPE_MODE.",
    scope: "repo",
    enforced: followupEnforcement(read, readings, presenting),
    effective: followupEffective(read, readings, presenting),
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
      title: presenting
        ? "Each machine decides this for itself; the coordination service neither sees nor enforces it."
        : "Each runner decides this for itself; coord neither sees nor enforces it.",
    },
    effective: unknownCell(
      "UNKNOWN",
      presenting
        ? "Set on each machine; this page does not read it."
        : "Coord does not see this path: its switch lives on each runner, and this console reads no runner's setting."
    ),
    write: null,
    readOnly: presenting
      ? "Not changed from this page."
      : "Read-only here: it is set on each runner, which this console does not reach.",
  };
}
