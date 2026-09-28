/**
 * maintenanceWindow — pure derivation for `/admin/coord/machine-maintenance`.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7. The page answers ONE question about ONE machine — *"can I restart
 * this machine yet, and if not, what is in the way?"* — and every word an
 * operator reads on it is derived here, in a module with no DOM and no fetch,
 * so each rule below is testable on its own (style guide R8).
 *
 * ## The nouns (plan §D1-§D3)
 *
 * - A **machine** is a workstation runner device (a `coord.devices` row, the
 *   runner at `:9876`) plus the GitHub self-hosted runner names DECLARED to be
 *   the same box. A GitHub runner name no machine claims is listed as a
 *   machine of its own, so it can still be paused. The join is declared, never
 *   inferred from names: `spaceship` and `gh-runner-spaceship-wsl@…` look alike
 *   and a wrong guess pauses the wrong box.
 * - A **maintenance window** is one mandatorily-expiring record on a machine
 *   saying which of two LEVERS are held:
 *   - `agent_work` — the workstation device's `agent` drain lane (spawns and
 *     gate continuations);
 *   - `ci` — the device's `ci` drain lane (coord's CI-node lane), a
 *     `drain-host` on the host's registrations, AND the host's routing labels
 *     removed at GitHub. All three, or it is the half-fix: coord's drain alone
 *     does not stop GitHub routing jobs by label.
 *
 * ## The rules that make the page honest (plan §D6)
 *
 * - **Unknown is never a default.** A read that did not answer, a 404 from a
 *   coord a deploy behind this console, a body in a shape this build does not
 *   read, and a verdict older than its bound all render UNKNOWN in amber —
 *   never green, never "not paused", never "no CI host".
 * - **"No CI host linked" is its own state.** A machine with no declared host
 *   renders the CI lever as "No CI host linked — link one", because rendering
 *   it as "CI: not paused" would claim GitHub cannot route work to it.
 * - **Idle must be observed after the pause.** A registration that read idle
 *   on a poll BEFORE its label came off proves nothing; coord computes that
 *   and this module only renders it.
 * - **Partial is partial.** A CI lever where two of three repos delabelled
 *   reads "CI partly paused — 1 repo still routes here", with the retry, not
 *   "paused".
 */

import type {
  HealthBadge,
  HealthStripLevel,
} from "@/components/console/HealthStrip";
import {
  MAX_DRAIN_DAYS,
  parseTimestamp,
  activeDrainLanes,
  laneHold,
  unknownDrainLanes,
  type DeviceDrainState,
  type DrainLane,
} from "./fleetDrain";
import { UNKNOWN_LABEL, formatAgeSecs } from "./runnerStatus";
import type { CoordCiRunnerRow } from "./ciRunnerMirror";

// ---------------------------------------------------------------------------
// Wire shapes (coord ⇄ web contract, Phase 4/5) — read defensively
// ---------------------------------------------------------------------------

export type MaintenanceLever = "agent_work" | "ci";
export const MAINTENANCE_LEVERS: readonly MaintenanceLever[] = [
  "agent_work",
  "ci",
];

/**
 * `hold_failed` — coord could not drain the agent lane when asked to hold it;
 * `release_failed` — it could not undrain it when asked to release. Two
 * failures with opposite next steps, so two states (coord Phase 4).
 */
export type AgentLeverState =
  | "held"
  | "released"
  | "hold_failed"
  | "release_failed";
export type CiLeverState =
  | "held"
  | "partial"
  | "released"
  | "failed"
  | "nothing_to_delabel"
  | "overridden_externally"
  | "left_paused_quarantined";

export type LabelOutcomeKind =
  | "removed"
  | "skipped_not_drawable"
  | "failed"
  | "restored"
  | "restore_failed";

/** One `(label, repo)` the window acted on. */
export interface LabelOutcome {
  label: string;
  repo: string;
  /** The GitHub runner name this row acted on — a window can span hosts. */
  host: string | null;
  /** `null` when coord sent an outcome this build does not know — UNKNOWN. */
  outcome: LabelOutcomeKind | null;
  rawOutcome: string | null;
  detail: string | null;
}

export interface AgentLever {
  /**
   * Whether the window was opened with (or later PATCHed to hold) this lever —
   * coord's `requested_levers`. `false` is "not part of this window", a
   * different fact from "released". `null` is UNKNOWN: an older coord that
   * sends no `requested_levers`, where guessing from the lever's state would
   * invent the answer.
   */
  inWindow: boolean | null;
  held: boolean;
  /** `null` = a state this build does not recognise, rendered UNKNOWN. */
  state: AgentLeverState | null;
  detail: string | null;
}

export interface CiLever {
  /** See {@link AgentLever.inWindow}. */
  inWindow: boolean | null;
  held: boolean;
  state: CiLeverState | null;
  detail: string | null;
  labels: LabelOutcome[];
}

export type PoolHealthVerdict = "host_specific" | "pool_wide" | "indeterminate";

export interface MaintenanceWindow {
  id: string;
  machineDeviceId: string | null;
  ciHost: string | null;
  state: "open" | "closed" | "expired";
  until: string;
  reason: string | null;
  /** The operator, or coord's `[redacted]` placeholder — a value, not absence. */
  openedBy: string | null;
  openedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  ciPausedAt: string | null;
  poolHealth: {
    verdict: PoolHealthVerdict | null;
    detail: string | null;
  } | null;
  levers: { agentWork: AgentLever; ci: CiLever };
}

/** A workstation machine from `GET /fleet/machines`. */
export interface MachineRow {
  kind: "machine";
  /** `?machine=` value: the device id. */
  key: string;
  deviceId: string;
  /** Coord's own hostname — never the display alias. */
  hostname: string | null;
  state: string | null;
  ciHosts: string[];
  openWindow: MaintenanceWindow | null;
  /** Coord sent an `open_window` this build could not read. */
  openWindowUnreadable: boolean;
  /**
   * The window's `id` as coord sent it, kept even when the rest of the window
   * did not parse — so an unreadable window can still be returned to service.
   */
  openWindowRawId: string | null;
}

