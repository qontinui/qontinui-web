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

/** One lane of one machine: coord's role layer and drain layer (§D2). */
export interface LaneView {
  /** Coord's composed verdict, verbatim (`open` / `closed_by_role` /
   * `closed_by_drain` / `unknown`), or `null` when absent. */
  effective: string | null;
  /** The ROLE layer alone. */
  role: "open" | "closed" | "unknown";
  drain: LaneDrain;
}

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
  | { state: "known"; machines: RoleMachine[] };

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
  const role = v.role === "open" || v.role === "closed" ? v.role : "unknown";
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
  // state. Coord still serves both lane keys for it, with a role layer of
  // `open` computed over an EMPTY device list — rendering that would
  // contradict the assigned role, so registration decides, not key presence.
  const lanes =
    v.registration !== "assigned_not_registered" &&
    isRecord(v.lanes) &&
    ("agent" in v.lanes || "ci" in v.lanes)
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
    registered: v.registration !== "assigned_not_registered",
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
  return { state: "known", machines };
}

/** The role column's words. Unassigned names what it BEHAVES as (§D5). */
export function describeRole(m: RoleMachine): string {
  if (m.unrecognisedRole !== null)
    return `Unrecognised role "${m.unrecognisedRole}"`;
  if (m.role === null) return "Unassigned — behaves as Workhorse";
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
   * Coord's role layer per lane, when known — the FLEET-effective role
   * (a co-tenant's Bench, or an unparseable stored role read as Bench), which
   * is what "before" really was. Falls back to this tenant's `from`.
   */
  servedRoleLayer?: Partial<Record<Lane, "open" | "closed" | "unknown">>
): string {
  const was = from === null ? ROLE_OPENS.workhorse : ROLE_OPENS[from];
  const layered = (lane: Lane): boolean => {
    const r = servedRoleLayer?.[lane];
    return r === "open" ? true : r === "closed" ? false : was[lane];
  };
  const before = {
    agent: hostOnly ? false : layered("agent"),
    ci: layered("ci"),
  };
  const after = ROLE_OPENS[to];
  const clause = (lane: Lane): string => {
    const what = lane === "agent" ? "sessions" : "CI";
    if (after[lane] && before[lane])
      return lane === "agent" ? "sessions stay open" : "CI stays open";
    if (after[lane]) return `coord may send ${what} here again`;
    if (before[lane])
      return lane === "agent"
        ? "coord will send no sessions here"
        : "coord will send no CI here";
    return lane === "agent" ? "still no sessions" : "still no CI";
  };
  return `${name} → ${ROLE_LABEL[to]}: ${clause("agent")}; ${clause("ci")}.`;
}

/** Refusal codes that mean "you are not an operator here". */
const ADMIN_REFUSAL_CODES = [
  "not_coord_tenant_admin",
  "admin_required",
  "operator_principal_required",
];

/** A refusal coord returned for a role write, as the dialog renders it. */
export type RoleWriteRefusal =
  | { kind: "last_open_lane"; lanes: Lane[]; message: string }
  | { kind: "no_agent_host"; message: string }
  | { kind: "not_admin"; message: string }
  | { kind: "other"; message: string };

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
    // Coord serves `lanes: [{lane, remaining, offline_only}, …]`.
    const lanes: Lane[] = [];
    if (inner && Array.isArray(inner.lanes)) {
      for (const l of inner.lanes) {
        const name = isRecord(l) ? l.lane : null;
        if ((name === "agent" || name === "ci") && !lanes.includes(name))
          lanes.push(name);
      }
    }
    const what =
      lanes.length === 0
        ? "one of its lanes"
        : lanes
            .map((l) => (l === "agent" ? "agent sessions" : "CI"))
            .join(" or ");
    return {
      kind: "last_open_lane",
      lanes,
      message:
        `Coord refused: after this change no heartbeat-fresh machine would ` +
        `take ${what}. Force applies it anyway (the forced change is ` +
        `audited).`,
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
      message:
        "The answer was lost on the way back; the change MAY have been " +
        "applied — the list re-reads to show what coord now holds.",
    };
  }
  const parts = [`HTTP ${status}`];
  if (code) parts.push(code);
  if (coordMsg) parts.push(coordMsg);
  return { kind: "other", message: parts.join(" — ") };
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
