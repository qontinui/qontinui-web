/**
 * Machine dispatch roles — every rule about what a body MEANS.
 *
 * Plan `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6
 * (minimal). A dispatch role is the operator's standing choice of which kind
 * of work coord may send a machine (§D1):
 *
 * | role        | `ci` lane | `agent` lane |
 * |-------------|-----------|--------------|
 * | `workhorse` | open      | open         |
 * | `bench`     | closed    | closed       |
 * | `ci_node`   | open      | closed       |
 *
 * Pure and DOM-free so each rule is pinned by `fleetDispatchRoles.test.ts`.
 * `FleetRolesSection.tsx` renders it; `useFleetDispatchRoles.ts` is transport.
 *
 * ## Three honesty rules this module carries
 *
 * 1. **Unassigned is not Workhorse, and unknown is neither.** No row behaves
 *    as a workhorse (§D5), so the page says "Unassigned — behaves as
 *    Workhorse", never just "Workhorse"; and a read that failed is UNKNOWN,
 *    never "every machine unassigned" (`[policy: verification-and-evidence
 *    unknown-must-not-render-as-a-default]`).
 * 2. **Role and drain are rendered SEPARATELY (§D2).** A lane coord reports
 *    `closed_by_role` may ALSO be drained; coord reports the role there
 *    because it is the standing fact, and serves the role layer and the drain
 *    layer separately beside it — both are rendered.
 * 3. **A role assigned to a host with no coord device is "assigned, not yet
 *    registered"** (plan §0a) — it applies the moment a runner registers under
 *    that name, so rendering it as unassigned would be false.
 *
 * The wire shape is coord's `DispatchRolesResponse` / `MachineView`
 * (`qontinui-coord` `dispatch_role_routes.rs`, plan Phase 3). An unrecognised
 * role or lane value is surfaced as such, never coerced to a default.
 */

export const DISPATCH_ROLES = ["workhorse", "bench", "ci_node"] as const;
export type DispatchRole = (typeof DISPATCH_ROLES)[number];

export const LANES = ["agent", "ci"] as const;
export type Lane = (typeof LANES)[number];

export const ROLE_LABEL: Record<DispatchRole, string> = {
  workhorse: "Workhorse",
  bench: "Bench",
  ci_node: "CI node",
};

export const LANE_LABEL: Record<Lane, string> = {
  agent: "Sessions",
  ci: "CI",
};

/** §D1 — the whole semantics of a role. A DEFINITION, not a verdict. */
export const ROLE_OPENS: Record<DispatchRole, Record<Lane, boolean>> = {
  workhorse: { agent: true, ci: true },
  bench: { agent: false, ci: false },
  ci_node: { agent: false, ci: true },
};

export function isDispatchRole(v: unknown): v is DispatchRole {
  return (
    typeof v === "string" && (DISPATCH_ROLES as readonly string[]).includes(v)
  );
}

/** The DRAIN layer of one lane, as coord serves it — separate from the role. */
export type LaneDrain =
  | { state: "none" }
  | {
      state: "drained";
      until: string | null;
      reason: string | null;
      drainedBy: string | null;
    }
  /** Some, not all, of a CI host's runner registrations are drained. */
  | {
      state: "partial";
      drainedDevices: number | null;
      totalDevices: number | null;
    }
  | { state: "unknown" };

/**
 * Coord's role layer of one lane. `not_registered` = the machine has no device
 * row, so there is no lane state to show (coord serves it rather than an
 * `open` computed over an empty device list).
 */
export type LaneRoleLayer = "open" | "closed" | "unknown" | "not_registered";

/** One lane of one machine: coord's role layer and drain layer (§D2). */
export interface LaneView {
  /** Coord's composed verdict, verbatim (`open` / `closed_by_role` /
   * `closed_by_drain` / `unknown` / `not_registered`), or `null` when absent. */
  effective: string | null;
  /** The ROLE layer alone. */
  role: LaneRoleLayer;
  drain: LaneDrain;
}

/** A lane with no state because the machine has no device row. */
export function laneNotRegistered(l: LaneView): boolean {
  return l.effective === "not_registered" || l.role === "not_registered";
}

/** The lane coord serves for a machine with no device row. */
const NOT_REGISTERED_LANE: LaneView = {
  effective: "not_registered",
  role: "not_registered",
  drain: { state: "none" },
};

