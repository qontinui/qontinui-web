/**
 * nextStepGates — the two next-step settings that gate each dispatch arm:
 * the tenant's autonomy level for its decision domain (written through
 * `PUT /coord/next-step-settings`) and the domain's fleet flag (coord's
 * environment; read-only here).
 *
 * The autonomy gate's value carries coord's OWN three-valued verdict
 * (`effective_state`) for the domain, and when coord says `unknown` it names
 * the conjunct this read cannot see (`effective_unknown_reason`) — shown to
 * the operator as coord's own words. The page adds no verdict of its own.
 */

import type {
  AutonomyLevel,
  NextStepDomain,
  NextStepSettings,
} from "@/lib/api/operations/coordSettings";
import {
  unknownCell,
  withWrite,
  type GateCell,
  type MatrixGate,
  type ReadPart,
  type SwitchWrite,
} from "./spawnPathGates";

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
      return presenting
        ? `${whose}: unknown — it also depends on another setting`
        : `${whose}: unknown — it depends on a setting this read cannot see`;
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
        ? presenting
          ? "The project's autonomy settings could not be read."
          : `Coord's next-step settings could not be read: ${read.error}.`
        : presenting
          ? "The project's autonomy settings are still being read."
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

function autonomyTitle(d: NextStepDomain, presenting: boolean): string {
  if (presenting) {
    return "Auto lets the coordination service start the session on its own; Guidance only frames the next step for a person; Always escalate hands it to a person.";
  }
  const fallback =
    d.autonomy_level_source === "code_fallback"
      ? "; no policy row matched, so this is coord's built-in default and the resolver escalates"
      : "";
  const unseen =
    d.effective_state === "unknown" && d.effective_unknown_reason
      ? ` Coord names what it cannot see: ${d.effective_unknown_reason}.`
      : "";
  return `${d.label}: ${d.autonomy_level} (resolved from the ${d.resolved_from} band${fallback}). ${verdictWords(d.effective_state, false)}.${unseen}`;
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
  const value: GateCell =
    unread !== null || !d
      ? (unread ?? unknownCell("UNKNOWN"))
      : {
          state: d.autonomy_level,
          text: `${AUTONOMY_LEVEL_LABEL[d.autonomy_level] ?? d.autonomy_level} · ${verdictWords(d.effective_state, presenting)}`,
          title: autonomyTitle(d, presenting),
          tone: "known",
          stale: read.error !== null,
        };
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
      title: presenting
        ? "The coordination service starts this path's session only at the Auto level; below it, it frames the step or hands it to a person."
        : "Coord starts this path's session only at the Auto level; below it, it frames or escalates instead.",
    },
    effective: withWrite(value, write, levelText, presenting),
    write:
      d && canEdit
        ? {
            door: "next_step",
            domain,
            level: d.autonomy_level,
            builtInDefault: d.autonomy_level_source === "code_fallback",
          }
        : null,
    readOnly: !d
      ? presenting
        ? "The setting could not be read."
        : "The setting could not be read, so it is not offered."
      : canEdit
        ? undefined
        : presenting
          ? "Set by an administrator of the project."
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
  } else if (
    d.master_flag_enabled === true ||
    d.master_flag_enabled === false
  ) {
    effective = {
      state: d.master_flag_enabled ? "on" : "off",
      text: d.master_flag_enabled ? "On" : "Off",
      title: presenting
        ? `This deployment setting is ${d.master_flag_enabled ? "on" : "off"}.`
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
      title: presenting
        ? "Read when the coordination service starts; changing it is a redeploy, not a setting on this page."
        : "Read from coord's environment when it starts; changing it is a redeploy of coord, not a console write.",
    },
    effective,
    write: null,
    readOnly: presenting
      ? "Changed only by redeploying the coordination service."
      : "Set in coord's deployment environment; this console cannot write it.",
  };
}