/** A GitHub runner name no machine claims, listed as a machine of its own. */
export interface CiHostRow {
  kind: "ci_host";
  /** `?machine=` value: `ci:<host>`. */
  key: string;
  ciHost: string;
  openWindow: MaintenanceWindow | null;
  openWindowUnreadable: boolean;
  openWindowRawId: string | null;
}

export type MachineEntry = MachineRow | CiHostRow;

export type MachinesRead =
  | { state: "loading" }
  | { state: "ok"; entries: MachineEntry[]; refreshError: string | null }
  | { state: "unknown"; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

const AGENT_STATES: readonly AgentLeverState[] = [
  "held",
  "released",
  "hold_failed",
  "release_failed",
];
const CI_STATES: readonly CiLeverState[] = [
  "held",
  "partial",
  "released",
  "failed",
  "nothing_to_delabel",
  "overridden_externally",
  "left_paused_quarantined",
];
const LABEL_OUTCOMES: readonly LabelOutcomeKind[] = [
  "removed",
  "skipped_not_drawable",
  "failed",
  "restored",
  "restore_failed",
];

/**
 * Read one `MaintenanceWindow`, or `null` when it is not one.
 *
 * Strict on identity (`id`, a parseable `until`, a known `state`) and tolerant
 * on the rest: a lever state this build has not heard of is kept as `null` and
 * rendered UNKNOWN, rather than dropping the whole window — dropping it would
 * render the machine as "not in maintenance", which is the one reading that
 * must never be invented.
 */
export function parseMaintenanceWindow(v: unknown): MaintenanceWindow | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const until = str(v.until);
  const state = oneOf(v.state, ["open", "closed", "expired"] as const);
  if (
    id === null ||
    until === null ||
    parseTimestamp(until) === null ||
    state === null
  ) {
    return null;
  }
  const levers = isRecord(v.levers) ? v.levers : {};
  const agent = isRecord(levers.agent_work) ? levers.agent_work : {};
  const ci = isRecord(levers.ci) ? levers.ci : {};
  const labels: LabelOutcome[] = Array.isArray(ci.labels)
    ? ci.labels.filter(isRecord).map((l) => ({
        label: str(l.label) ?? "(unnamed label)",
        repo: str(l.repo) ?? "(unnamed repo)",
        host: str(l.host),
        outcome: oneOf(l.outcome, LABEL_OUTCOMES),
        rawOutcome: str(l.outcome),
        detail: str(l.detail),
      }))
    : [];
  const pool = isRecord(v.pool_health) ? v.pool_health : null;
  // `requested_levers` is read like the other enums: entries this build does
  // not know are dropped, and a missing or non-list value is UNKNOWN (`null`),
  // never "no lever requested".
  const requested: MaintenanceLever[] | null = Array.isArray(v.requested_levers)
    ? v.requested_levers.filter(
        (l): l is MaintenanceLever => l === "agent_work" || l === "ci"
      )
    : null;
  return {
    id,
    machineDeviceId: str(v.machine_device_id),
    ciHost: str(v.ci_host),
    state,
    until,
    reason: str(v.reason),
    openedBy: str(v.opened_by),
    openedAt: str(v.opened_at),
    closedBy: str(v.closed_by),
    closedAt: str(v.closed_at),
    ciPausedAt: str(v.ci_paused_at),
    poolHealth: pool
      ? {
          verdict: oneOf(pool.verdict, [
            "host_specific",
            "pool_wide",
            "indeterminate",
          ] as const),
          detail: str(pool.detail),
        }
      : null,
    levers: {
      agentWork: {
        inWindow: requested === null ? null : requested.includes("agent_work"),
        held: agent.held === true,
        state: oneOf(agent.state, AGENT_STATES),
        detail: str(agent.detail),
      },
      ci: {
        inWindow: requested === null ? null : requested.includes("ci"),
        held: ci.held === true,
        state: oneOf(ci.state, CI_STATES),
        detail: str(ci.detail),
        labels,
      },
    },
  };
}

function readOpenWindow(v: unknown): {
  openWindow: MaintenanceWindow | null;
  openWindowUnreadable: boolean;
  openWindowRawId: string | null;
} {
  if (v === null || v === undefined)
    return {
      openWindow: null,
      openWindowUnreadable: false,
      openWindowRawId: null,
    };
  const parsed = parseMaintenanceWindow(v);
  return parsed
    ? {
        openWindow: parsed,
        openWindowUnreadable: false,
        openWindowRawId: parsed.id,
      }
    : {
        openWindow: null,
        openWindowUnreadable: true,
        openWindowRawId: isRecord(v) ? str(v.id) : null,
      };
}

/** The id to act on for an entry's window — parsed or raw — or `null`. */
export function entryWindowId(e: MachineEntry): string | null {
  return e.openWindow?.id ?? e.openWindowRawId;
}

/** The `?machine=` value for a CI host listed on its own. */
export function ciHostKey(host: string): string {
  return `ci:${host}`;
}

/**
 * Parse `GET /fleet/machines`. Anything this build cannot read is UNKNOWN,
 * never an empty fleet — an empty `machines` list and an unreadable body look
 * identical on screen unless something says so here.
 */
export function parseMachines(payload: unknown): MachinesRead {
  if (!isRecord(payload) || !Array.isArray(payload.machines)) {
    return {
      state: "unknown",
      reason:
        "coord's machines read answered in a shape this build does not " +
        "recognise, so no machine's maintenance state is known from it",
    };
  }
  const entries: MachineEntry[] = [];
  for (const m of payload.machines) {
    if (!isRecord(m)) continue;
    const deviceId = str(m.device_id);
    if (deviceId === null) continue;
    entries.push({
      kind: "machine",
      key: deviceId,
      deviceId,
      hostname: str(m.hostname),
      state: str(m.state),
      ciHosts: Array.isArray(m.ci_hosts)
        ? m.ci_hosts.filter(
            (h): h is string => typeof h === "string" && h !== ""
          )
        : [],
      ...readOpenWindow(m.open_window),
    });
  }
  const unlinked = Array.isArray(payload.unlinked_ci_hosts)
    ? payload.unlinked_ci_hosts
    : [];
  for (const h of unlinked) {
    if (!isRecord(h)) continue;
    const ciHost = str(h.ci_host);
    if (ciHost === null) continue;
    entries.push({
      kind: "ci_host",
      key: ciHostKey(ciHost),
      ciHost,
      ...readOpenWindow(h.open_window),
    });
  }
  return { state: "ok", entries, refreshError: null };
}