export interface RoleSuggestion {
  role: DispatchRole;
  memTotalBytes: number | null;
  sampleAgeSecs: number | null;
}

export interface RoleMachine {
  /** Coord's `machine_key` — the row's stable identity. */
  key: string;
  deviceId: string | null;
  ciHostName: string | null;
  name: string;
  /** `null` = no row (unassigned). */
  role: DispatchRole | null;
  /** A role value this build does not know, verbatim — never coerced. */
  unrecognisedRole: string | null;
  /** `false` for `registration: assigned_not_registered`. */
  registered: boolean;
  /**
   * `kind: ci_host` — no workstation runner, so coord refuses `workhorse` for
   * it (`no_agent_host`, §D4). Offered as a disabled option with the reason.
   */
  hostOnly: boolean;
  heartbeatFresh: boolean | null;
  suggestion: RoleSuggestion | null;
  /** `null` when coord served no lane state for this machine. */
  lanes: Record<Lane, LaneView> | null;
  /**
   * Live sessions that started before the role's last change (§D9) — coord's
   * upper bound. `null` unless coord reports `pre_change_sessions.state:
   * known`.
   */
  sessionsBeforeChange: number | null;
  /**
   * Coord could not count the pre-change sessions (`state: unknown`). Rendered
   * as such — never as zero (§D9: "safe to rebuild" is never implied).
   */
  sessionsUnknown: boolean;
  /** Live sessions with no recorded start — counted nowhere above. */
  sessionsStartUnrecorded: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string | null;
  version: number | null;
}

