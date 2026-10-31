/**
 * registryGates — a spawn path's own agent-registry row, and another row
 * (its class switch, or the gate-continuation kind) mirrored onto it.
 *
 * ## The value is the TENANT DEFAULT, because that is what is enforced
 *
 * Two registry reads exist, and they answer different questions:
 *
 * - the raw rows (`GET /api/v1/agent-registry/admin/registry` →
 *   `/coord/agent-registry`), whose `default_enabled` is the tenant default;
 * - the signed-in member's fold (`GET /api/v1/agent-registry` →
 *   `/coord/agent-registry/effective-for`): the default, overlaid with THAT
 *   member's own preference row when one is recorded.
 *
 * Coord's spawn seam folds the registry DEFAULTS only — "Every enforcement
 * site here folds registry defaults only … including the operator door"
 * (`spawn_authorization.rs`, "Prefs do NOT bind enforcement"). So for every
 * path coord starts, the served tenant default IS the value coord enforces
 * (`effective_from(row, None)` is `default_enabled`), and that is what a path
 * shows. Rendering the member's fold instead would show the presenter's own
 * preference as the path's state — off for a path coord runs, or the reverse.
 *
 * A runner reads the registry for the member it is signed in as, so on a row
 * a runner reads (`enforcedBy` `runner` or `both`) a member's preference CAN
 * bind on that member's machines: such a row says how many members recorded
 * the opposite of the default (`pref_differs_from_default_count`), served on
 * the raw row.
 *
 * The member's fold is still read: when the raw rows did not answer (a
 * member who is not a tenant admin may not read them), a fold row sourced
 * `default` carries the default itself; and in operator mode a recorded
 * preference is shown beside the value as the operator's own, never as the
 * path's.
 */