/** What `?machine=` names. */
export type MachineSelection =
  | { kind: "none" }
  | { kind: "machine"; deviceId: string }
  | { kind: "ci_host"; ciHost: string };

export function parseMachineParam(
  raw: string | null | undefined
): MachineSelection {
  const v = (raw ?? "").trim();
  if (v === "") return { kind: "none" };
  if (v.startsWith("ci:")) {
    const host = v.slice(3).trim();
    return host === "" ? { kind: "none" } : { kind: "ci_host", ciHost: host };
  }
  return { kind: "machine", deviceId: v.toLowerCase() };
}

/**
 * The entry a selection names, from the read. A device machine is also found
 * through a HOST it has since been linked to, so a `ci:<host>` deep link keeps
 * working after the host is claimed by a machine.
 */
export function findMachineEntry(
  entries: readonly MachineEntry[],
  sel: MachineSelection
): MachineEntry | undefined {
  if (sel.kind === "none") return undefined;
  if (sel.kind === "machine") {
    return entries.find(
      (e) => e.kind === "machine" && e.deviceId.toLowerCase() === sel.deviceId
    );
  }
  return entries.find((e) =>
    e.kind === "ci_host"
      ? e.ciHost === sel.ciHost
      : e.ciHosts.includes(sel.ciHost)
  );
}

/** How one entry reads in the picker: coord's hostname and id, untruncated. */
export function machineEntryLabel(e: MachineEntry): {
  primary: string;
  secondary: string;
} {
  if (e.kind === "ci_host") {
    return {
      primary: e.ciHost,
      secondary: "CI host · no workstation device linked",
    };
  }
  return {
    primary: e.hostname ?? "(coord reports no hostname)",
    secondary: e.deviceId,
  };
}

/**
 * Split coord's synthetic CI-runner hostname, `gh-runner-<name>@<owner>/<repo>`
 * (`ci_runner_registrar::hostname_for`). The registrar mints it per
 * `(repo, runner_name)`; the bare `<name>` is what a machine declares.
 * `repo` is `null` for a row an older registrar wrote without the suffix.
 * Anything that is not the synthetic form returns `null`.
 */
export function parseSyntheticCiHostname(
  hostname: string
): { runnerName: string; repo: string | null } | null {
  const PREFIX = "gh-runner-";
  if (!hostname.startsWith(PREFIX)) return null;
  const rest = hostname.slice(PREFIX.length);
  const at = rest.lastIndexOf("@");
  if (at === -1) return rest === "" ? null : { runnerName: rest, repo: null };
  const runnerName = rest.slice(0, at);
  const repo = rest.slice(at + 1);
  if (runnerName === "") return null;
  return { runnerName, repo: repo === "" ? null : repo };
}

/** Map every declared CI host to the workstation device that claims it. */
export function ciHostOwners(
  entries: readonly MachineEntry[]
): Map<string, MachineRow> {
  const owners = new Map<string, MachineRow>();
  for (const e of entries) {
    if (e.kind !== "machine") continue;
    for (const h of e.ciHosts) owners.set(h, e);
  }
  return owners;
}

// ---------------------------------------------------------------------------
// Readiness (Phase 5)
// ---------------------------------------------------------------------------

export type PlaneVerdict = "safe" | "not_yet" | "unknown";

export interface CiRegistration {
  repo: string;
  runnerName: string;
  status: "idle" | "busy" | "offline" | null;
  lastSeenAt: string | null;
  observedAfterPause: boolean;
  fresh: boolean;
}

export interface WindowReadiness {
  windowId: string;
  verdict: PlaneVerdict;
  reasons: string[];
  computedAt: string;
  leversHeld: { agentWork: boolean; ci: boolean };
  agent: {
    verdict: PlaneVerdict;
    sampleAgeSecs: number | null;
    terminalSessions: number | null;
    aiSessions: number | null;
    detail: string | null;
  };
  githubCi: {
    verdict: PlaneVerdict;
    freshnessSecs: number | null;
    registrations: CiRegistration[];
    missingRepos: string[];
    detail: string | null;
  };
  ciNode: {
    verdict: PlaneVerdict;
    activeDispatches: number | null;
    detail: string | null;
  };
}

export type WindowReadinessRead =
  | { state: "no_window" }
  | { state: "loading" }
  | { state: "ok"; readiness: WindowReadiness }
  | { state: "unknown"; reason: string };

const VERDICTS: readonly PlaneVerdict[] = ["safe", "not_yet", "unknown"];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A plane verdict; anything unrecognised is `unknown` — never `safe`. */
function verdict(v: unknown): PlaneVerdict {
  return oneOf(v, VERDICTS) ?? "unknown";
}

export function parseWindowReadiness(payload: unknown): WindowReadinessRead {
  if (!isRecord(payload)) {
    return {
      state: "unknown",
      reason: "coord's readiness answer is not an object",
    };
  }
  const windowId = str(payload.window_id);
  const computedAt = str(payload.computed_at);
  if (
    windowId === null ||
    computedAt === null ||
    parseTimestamp(computedAt) === null
  ) {
    return {
      state: "unknown",
      reason: "coord's readiness answer names no window or no computation time",
    };
  }
  const planes = isRecord(payload.planes) ? payload.planes : {};
  const agent = isRecord(planes.agent) ? planes.agent : {};
  const gh = isRecord(planes.github_ci) ? planes.github_ci : {};
  const node = isRecord(planes.ci_node) ? planes.ci_node : {};
  const held = isRecord(payload.levers_held) ? payload.levers_held : {};
  return {
    state: "ok",
    readiness: {
      windowId,
      verdict: verdict(payload.verdict),
      reasons: Array.isArray(payload.reasons)
        ? payload.reasons.filter((r): r is string => typeof r === "string")
        : [],
      computedAt,
      leversHeld: { agentWork: held.agent_work === true, ci: held.ci === true },
      agent: {
        verdict: verdict(agent.verdict),
        sampleAgeSecs: num(agent.sample_age_secs),
        terminalSessions: num(agent.terminal_sessions),
        aiSessions: num(agent.ai_sessions),
        detail: str(agent.detail),
      },
      githubCi: {
        verdict: verdict(gh.verdict),
        freshnessSecs: num(gh.freshness_secs),
        registrations: Array.isArray(gh.registrations)
          ? gh.registrations.filter(isRecord).map((r) => ({
              repo: str(r.repo) ?? "(unnamed repo)",
              runnerName: str(r.runner_name) ?? "(unnamed runner)",
              status: oneOf(r.status, ["idle", "busy", "offline"] as const),
              lastSeenAt: str(r.last_seen_at),
              observedAfterPause: r.observed_after_pause === true,
              fresh: r.fresh === true,
            }))
          : [],
        missingRepos: Array.isArray(gh.missing_repos)
          ? gh.missing_repos.filter((r): r is string => typeof r === "string")
          : [],
        detail: str(gh.detail),
      },
      ciNode: {
        verdict: verdict(node.verdict),
        activeDispatches: num(node.active_dispatches),
        detail: str(node.detail),
      },
    },
  };
}