export type DispatchRolesRead =
  | { state: "loading" }
  | { state: "unknown"; reason: string }
  | {
      state: "known";
      machines: RoleMachine[];
      /** Machines coord left out of the read (not seen in its window). */
      omitted: number | null;
      /** CI runner registrations coord could not name. */
      unidentifiable: number | null;
      /**
       * Coord's device read reached its row cap (`roster_truncated`): the
       * least-recently-seen device rows MAY have been cut, so the list may be
       * incomplete and a role whose machine was cut reads "assigned, not yet
       * registered". `null` when coord does not report it (a build predating
       * the field) — not read as "whole".
       */
      rosterTruncated: boolean | null;
      /**
       * Coord's read-level note (e.g. a failed drain/role read: dispatch is
       * failing CLOSED), or that the roles table is absent so no write can
       * land yet. `null` when coord said nothing.
       */
      notice: string | null;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseDrainLayer(v: unknown): LaneDrain {
  if (!isRecord(v)) return { state: "unknown" };
  switch (v.state) {
    case "none":
      return { state: "none" };
    case "drained":
      return {
        state: "drained",
        until: str(v.until),
        reason: str(v.reason),
        drainedBy: str(v.drained_by),
      };
    case "partial":
      return {
        state: "partial",
        drainedDevices: num(v.drained_devices),
        totalDevices: num(v.total_devices),
      };
    default:
      return { state: "unknown" };
  }
}

/** One lane: `{effective, role, drain}`. Anything unrecognised is unknown. */
export function parseLane(v: unknown): LaneView {
  if (!isRecord(v)) {
    return { effective: null, role: "unknown", drain: { state: "unknown" } };
  }
  const role: LaneRoleLayer =
    v.role === "open" || v.role === "closed" || v.role === "not_registered"
      ? v.role
      : "unknown";
  return { effective: str(v.effective), role, drain: parseDrainLayer(v.drain) };
}

/** One machine row, or `null` when it names no machine at all. */
export function parseRoleMachine(v: unknown): RoleMachine | null {
  if (!isRecord(v)) return null;
  const deviceId = str(v.device_id);
  const ciHostName = str(v.ci_host_name);
  if (deviceId === null && ciHostName === null) return null;

  // `role` is this tenant's row (`RoleView`) or null when unassigned.
  const roleRow = isRecord(v.role) ? v.role : null;
  const rawRole = roleRow ? roleRow.dispatch_role : null;
  let role: DispatchRole | null = null;
  let unrecognisedRole: string | null = null;
  if (isDispatchRole(rawRole)) role = rawRole;
  else if (rawRole !== null && rawRole !== undefined)
    unrecognisedRole = String(rawRole);
  // A role field that is neither null nor an object is a shape we do not know.
  if (v.role !== null && v.role !== undefined && roleRow === null)
    unrecognisedRole = String(v.role);

  const hostOnly = v.kind === "ci_host";
  const sug = v.suggestion;
  // Coord's RAM rule may suggest `workhorse` for a CI host, which coord would
  // refuse (`no_agent_host`); an unusable suggestion is not offered.
  const suggestion: RoleSuggestion | null =
    isRecord(sug) &&
    isDispatchRole(sug.dispatch_role) &&
    !(hostOnly && sug.dispatch_role === "workhorse")
      ? {
          role: sug.dispatch_role,
          memTotalBytes: num(sug.mem_total_bytes),
          sampleAgeSecs: num(sug.sample_age_secs),
        }
      : null;

  // A machine with no device rows (assigned, not registered) has no lane
  // state: coord serves each lane as `not_registered`. Registration decides,
  // not what the lane keys say — a coord that served a lane computed over an
  // EMPTY device list (`open`) would otherwise contradict the assigned role.
  const registered = v.registration !== "assigned_not_registered";
  const lanes = !registered
    ? { agent: NOT_REGISTERED_LANE, ci: NOT_REGISTERED_LANE }
    : isRecord(v.lanes) && ("agent" in v.lanes || "ci" in v.lanes)
      ? { agent: parseLane(v.lanes.agent), ci: parseLane(v.lanes.ci) }
      : null;

  const pre = isRecord(v.pre_change_sessions) ? v.pre_change_sessions : null;

  const key =
    str(v.machine_key) ??
    (deviceId !== null
      ? `device:${deviceId.toLowerCase()}`
      : `host:${(ciHostName as string).toLowerCase()}`);

  return {
    key,
    deviceId,
    ciHostName,
    name: str(v.name) ?? ciHostName ?? (deviceId as string),
    role,
    unrecognisedRole,
    registered,
    hostOnly,
    heartbeatFresh:
      typeof v.heartbeat_fresh === "boolean" ? v.heartbeat_fresh : null,
    suggestion,
    lanes,
    sessionsBeforeChange: pre && pre.state === "known" ? num(pre.count) : null,
    sessionsUnknown: pre !== null && pre.state === "unknown",
    sessionsStartUnrecorded: pre ? num(pre.start_unrecorded) : null,
    updatedAt: roleRow ? str(roleRow.updated_at) : null,
    updatedBy: roleRow ? str(roleRow.updated_by) : null,
    reason: roleRow ? str(roleRow.reason) : null,
    version: roleRow ? num(roleRow.version) : null,
  };
}

/** Parse `GET /coord/fleet/dispatch-roles` (through the web proxy). */
export function parseDispatchRoles(body: unknown): DispatchRolesRead {
  if (!isRecord(body)) {
    return {
      state: "unknown",
      reason:
        "Coord's dispatch-role read came back in a shape this console does " +
        "not recognise, so no machine's role could be read from it.",
    };
  }
  // Coord's own UNKNOWN: `machines` is null, never [] — so is ours.
  if (body.state === "unknown") {
    return {
      state: "unknown",
      reason: `Coord could not read the roles: ${
        str(body.detail) ?? "no detail given"
      }.`,
    };
  }
  if (body.state !== "known" || !Array.isArray(body.machines)) {
    return {
      state: "unknown",
      reason:
        "Coord's dispatch-role read came back in a shape this console does " +
        "not recognise, so no machine's role could be read from it.",
    };
  }
  const machines = body.machines
    .map(parseRoleMachine)
    .filter((m): m is RoleMachine => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    state: "known",
    machines,
    // Coord counts what it leaves out rather than dropping it silently; so
    // must we (`silent-empty-is-unknown`).
    omitted: num(body.older_machines_omitted),
    unidentifiable: num(body.unidentifiable_ci_runner_rows),
    rosterTruncated:
      typeof body.roster_truncated === "boolean" ? body.roster_truncated : null,
    notice:
      [
        str(body.detail),
        body.roles_table === "absent"
          ? "Coord's roles table is not provisioned on this database yet: " +
            "every machine is unassigned and a role write will be refused."
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" ") || null,
  };
}

/** The role column's words. Unassigned names what it BEHAVES as (§D5). */
export function describeRole(m: RoleMachine): string {
  if (m.unrecognisedRole !== null)
    return `Unrecognised role "${m.unrecognisedRole}"`;
  if (m.role === null) {
    // Coord's role layer is fleet-effective: a co-tenant's role may close a
    // lane this tenant's (absent) row would open.
    const closedElsewhere = m.lanes
      ? LANES.filter(
          (l) => !(l === "agent" && m.hostOnly) && m.lanes![l].role === "closed"
        )
      : [];
    return closedElsewhere.length === 0
      ? "Unassigned — behaves as Workhorse"
      : `Unassigned here — another tenant's role closes ${closedElsewhere
          .map((l) => (l === "agent" ? "sessions" : "CI"))
          .join(" and ")}`;
  }
  const base = ROLE_LABEL[m.role];
  return m.registered ? base : `${base} — assigned, not yet registered`;
}

/**
 * What coord will do after the change, in words — the confirm step's sentence
 * (e.g. "dell-2020 → CI node: coord will send no sessions here; CI stays
 * open").
 */
export function describeRoleEffect(
  name: string,
  from: DispatchRole | null,
  to: DispatchRole,
  /** A CI host has no workstation runner: it never took sessions. */
  hostOnly = false,
  /**
   * Coord's role layer per lane, when known — the FLEET-effective role, i.e.
   * the most restrictive across every tenant bound to the machine. Used for
   * "before", and to see that another tenant's role keeps a lane closed
   * "after". Omit it when this tenant's own row is unreadable (that row may be
   * the closure being replaced).
   */
  servedRoleLayer?: Partial<Record<Lane, LaneRoleLayer>>
): string {
  const own = from === null ? ROLE_OPENS.workhorse : ROLE_OPENS[from];
  const after = ROLE_OPENS[to];
  const clause = (lane: Lane): string => {
    const what = lane === "agent" ? "sessions" : "CI";
    if (lane === "agent" && hostOnly)
      return "still no sessions (no workstation runner)";
    // Any other value (e.g. `not_registered`, no lane state) falls through to
    // this tenant's own row below.
    const served = servedRoleLayer?.[lane];
    // Closed by the fleet while this tenant's own role opens it: another
    // tenant's role closes the lane, and it stays closed whatever we pick.
    if (after[lane] && served === "closed" && own[lane])
      return `${what} stay closed by another tenant's role`;
    const before: boolean | null =
      served === "open"
        ? true
        : served === "closed"
          ? false
          : served === "unknown"
            ? null
            : own[lane];
    if (after[lane]) {
      if (before === true)
        return lane === "agent" ? "sessions stay open" : "CI stays open";
      if (before === false) return `coord may send ${what} here again`;
      return `${what} open (current state unknown)`;
    }
    if (before === false)
      return lane === "agent" ? "still no sessions" : "still no CI";
    return lane === "agent"
      ? "coord will send no sessions here"
      : "coord will send no CI here";
  };
  return `${name} → ${ROLE_LABEL[to]}: ${clause("agent")}; ${clause("ci")}.`;
}

/** Refusal codes that mean "you are not an operator here". */
const ADMIN_REFUSAL_CODES = [
  "not_coord_tenant_admin",
  "admin_required",
  "operator_principal_required",
];

/**
 * The capacity class coord's `last_open_lane` guard weighed for a lane:
 * `workstations` (sessions, and the runner's own CI-node dispatch) or
 * `github_runner_hosts` (GitHub `runs-on` routing). A string this build does
 * not know is kept verbatim.
 */
export type LaneCapacity =
  | "workstations"
  | "github_runner_hosts"
  | (string & {});

/** The capacity in words, as the Force prompt names it. */
export function describeCapacity(c: LaneCapacity | null): string {
  if (c === "workstations") return "workstation";
  if (c === "github_runner_hosts") return "GitHub runner host";
  if (c === null) return "machine";
  return `machine of capacity "${c}"`;
}

/** A refusal coord returned for a role write, as the dialog renders it. */
export type RoleWriteRefusal =
  | {
      kind: "last_open_lane";
      lanes: Lane[];
      /** Per refused lane, the capacity coord weighed (`null` = not served). */
      capacities: Partial<Record<Lane, LaneCapacity | null>>;
      message: string;
    }
  | { kind: "no_agent_host"; message: string }
  | { kind: "not_admin"; message: string }
  | {
      kind: "other";
      message: string;
      /** The write's outcome is unknown: it may have been applied. */
      mayHaveApplied?: boolean;
    };

/**
 * Turn a non-2xx role write into a readable refusal. The web proxy passes
 * coord's typed refusal through as a structured object — at the top level or
 * under `detail`, depending on the deployed error envelope — so both are read.
 */
export function describeRoleWriteError(
  status: number | null,
  body: string
): RoleWriteRefusal {
  if (status === null) {
    // A timeout or a dropped connection can happen AFTER the request was
    // sent, so this cannot claim nothing changed.
    return {
      kind: "other",
      mayHaveApplied: true,
      message:
        `The request failed before an answer arrived (${body}). The change ` +
        "may or may not have been applied — the list re-reads to show what " +
        "coord now holds.",
    };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // fall through with `parsed = null`
  }
  const inner = isRecord(parsed)
    ? isRecord(parsed.detail)
      ? parsed.detail
      : parsed
    : null;
  const code =
    (inner && str(inner.error)) ??
    (isRecord(parsed) && typeof parsed.detail === "string"
      ? parsed.detail
      : null);
  // Coord puts its prose in `detail` (a string inside the refusal object).
  // The deployed web error handler splices a dict refusal to the TOP level and
  // fills `message` with the dict's Python repr when it has no `message` of
  // its own (`middleware/error_handler.py`), so `message` is used only when it
  // is not that repr.
  const message = inner ? str(inner.message) : null;
  const coordMsg = inner
    ? (str(inner.detail) ??
      (message && !message.trimStart().startsWith("{") ? message : null))
    : null;

  if (code === "last_open_lane") {
    // Coord serves `lanes: [{lane, capacity, remaining, offline_only}, …]`.
    const lanes: Lane[] = [];
    const capacities: Partial<Record<Lane, LaneCapacity | null>> = {};
    const clauses: string[] = [];
    const offlineOnly: string[] = [];
    if (inner && Array.isArray(inner.lanes)) {
      for (const l of inner.lanes) {
        const name = isRecord(l) ? l.lane : null;
        if (!isRecord(l) || (name !== "agent" && name !== "ci")) continue;
        if (lanes.includes(name)) continue;
        lanes.push(name);
        const capacity = str(l.capacity);
        capacities[name] = capacity;
        clauses.push(
          `no heartbeat-fresh ${describeCapacity(capacity)} would take ${
            name === "agent" ? "agent sessions" : "CI"
          }`
        );
        if (l.offline_only === true && Array.isArray(l.remaining))
          offlineOnly.push(
            `${name === "agent" ? "sessions" : "CI"}: only offline ${l.remaining
              .filter((x): x is string => typeof x === "string")
              .join(", ")}`
          );
      }
    }
    return {
      kind: "last_open_lane",
      lanes,
      capacities,
      message:
        `Coord refused: after this change ` +
        (clauses.length === 0
          ? "no heartbeat-fresh machine would take one of its lanes"
          : clauses.join(", and ")) +
        "." +
        (offlineOnly.length > 0
          ? ` Other machines that would keep it open are offline (${offlineOnly.join("; ")}).`
          : "") +
        ` Force applies it anyway (the forced change is audited).`,
    };
  }
  if (code === "no_agent_host") {
    return {
      kind: "no_agent_host",
      message:
        "Coord refused: this machine has no workstation runner, so it cannot " +
        "host agent sessions and cannot be a Workhorse. Choose CI node or " +
        `Bench.${coordMsg ? ` Coord: ${coordMsg}` : ""}`,
    };
  }
  if (code === "tenant_not_resolved" || /tenant_not_resolved/.test(body)) {
    return {
      kind: "other",
      message:
        "No coord tenant is selected for your account, so the write was not " +
        "sent. Pick a tenant and retry. Nothing was changed.",
    };
  }
  if (
    // Coord also answers 403 `device_not_in_tenant`, which is not an
    // authorization failure of the operator — it falls through to the generic
    // arm with its own code. Any other 403 (including the web gate's, whose
    // code the deployed envelope rewrites to a generic one) is the gate.
    (code !== null && ADMIN_REFUSAL_CODES.includes(code)) ||
    (status === 403 && code !== "device_not_in_tenant")
  ) {
    return {
      kind: "not_admin",
      message:
        "Only an operator (an administrator of this tenant) may change a " +
        "machine's role. Nothing was changed.",
    };
  }
  if (status === 404) {
    return {
      kind: "other",
      message:
        "Coord serves no dispatch-role write on this deployment (404) — it " +
        "is a deploy behind this console. Nothing was changed.",
    };
  }
  // Only the web proxy's own connect failure proves coord never saw the
  // write; any other 502 (a gateway dropping an answer) or 504 may follow a
  // commit.
  if (status === 502 && /coord is not reachable/.test(body)) {
    return {
      kind: "other",
      message: "Coord could not be reached. Nothing was changed.",
    };
  }
  if (status === 502 || status === 504) {
    return {
      kind: "other",
      mayHaveApplied: true,
      message:
        "The answer was lost on the way back; the change MAY have been " +
        "applied — the list re-reads to show what coord now holds.",
    };
  }
  const parts = [`HTTP ${status}`];
  if (code) parts.push(code);
  if (coordMsg) parts.push(coordMsg);
  // A 500 can follow a failed commit or a failure after one; a 503
  // (`schema_pending`, an unavailable backend) is refused before any write.
  if (status >= 500 && status !== 503) {
    return {
      kind: "other",
      mayHaveApplied: true,
      message:
        `${parts.join(" — ")}. The change MAY have been applied — the list ` +
        "re-reads to show what coord now holds.",
    };
  }
  return { kind: "other", message: parts.join(" — ") };
}

/** One effect coord says a role change did NOT apply (`effects_not_applied`). */
export interface EffectNotApplied {
  effect: string;
  detail: string | null;
  /** The plan phase coord says will apply it — when the gap closes. */
  planPhase: number | null;
}

const EFFECT_LABEL: Record<string, string> = {
  github_routing_labels: "GitHub routing labels were not changed",
  ci_node_config_enabled: "the runner's own CI-node switch was not changed",
  linked_ci_host_fanout:
    "the role does not reach this machine's linked CI hosts — they keep their own roles",
};

/** Parse `effects_not_applied`. `null` when coord served none (not "none"). */
export function parseEffectsNotApplied(v: unknown): EffectNotApplied[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(isRecord)
    .map((e) => ({
      effect: str(e.effect) ?? "unnamed",
      detail: str(e.detail),
      planPhase: num(e.plan_phase),
    }))
    .filter((e) => e.effect !== "unnamed" || e.detail !== null);
}

/** One effect in words: a known effect's label, else coord's own words. */
export function describeEffectNotApplied(e: EffectNotApplied): string {
  // Coord's own detail is kept: it differs by direction (a change that opens
  // CI vs one that closes it) and by machine kind, which no fixed label can.
  const label = EFFECT_LABEL[e.effect] ?? e.effect;
  const phase = e.planPhase !== null ? ` [plan phase ${e.planPhase}]` : "";
  return `${label}${phase}${e.detail ? ` (coord: ${e.detail})` : ""}`;
}

/**
 * Coord's `live_sessions_on_machine` in words. `null` from coord means NOT
 * MEASURED (a CI-host write, or an unreadable count) — never zero.
 * `undefined` = the field was not served at all.
 */
export function describeLiveSessions(
  v: number | "unknown" | undefined
): string | null {
  if (v === undefined) return null;
  if (v === "unknown") return "live sessions on it: unknown";
  return `${v} live session${v === 1 ? "" : "s"} on it now`;
}

/** Validate the confirm form. Returns an error sentence or `null`. */
export function validateRoleForm(input: {
  reason: string;
  ciHostName?: string | null;
}): string | null {
  if (input.ciHostName !== undefined) {
    const h = (input.ciHostName ?? "").trim();
    if (h === "") return "Enter the machine's host name (e.g. dell-2020).";
    if (!/^[\x21-\x7e]+$/.test(h))
      return "A host name is printable ASCII with no spaces.";
    // Coord names a CI host by the bare GitHub runner name: the
    // `gh-runner-` prefix the device list shows is NOT part of it, and a row
    // keyed on it would never attach to a registration.
    if (/^gh-runner-/i.test(h))
      return (
        `Use the runner name without the gh-runner- prefix ` +
        `(e.g. ${h.replace(/^gh-runner-/i, "")}).`
      );
  }
  if (input.reason.trim() === "")
    return "A reason is required — coord records it on the role's version row.";
  return null;
}

/** Format a byte count as GiB with one decimal, for the RAM column. */
export function formatGiB(bytes: number | null): string | null {
  if (bytes === null) return null;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