import type {
  AdminAgentRegistryRow,
  AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import type { EnforcedBy, ServedPathWords } from "./spawnPathCatalog";
import {
  ON_OFF_TEXT,
  onOffVerdict,
  unknownCell,
  withWrite,
  type GateCell,
  type GateEnforcement,
  type MatrixGate,
  type ReadPart,
  type SwitchWrite,
} from "./spawnPathGates";

export interface RegistryGateInput {
  name: string;
  /** The row's catalog words: who reads its off switch, and what off does. */
  words: Pick<ServedPathWords, "enforcedBy" | "offEffect">;
  /** The signed-in member's fold. */
  effective: ReadPart<AgentRegistryEntry[]>;
  /** The raw rows: the tenant defaults. */
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  write: SwitchWrite | undefined;
  presenting: boolean;
}

const runnerReads = (by: EnforcedBy) => by === "runner" || by === "both";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The value one registry row resolves to, and the default a control would move. */
function registryValue(input: RegistryGateInput): {
  cell: GateCell;
  /** The tenant default from the raw rows, or `null` when they did not supply it. */
  current: boolean | null;
} {
  const { name, presenting, defaults, effective } = input;
  const by = input.words.enforcedBy;
  const row = defaults.data?.find((r) => r.agent_name === name) ?? null;
  const mine = effective.data?.find((r) => r.agent_name === name) ?? null;

  if (row !== null) {
    const on = row.default_enabled;
    const word = on ? "On" : "Off";
    const differs = runnerReads(by) ? row.pref_differs_from_default_count : 0;
    const stale = defaults.error !== null;
    const text =
      differs > 0
        ? presenting
          ? `${word} for the project; ${plural(differs, "member", "members")} chose otherwise`
          : `${word} · ${plural(differs, "member preference differs", "member preferences differ")}`
        : word;
    const title = presenting
      ? [
          `Switched ${on ? "on" : "off"} for the whole project.`,
          differs > 0
            ? ` ${plural(differs, "member", "members")} chose otherwise for their own machines.`
            : "",
        ].join("")
      : [
          `The tenant default of registry row ${name}: ${on ? "on" : "off"}.`,
          by === "coord"
            ? " Coord enforces the tenant default for the paths it starts; a member's own preference does not bind its enforcement."
            : by === "both"
              ? " Coord enforces this default for every standing path; each runner reads the registry for the member it is signed in as, so a member's own preference binds on that member's machines."
              : " Each runner reads the registry for the member it is signed in as: a member with no preference of their own gets this default.",
          runnerReads(by)
            ? differs > 0
              ? ` ${plural(differs, "member", "members")} recorded the opposite, and runners signed in as them follow that instead.`
              : " No member's recorded preference differs from it."
            : row.pref_count > 0
              ? ` ${plural(row.pref_count, "member has", "members have")} a recorded preference, which a change to the default does not reach and coord's enforcement does not read.`
              : "",
          stale
            ? " The latest refresh failed: this is the last good read."
            : "",
        ].join("");
    return {
      cell: {
        state: on ? "on" : "off",
        text,
        title,
        tone: "known",
        stale,
      },
      current: on,
    };
  }

  // The raw rows never answered: a fold row the member holds no preference on
  // IS the tenant default, served.
  if (defaults.data === null && mine !== null && mine.source === "default") {
    const on = mine.enabled;
    return {
      cell: {
        state: on ? "on" : "off",
        text: on ? "On" : "Off",
        title: presenting
          ? `Switched ${on ? "on" : "off"} for the whole project.`
          : [
              `The tenant default of registry row ${name}: ${on ? "on" : "off"}, read from your own registry fold, which carries the default because you recorded no preference for this row.`,
              defaults.error !== null
                ? ` The tenant defaults read failed (${defaults.error}).`
                : " The tenant defaults read has not answered.",
              runnerReads(by)
                ? " Whether any member's preference differs from it is unknown without that read."
                : "",
              effective.error !== null
                ? " The latest refresh failed: this is the last good read."
                : "",
            ].join(""),
        tone: "known",
        stale: effective.error !== null,
      },
      current: null,
    };
  }

  if (defaults.data !== null) {
    return {
      cell: unknownCell(
        "UNKNOWN",
        presenting
          ? "The coordination service lists no switch for this path."
          : `Coord's registry holds no row named ${name}, so whether this path is switched on is unknown — not on.`
      ),
      current: null,
    };
  }
  if (defaults.error === null) {
    return {
      cell: unknownCell(
        "UNKNOWN",
        presenting
          ? "The project's setting is still being read."
          : "The tenant defaults are still being read."
      ),
      current: null,
    };
  }
  const why = presenting
    ? "The project's setting could not be read."
    : [
        `The tenant defaults could not be read: ${defaults.error}.`,
        mine?.source === "user_pref"
          ? ` Your own registry fold reads this row ${mine.enabled ? "on" : "off"}, but that is your own preference, not the value coord enforces, so it is not shown as the path's state.`
          : effective.error !== null && effective.data === null
            ? ` Your own registry fold could not be read either: ${effective.error}.`
            : "",
      ].join("");
  return { cell: unknownCell("UNKNOWN", why), current: null };
}

/** Operator mode only: the signed-in member's own preference row, when recorded. */
function preferenceCell(input: RegistryGateInput): GateCell | undefined {
  if (input.presenting) return undefined;
  const mine =
    input.effective.data?.find((r) => r.agent_name === input.name) ?? null;
  if (mine === null || mine.source !== "user_pref") return undefined;
  const on = mine.enabled;
  return {
    state: on ? "on" : "off",
    text: `Your preference: ${on ? "on" : "off"}`,
    title:
      input.words.enforcedBy === "coord"
        ? `You recorded your own preference for ${input.name}. Coord's enforcement of the paths it starts reads the tenant default only, so it does not switch this path.`
        : `You recorded your own preference for ${input.name} (disposition ${mine.disposition}); runners signed in as you follow it instead of the tenant default.`,
    tone: "known",
    stale: input.effective.error !== null,
  };
}

/** Coord's value for a registry row, with a write's read-back stamped on. */
export function registryEffectiveCell(input: RegistryGateInput): GateCell {
  return withWrite(
    registryValue(input).cell,
    input.write,
    ON_OFF_TEXT,
    input.presenting
  );
}

/** Who refuses, or degrades, a spawn while a registry row is off. */
export function registryEnforcement(
  words: Pick<ServedPathWords, "enforcedBy" | "offEffect">,
  presenting: boolean
): GateEnforcement {
  switch (words.enforcedBy) {
    case "coord":
      return {
        kind: "enforce",
        text: "enforce",
        title: presenting
          ? "The coordination service starts no session on this path while the switch is off."
          : "Coord refuses to start this path's session while the switch is off.",
      };
    case "both":
      return {
        kind: "enforce",
        text: presenting
          ? "enforce (the service and each machine)"
          : "enforce (coord and each runner)",
        title: presenting
          ? "The coordination service starts no standing session while it is off, and each machine refuses one too."
          : "Coord refuses to start any standing session while it is off, and each runner refuses the standing sessions delivered to it.",
      };
    case "runner":
      return {
        kind: "enforce",
        text: presenting ? "enforce (each machine)" : "enforce (each runner)",
        title: words.offEffect
          ? presenting
            ? words.offEffect.presented
            : words.offEffect.operator
          : presenting
            ? "Each machine reads this switch before it starts such a session."
            : "Each runner reads this switch before it starts such a session; what it does while the switch is off depends on the disposition the row resolves to.",
      };
  }
}

/** A path's own registry row: the primary gate of every coord path. */
export function registryGate(input: RegistryGateInput): MatrixGate {
  const { name, presenting } = input;
  const value = registryValue(input);
  const effective = withWrite(value.cell, input.write, ON_OFF_TEXT, presenting);
  return {
    key: `registry:${name}`,
    title: "Agent registry switch",
    where: presenting
      ? "A switch in the agent registry, for the whole project."
      : `Agent registry row ${name} — the tenant default (PUT /coord/agent-registry/${name}).`,
    scope: "tenant",
    enforced: registryEnforcement(input.words, presenting),
    effective,
    verdict: onOffVerdict(effective),
    preference: preferenceCell(input),
    write:
      value.current === null
        ? null
        : { door: "registry", agentName: name, current: value.current },
    readOnly:
      value.current === null
        ? presenting
          ? "The project's setting could not be read."
          : "The tenant defaults did not answer, so the switch is not offered: flipping a value nobody read could switch it the wrong way."
        : undefined,
  };
}

/** Another row's registry switch, shown read-only on this path (a class row, or the gate-continuation kind). */
export function mirrorGate(
  input: Omit<RegistryGateInput, "write"> & { mirrorLabel: string }
): MatrixGate {
  const { name, presenting } = input;
  const effective = registryEffectiveCell({ ...input, write: undefined });
  return {
    key: `mirror:${name}`,
    title: `${input.mirrorLabel} switch`,
    where: presenting
      ? `The "${input.mirrorLabel}" switch, which has its own line.`
      : `Agent registry row ${name}, which has its own row on this matrix; it is written there.`,
    scope: "tenant",
    enforced: registryEnforcement(input.words, presenting),
    effective,
    verdict: onOffVerdict(effective),
    write: null,
    readOnly: presenting
      ? `Set on the "${input.mirrorLabel}" line.`
      : `Written on the "${input.mirrorLabel}" row.`,
    mirrorOf: name,
  };
}