/**
 * How old a verdict may be before it is not a verdict. The page polls every
 * 15 s; a computation more than this old means reads are failing or coord is
 * serving a cached answer, and either way "safe" is no longer known.
 */
export const VERDICT_STALE_SECS = 120;

export interface VerdictHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

function planeBadge(
  key: string,
  name: string,
  v: PlaneVerdict,
  extra: string | null
): HealthBadge {
  const word =
    v === "safe" ? "safe" : v === "not_yet" ? "not yet" : UNKNOWN_LABEL;
  return {
    key,
    label: `${name} ${word}${extra ? ` · ${extra}` : ""}`,
    tone: v === "unknown" ? "muted" : v === "not_yet" ? "attention" : "default",
    "data-testid": `coord-maintenance-plane-${key}`,
  };
}

/**
 * The page's one verdict (HealthStrip, R1).
 *
 * - **Green only for coord's explicit `safe`**, computed within
 *   {@link VERDICT_STALE_SECS}. A verdict older than that is UNKNOWN.
 * - **Red when a human must act first**: no window, or a window whose levers
 *   are not held — nothing stops new work arriving, so the answer is "not
 *   yet" until someone pauses the machine.
 * - **Amber when the machine is paused and the blockers clear themselves**
 *   (a CI job finishing, a session winding down), and for every UNKNOWN.
 */
/**
 * What the verdict and the lever rows need beyond the window: the device's
 * raw drain (a drain set outside any window — an agent's `coord_fleet_drain`,
 * a legacy row — is a real hold the window does not describe), and whether
 * the last machines refresh failed (then "no window" is not known).
 */
export interface MaintenanceContext {
  /** `null` for an entry with no workstation device (a bare CI host). */
  drain: DeviceDrainState | null;
  /** The machines read's last refresh error, if its list is being kept. */
  refreshError: string | null;
}

export const NO_MAINTENANCE_CONTEXT: MaintenanceContext = {
  drain: null,
  refreshError: null,
};

/**
 * The lanes an ACTIVE drain holds at `now`, each judged by its OWN deadline
 * (coord's `by_lane`); a legacy lane-less row holds both.
 */
export function drainedLanes(
  drain: DeviceDrainState | null,
  now: number
): DrainLane[] {
  if (drain?.state !== "drained") return [];
  return activeDrainLanes(drain.entry, now);
}

/** "agent work until 18:00 — reason; CI until 20:00 — reason", per lane. */
export function drainLanesDetail(
  drain: DeviceDrainState | null,
  now: number
): string {
  if (drain?.state !== "drained") return "";
  const held = drainedLanes(drain, now).map((l) => {
    const hold = laneHold(drain.entry, l, now);
    return (
      `${lanesLabel([l])} until ${hold ? formatUntil(hold.until, now) : "an unknown time"}` +
      ` — ${hold?.reason ?? "no reason recorded"}`
    );
  });
  const unknown = unknownDrainLanes(drain.entry).map(
    (l) =>
      `${lanesLabel([l])} ${UNKNOWN_LABEL} (its per-lane entry could not be read)`
  );
  return [...held, ...unknown].join("; ");
}

/** Plain words for a set of drain lanes. */
export function lanesLabel(lanes: readonly DrainLane[]): string {
  return lanes.map((l) => (l === "agent" ? "agent work" : "CI")).join(" + ");
}

export function deriveVerdictHealth(
  window: MaintenanceWindow | null,
  read: WindowReadinessRead,
  now: number,
  ctx: MaintenanceContext = NO_MAINTENANCE_CONTEXT
): VerdictHealth {
  const unknown = (
    detail: string,
    badges: HealthBadge[] = []
  ): VerdictHealth => ({
    level: "amber",
    headline: `Restart readiness ${UNKNOWN_LABEL}`,
    detail,
    badges,
  });
  if (window === null && ctx.refreshError !== null) {
    // The list we hold says "no window", but the read that would confirm it
    // failed — a window may have opened since.
    return unknown(
      `the last machines refresh failed (${ctx.refreshError}), so whether a ` +
        "maintenance window is open is not known"
    );
  }
  if (window !== null && window.state !== "open") {
    return {
      level: "amber",
      headline: "Maintenance window expired — restoring",
      detail:
        `the window ended (${window.state}); coord is releasing what it held. ` +
        "Nothing is paused once that finishes.",
      badges: [],
    };
  }
  if (window === null || read.state === "no_window") {
    const lanes = drainedLanes(ctx.drain, now);
    const unknownLanes =
      ctx.drain?.state === "drained" ? unknownDrainLanes(ctx.drain.entry) : [];
    return {
      level: "red",
      headline: "Not yet safe to restart",
      detail:
        lanes.length > 0 || unknownLanes.length > 0
          ? // Each lane by its OWN hold — a lane that lapsed is not listed,
            // and one whose entry is unreadable says so.
            `no maintenance window is open; a drain outside any window ` +
            `${unknownLanes.length > 0 ? "is recorded:" : "holds"} ` +
            `${drainLanesDetail(ctx.drain, now)}. GitHub may still route CI ` +
            "jobs here. Prepare for restart pauses both."
          : ctx.drain?.state === "unknown"
            ? // Still "not yet" — no window means GitHub still routes CI here
              // — but "nothing is paused" would be a claim about a drain we
              // could not read.
              `no maintenance window is open, and whether a drain holds this ` +
              `machine is not known — ${ctx.drain.reason.replace(/\.\s*$/, "")}. Prepare for ` +
              "restart pauses both."
            : "nothing is paused — agent sessions and CI jobs may start here at " +
              "any moment. Prepare for restart pauses both.",
      badges: [],
    };
  }
  if (read.state === "loading") return unknown("reading the restart verdict…");
  if (read.state === "unknown") return unknown(read.reason);
  const r = read.readiness;
  const computed = parseTimestamp(r.computedAt) ?? 0;
  const ageSecs = Math.max(0, (now - computed) / 1000);
  const badges: HealthBadge[] = [
    planeBadge(
      "agent",
      "agent",
      r.agent.verdict,
      r.agent.sampleAgeSecs === null
        ? "age unknown"
        : formatAgeSecs(r.agent.sampleAgeSecs)
    ),
    planeBadge(
      "github-ci",
      "GitHub CI",
      r.githubCi.verdict,
      r.githubCi.registrations.length === 0 &&
        r.githubCi.missingRepos.length === 0
        ? null
        : `${r.githubCi.registrations.length} registration${r.githubCi.registrations.length === 1 ? "" : "s"}`
    ),
    planeBadge(
      "ci-node",
      "CI-node",
      r.ciNode.verdict,
      r.ciNode.activeDispatches === null
        ? "dispatches UNKNOWN"
        : `${r.ciNode.activeDispatches} dispatch${r.ciNode.activeDispatches === 1 ? "" : "es"}`
    ),
  ];
  const age = `computed ${formatAgeSecs(ageSecs)} ago`;
  if (ageSecs > VERDICT_STALE_SECS) {
    // A stale verdict's per-plane answers are exactly as stale as its headline.
    return unknown(
      `the last verdict was computed ${formatAgeSecs(ageSecs)} ago, older than ` +
        `${VERDICT_STALE_SECS / 60} min, so it is not shown as a verdict`,
      [
        planeBadge("agent", "agent", "unknown", null),
        planeBadge("github-ci", "GitHub CI", "unknown", null),
        planeBadge("ci-node", "CI-node", "unknown", null),
      ]
    );
  }
  const reasons = r.reasons.length > 0 ? r.reasons.join(" · ") : null;
  if (r.verdict === "safe") {
    return {
      level: "green",
      headline: "Safe to restart",
      detail: reasons ? `${reasons} · ${age}` : age,
      badges,
    };
  }
  if (r.verdict === "unknown") {
    return unknown(`${reasons ?? "coord could not decide"} · ${age}`, badges);
  }
  const leversIdle = !r.leversHeld.agentWork || !r.leversHeld.ci;
  return {
    level: leversIdle ? "red" : "amber",
    headline: "Not yet safe to restart",
    detail: `${reasons ?? "coord gave no reason"} · ${age}`,
    badges,
  };
}

// ---------------------------------------------------------------------------
// Lever helpers (the lever rows' status table lives in `maintenanceStatus.ts`)
// ---------------------------------------------------------------------------

/** A deadline as an operator reads it: `18:00`, or `Sep 30 18:00` if not today. */
export function formatUntil(untilIso: string, now: number): string {
  const ms = parseTimestamp(untilIso);
  if (ms === null) return "an unknown time";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return time;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date} ${time}`;
}

/** How many `(label, repo)` pairs still route here after a delabel attempt. */
export function stillRoutingCount(labels: readonly LabelOutcome[]): number {
  // A repo whose outcome coord did not send in a form this build reads is
  // UNKNOWN — it may still route here, so it counts, never as delabelled.
  return new Set(
    labels
      .filter((l) => l.outcome === "failed" || l.outcome === null)
      .map((l) => l.repo)
  ).size;
}

/** The distinct repos a label outcome list names, in order. */
export function labelRepos(labels: readonly LabelOutcome[]): string[] {
  return [...new Set(labels.map((l) => l.repo))];
}

/** Whether a window's label rows span more than one host (then show `host`). */
export function labelsSpanHosts(labels: readonly LabelOutcome[]): boolean {
  return new Set(labels.map((l) => l.host).filter((h) => h !== null)).size > 1;
}

/** Plain words for one `(label, repo)` outcome. */
export function labelOutcomeLabel(o: LabelOutcome): string {
  switch (o.outcome) {
    case "removed":
      return "label removed";
    case "skipped_not_drawable":
      return "skipped — not drawable here";
    case "failed":
      return "removal failed — still routes here";
    case "restored":
      return "label restored";
    case "restore_failed":
      return "restore failed — coord keeps retrying";
    case null:
      return `${UNKNOWN_LABEL} (${o.rawOutcome ?? "no outcome"})`;
  }
}

/** Whether a lever row's Pause/Resume button pauses (true) or resumes (false). */
export function leverActionPauses(
  entry: MachineEntry,
  lever: MaintenanceLever
): boolean {
  const w = entry.openWindow;
  if (w === null) return true;
  const l = lever === "agent_work" ? w.levers.agentWork : w.levers.ci;
  // A partial or failed hold is re-HELD (the retry), not released; a failed
  // RELEASE is retried as a release.
  if (
    l.state === "partial" ||
    l.state === "failed" ||
    l.state === "hold_failed"
  )
    return true;
  if (l.state === "release_failed") return false;
  return !l.held;
}

// ---------------------------------------------------------------------------
// The Prepare-for-restart dialog
// ---------------------------------------------------------------------------

export interface MaintenanceForm {
  untilLocal: string;
  reason: string;
  levers: { agent_work: boolean; ci: boolean };
}

export type MaintenanceFormCheck =
  | { ok: true; untilIso: string; levers: MaintenanceLever[] }
  | { ok: false; message: string };

/**
 * Validate the dialog. PURE.
 *
 * Mirrors coord's checks on a window — a non-blank reason, a future `until`
 * within `MAX_DRAIN_DAYS` (coord caps a window with the drain's constant) —
 * plus the lever rules. Coord's check is the one that counts; this one exists
 * so the operator is told what is wrong before a round trip and the submit
 * control can be honestly disabled.
 */
export function validateMaintenanceForm(
  form: MaintenanceForm,
  entry: MachineEntry,
  now: number
): MaintenanceFormCheck {
  const levers = MAINTENANCE_LEVERS.filter((l) => form.levers[l]);
  if (levers.length === 0) {
    return { ok: false, message: "Choose at least one of Agent work and CI." };
  }
  if (entry.kind === "ci_host" && form.levers.agent_work) {
    return {
      ok: false,
      message:
        "This CI host is linked to no workstation runner, so there is no agent " +
        "work to pause — untick Agent work, or link the host to its machine first.",
    };
  }
  if (form.reason.trim() === "") {
    return {
      ok: false,
      message:
        "A reason is required — it is what the audit row and the other " +
        "operators' alert will say.",
    };
  }
  if (form.untilLocal.trim() === "") {
    return {
      ok: false,
      message:
        "An end time is required. A pause with no deadline is how a machine — " +
        "or a GitHub label — silently leaves the fleet forever.",
    };
  }
  const untilMs = Date.parse(form.untilLocal);
  if (!Number.isFinite(untilMs)) {
    return {
      ok: false,
      message: "That end time is not a time this build can read.",
    };
  }
  if (untilMs <= now) {
    return { ok: false, message: "The end time must be in the future." };
  }
  if (untilMs > now + MAX_DRAIN_DAYS * 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      message:
        `The end time must be within ${MAX_DRAIN_DAYS} days — coord rejects a ` +
        "longer one. Open a new window when this one ends instead.",
    };
  }
  return { ok: true, untilIso: new Date(untilMs).toISOString(), levers };
}

export interface PreviewLine {
  key: string;
  /** What will happen. */
  action: string;
  /** The identity it acts on — rendered untruncated, in mono. */
  target: string;
}

/**
 * Every target the window will touch, named by coord's own identities, never
 * the display alias (plan §5 "Wrong machine"). After a window opens, the
 * per-`(label, repo)` outcomes it returned are listed too.
 */
export function buildMaintenancePreview(
  entry: MachineEntry,
  levers: readonly MaintenanceLever[],
  opened: MaintenanceWindow | null
): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const hosts = entry.kind === "machine" ? entry.ciHosts : [entry.ciHost];
  if (entry.kind === "machine") {
    const lanes = [
      levers.includes("agent_work") ? "agent" : null,
      levers.includes("ci") ? "ci" : null,
    ].filter((l): l is string => l !== null);
    if (lanes.length > 0) {
      lines.push({
        key: "device",
        action: `Drain lane${lanes.length === 1 ? "" : "s"} ${lanes.join(" + ")} on workstation device`,
        target: `${entry.deviceId}${entry.hostname ? ` (${entry.hostname})` : ""}`,
      });
    }
  }
  if (levers.includes("ci")) {
    if (hosts.length === 0) {
      lines.push({
        key: "no-host",
        action:
          "No CI host linked — GitHub is NOT told anything, so it may still route jobs to this machine",
        target: "—",
      });
    }
    for (const host of hosts) {
      lines.push({
        key: `host-${host}`,
        action:
          "Drain every registration of, and remove the routing labels at GitHub from, CI host",
        target: host,
      });
    }
    if (opened) {
      for (const l of opened.levers.ci.labels) {
        lines.push({
          key: `label-${l.label}-${l.repo}-${l.host ?? ""}`,
          action: `Label \`${l.label}\` — ${labelOutcomeLabel(l)}`,
          target:
            labelsSpanHosts(opened.levers.ci.labels) && l.host
              ? `${l.repo} on ${l.host}`
              : l.repo,
        });
      }
    } else if (hosts.length > 0) {
      lines.push({
        key: "labels-pending",
        action:
          "Which labels on which repos: coord enumerates the host's drawable routing labels when the window opens; each (label, repo) outcome is listed here after",
        target: hosts.join(", "),
      });
    }
  }
  return lines;
}

/** A write's refusal, split so the page can branch on the code. */
export interface MaintenanceError {
  code: string | null;
  message: string;
  poolKey: string | null;
  /**
   * The machine a `ci_host_linked_to_machine` refusal names, when coord
   * says which (`machine_device_id` / `device_id`), so the page can offer
   * to select it.
   */
  machineDeviceId: string | null;
}

/**
 * The next step for a refusal whose code calls for one — shown under coord's
 * own message. `null` for codes whose message already says it all.
 */
export function maintenanceErrorGuidance(e: MaintenanceError): string | null {
  switch (e.code) {
    case "ci_host_linked_to_machine":
      return "This CI host is linked to a machine — open the window on that machine instead, so one window pauses both.";
    case "window_busy":
      return "Another change to this window is in progress — retry shortly.";
    case "window_changed":
      return "The window changed under you — the page has re-read it; check the levers and retry.";
    case "invalid_request":
      return "Coord refused the request as invalid — correct it and retry.";
    default:
      return null;
  }
}

/** Codes after which the page should re-read the window before a retry. */
export function errorWantsReread(e: MaintenanceError): boolean {
  return (
    e.code === "window_changed" ||
    e.code === "window_busy" ||
    e.code === "window_already_open" ||
    e.code === "ci_host_linked_to_machine"
  );
}

/**
 * Read a failed write. The web proxy nests coord's typed
 * `{"error", "message"}` under `detail`; both levels are unwrapped, and a
 * FastAPI validation list is flattened into one sentence.
 */
export function describeMaintenanceError(
  status: number,
  body: string
): MaintenanceError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      code: null,
      message: body.trim()
        ? `HTTP ${status} — ${body.trim()}`
        : `HTTP ${status}`,
      poolKey: null,
      machineDeviceId: null,
    };
  }
  if (!isRecord(parsed)) {
    return {
      code: null,
      message: `HTTP ${status}`,
      poolKey: null,
      machineDeviceId: null,
    };
  }
  const inner = isRecord(parsed.detail) ? parsed.detail : parsed;
  if (Array.isArray(parsed.detail)) {
    const msgs = parsed.detail
      .filter(isRecord)
      .map((d) => str(d.msg))
      .filter((m): m is string => m !== null);
    return {
      code: "validation_error",
      message: `HTTP ${status} — ${msgs.join("; ") || "the request was refused"}`,
      poolKey: null,
      machineDeviceId: null,
    };
  }
  const code = str(inner.error);
  const message =
    str(inner.message) ??
    str(inner.detail) ??
    (typeof parsed.detail === "string" ? parsed.detail : null) ??
    `HTTP ${status}`;
  return {
    code,
    message,
    poolKey: str(inner.pool_key),
    machineDeviceId: str(inner.machine_device_id) ?? str(inner.device_id),
  };
}

// ---------------------------------------------------------------------------
// The Dev Ops card badge
// ---------------------------------------------------------------------------

export type MaintenanceBadge =
  | { state: "in_maintenance"; label: string; title: string }
  /** A window whose levers did not all land as asked — someone must look. */
  | { state: "attention"; label: string; title: string }
  /** The window ended and coord is putting things back. */
  | { state: "expired"; label: string; title: string }
  /** No window, but a raw drain holds the device. */
  | { state: "drained_outside"; label: string; title: string }
  | { state: "in_service" }
  | { state: "unknown"; label: string; title: string };

/**
 * The one line a machine card (and the picker) shows about maintenance (plan
 * §D7): "In maintenance until 18:00 · CI + agents", "Agent work paused until
 * 18:00", "CI paused until 18:00" — and, where a lever did not land as asked,
 * which way it did not ("CI partly paused", "CI label restored by hand"),
 * rather than the calm line. A lever state this build cannot read makes the
 * whole badge UNKNOWN. With no window, an active raw drain reads "Drained
 * (outside a window)"; a drain read that failed reads UNKNOWN, never "in
 * service".
 */
export function maintenanceBadge(
  window: MaintenanceWindow | null,
  unreadable: boolean,
  now: number,
  drain: DeviceDrainState | null = null
): MaintenanceBadge {
  const unknown = (title: string): MaintenanceBadge => ({
    state: "unknown",
    label: `maintenance ${UNKNOWN_LABEL}`,
    title,
  });
  if (unreadable) {
    return unknown(
      "coord reported a maintenance window this build could not read"
    );
  }
  if (window === null) {
    const lanes = drainedLanes(drain, now);
    if (lanes.length > 0 && drain?.state === "drained") {
      return {
        state: "drained_outside",
        label: "Drained (outside a window)",
        title: `a drain outside any maintenance window holds ${drainLanesDetail(drain, now)}`,
      };
    }
    if (
      drain?.state === "drained" &&
      unknownDrainLanes(drain.entry).length > 0
    ) {
      return unknown(`a drain is recorded but ${drainLanesDetail(drain, now)}`);
    }
    if (drain?.state === "unknown") return unknown(drain.reason);
    return { state: "in_service" };
  }
  const title = `${window.reason ?? "no reason recorded"} — opened by ${window.openedBy ?? "an unrecorded operator"}`;
  if (window.state !== "open") {
    return {
      state: "expired",
      label: "Maintenance window expired — restoring",
      title,
    };
  }
  const a = window.levers.agentWork;
  const c = window.levers.ci;
  if (
    (a.inWindow !== false && a.state === null) ||
    (c.inWindow !== false && c.state === null)
  ) {
    return unknown("coord sent a lever state this build does not recognise");
  }
  const until = formatUntil(window.until, now);
  const agentSuffix = a.held ? " · agents paused" : "";
  if (c.inWindow !== false) {
    switch (c.state) {
      case "partial":
        return {
          state: "attention",
          label: `CI partly paused until ${until}${agentSuffix}`,
          title,
        };
      case "overridden_externally":
        return {
          state: "attention",
          label: `CI label restored by hand${agentSuffix}`,
          title,
        };
      case "failed":
        return {
          state: "attention",
          label: `CI pause failed${agentSuffix}`,
          title,
        };
      case "left_paused_quarantined":
        return {
          state: "attention",
          label: `CI left paused — quarantined${agentSuffix}`,
          title,
        };
      default:
        break;
    }
  }
  if (a.inWindow !== false && a.state === "hold_failed") {
    return { state: "attention", label: "Agent work pause failed", title };
  }
  if (a.inWindow !== false && a.state === "release_failed") {
    return { state: "attention", label: "Agent work release failed", title };
  }
  if (a.held && c.held)
    return {
      state: "in_maintenance",
      label: `In maintenance until ${until} · CI + agents`,
      title,
    };
  if (a.held)
    return {
      state: "in_maintenance",
      label: `Agent work paused until ${until}`,
      title,
    };
  if (c.held)
    return {
      state: "in_maintenance",
      label: `CI paused until ${until}`,
      title,
    };
  return { state: "in_service" };
}

/**
 * THE badge for one machine entry — the picker and the Dev Ops card both call
 * this, so they cannot disagree.
 *
 * - `drain` is the entry's resolved raw drain (a CI host has none; it is
 *   ignored there).
 * - `refreshError` is the machines read's last refresh error while its list is
 *   kept. Then "no window" rests on stale evidence — a window may have opened
 *   since — and reads UNKNOWN, UNLESS a successfully read raw drain holds the
 *   machine: that is independent, current evidence, and it wins.
 */
export function machineEntryBadge(
  e: MachineEntry,
  now: number,
  drain: DeviceDrainState | null,
  refreshError: string | null
): MaintenanceBadge {
  const d = e.kind === "machine" ? drain : null;
  if (
    refreshError !== null &&
    e.openWindow === null &&
    !e.openWindowUnreadable
  ) {
    if (d?.state === "drained") return maintenanceBadge(null, false, now, d);
    return {
      state: "unknown",
      label: `maintenance ${UNKNOWN_LABEL}`,
      title: `the last machines refresh failed (${refreshError}), so whether a window is open is not known`,
    };
  }
  return maintenanceBadge(e.openWindow, e.openWindowUnreadable, now, d);
}

/** The page's deep link for an entry. */
export function maintenancePageHref(key: string): string {
  return `/admin/coord/machine-maintenance?machine=${encodeURIComponent(key)}`;
}

/**
 * What the Overview's CI-infrastructure card for a registration should link
 * to: the machine that declared its host, or the host on its own.
 */
export function maintenanceKeyForCiHostname(
  hostname: string,
  owners: Map<string, MachineRow>
): string | null {
  const parsed = parseSyntheticCiHostname(hostname);
  if (!parsed) return null;
  return owners.get(parsed.runnerName)?.key ?? ciHostKey(parsed.runnerName);
}

/**
 * The host's registrations from coord's CI-runner mirror, for a machine with
 * NO open window — the readiness route is per window, but what is running on
 * the machine is worth showing before anything is paused. Nothing here is
 * "observed after a pause" (there is none), and the mirror only serves rows
 * inside coord's freshness window, so every row it returns is fresh.
 */
export function registrationsFromMirror(
  rows: Iterable<CoordCiRunnerRow>,
  hosts: readonly string[]
): CiRegistration[] {
  const out: CiRegistration[] = [];
  for (const row of rows) {
    const parsed = parseSyntheticCiHostname(row.hostname);
    if (!parsed || !hosts.includes(parsed.runnerName)) continue;
    const status = row.ci_runner_status;
    out.push({
      repo: parsed.repo ?? "(repo not recorded on this row)",
      runnerName: parsed.runnerName,
      status:
        status === "idle" || status === "busy" || status === "offline"
          ? status
          : null,
      lastSeenAt: row.last_seen_at,
      observedAfterPause: false,
      fresh: true,
    });
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo));
}

// ---------------------------------------------------------------------------
// The Dev Ops Overview join — machine card ↔ maintenance window ↔ CI host
// ---------------------------------------------------------------------------

/** One declared CI host of a workstation, counted from the merged CI map. */
export interface LinkedCiHostSummary {
  host: string;
  registrations: number;
  busy: number;
}

/**
 * Count a declared host's registrations in the Overview's merged CI map.
 *
 * This is the join that replaced the Overview's hostname match (plan §D2): a
 * mirror row is keyed `gh-runner-<name>@<repo>`, which never equals a
 * workstation's hostname, so the old join could not pair a machine with the
 * GitHub runner it hosts. The declared `machine_ci_hosts` row can.
 */
export function summarizeLinkedCiHosts(
  hosts: readonly string[],
  ciRunners: Record<string, { status: string }>
): LinkedCiHostSummary[] {
  return hosts.map((host) => {
    let registrations = 0;
    let busy = 0;
    for (const [hostname, info] of Object.entries(ciRunners)) {
      if (parseSyntheticCiHostname(hostname)?.runnerName !== host) continue;
      registrations += 1;
      if (info.status === "busy") busy += 1;
    }
    return { host, registrations, busy };
  });
}

/** What a Dev Ops machine card shows about maintenance. */
export interface MachineMaintenanceView {
  badge: MaintenanceBadge;
  /** The page's deep link for this card, or `null` when it names no machine. */
  href: string | null;
  /** The declared CI hosts (workstation cards only); `null` when not known. */
  linkedCiHosts: LinkedCiHostSummary[] | null;
}

/**
 * Resolve one card's maintenance view from the page's ONE machines read.
 *
 * `deviceId` is the card's matched coord device; `hostname` its group key,
 * which for a CI-infrastructure card is the synthetic `gh-runner-…` name. A
 * card that is neither has no machine to name and gets `null` — the absence
 * of a JOIN, which the card renders as nothing rather than as "in service".
 */
export function resolveMachineMaintenance(
  read: MachinesRead,
  card: { deviceId: string | undefined; hostname: string },
  ciRunners: Record<string, { status: string }>,
  now: number,
  drain: DeviceDrainState | null = null
): MachineMaintenanceView | null {
  const synthetic = parseSyntheticCiHostname(card.hostname);
  if (!card.deviceId && !synthetic) return null;
  if (read.state !== "ok") {
    return {
      badge: {
        state: "unknown",
        label: `maintenance ${UNKNOWN_LABEL}`,
        title:
          read.state === "loading"
            ? "reading coord's machines…"
            : `${read.reason} — this says nothing about whether the machine is paused`,
      },
      href: card.deviceId
        ? maintenancePageHref(card.deviceId)
        : synthetic
          ? maintenancePageHref(ciHostKey(synthetic.runnerName))
          : null,
      linkedCiHosts: null,
    };
  }
  if (synthetic) {
    const owner = ciHostOwners(read.entries).get(synthetic.runnerName);
    const own =
      owner ??
      read.entries.find(
        (e): e is CiHostRow =>
          e.kind === "ci_host" && e.ciHost === synthetic.runnerName
      );
    if (!own) {
      // In neither a machine's `ci_hosts` nor `unlinked_ci_hosts`: coord's
      // list says nothing about this host, which is not "in service".
      return {
        badge: {
          state: "unknown",
          label: `maintenance ${UNKNOWN_LABEL}`,
          title: "coord's machine list does not name this CI host",
        },
        href: maintenancePageHref(ciHostKey(synthetic.runnerName)),
        linkedCiHosts: null,
      };
    }
    return {
      badge: machineEntryBadge(own, now, null, read.refreshError),
      href: maintenancePageHref(own.key),
      linkedCiHosts: null,
    };
  }
  const deviceId = (card.deviceId ?? "").toLowerCase();
  const machine = read.entries.find(
    (e): e is MachineRow =>
      e.kind === "machine" && e.deviceId.toLowerCase() === deviceId
  );
  if (!machine) {
    return {
      badge: {
        state: "unknown",
        label: `maintenance ${UNKNOWN_LABEL}`,
        title: "coord's machine list does not name this device",
      },
      href: maintenancePageHref(card.deviceId ?? ""),
      linkedCiHosts: null,
    };
  }
  return {
    badge: machineEntryBadge(machine, now, drain, read.refreshError),
    href: maintenancePageHref(machine.key),
    linkedCiHosts: summarizeLinkedCiHosts(machine.ciHosts, ciRunners),
  };
}
