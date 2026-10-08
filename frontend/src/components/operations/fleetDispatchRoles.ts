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
 *    because it is the standing fact. So the drain column says "not reported"
 *    in that case rather than "clear".
 * 3. **A role assigned to a host with no coord device is "assigned, not yet
 *    registered"** (plan §0a) — it applies the moment a runner registers under
 *    that name, so rendering it as unassigned would be false.
 *
 * The parse is deliberately lenient about field NAMES (`dispatch_role` or
 * `role`, `name` or `hostname`) because coord's Phase 3 read route and this
 * console are built in parallel; it is strict about VALUES — an unrecognised
 * role or lane state is surfaced as such, never coerced to a default.
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

/** Coord's effective state for one lane, as served. */
export type LaneDrain =
  | { state: "clear" }
  | { state: "held"; until: string | null; reason: string | null }
  /** Coord did not say — e.g. the lane is closed by the role, which coord
   * reports in preference to a drain (§D2). */
  | { state: "not_reported" }
  | { state: "unknown" };

export interface LaneView {
  /** The served lane state string, verbatim, or `null` when absent. */
  served: string | null;
  drain: LaneDrain;
}

export interface RoleHistoryEntry {
  role: DispatchRole | null;
  at: string | null;
  by: string | null;
  reason: string | null;
}

export interface RoleSuggestion {
  role: DispatchRole;
  memTotalBytes: number | null;
  sampleAgeSecs: number | null;
}

export interface RoleMachine {
  /** Stable row key: `device:<uuid>` or `host:<lower name>`. */
  key: string;
  deviceId: string | null;
  ciHostName: string | null;
  name: string;
  /** `null` = no row (unassigned). */
  role: DispatchRole | null;
  /** A role value this build does not know, verbatim — never coerced. */
  unrecognisedRole: string | null;
  /** `false` for a host-name row coord has no device for yet. */
  registered: boolean;
  /**
   * The machine has no workstation runner, so coord refuses `workhorse` for it
   * (`no_agent_host`, §D4). Offered as a disabled option with the reason.
   */
  hostOnly: boolean;
  suggestion: RoleSuggestion | null;
  /** `null` when coord served no lane state for this machine. */
  lanes: Record<Lane, LaneView> | null;
  trustTier: string | null;
  linkedHosts: string[];
  /** Sessions coord placed before the current role took effect (§D9). */
  sessionsBeforeChange: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string | null;
  /** `null` when coord serves no history. */
  history: RoleHistoryEntry[] | null;
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

function parseDrainObject(v: unknown): LaneDrain | null {
  if (v === null) return { state: "clear" };
  if (!isRecord(v)) return null;
  return {
    state: "held",
    until: str(v.until),
    reason: str(v.reason),
  };
}

/**
 * One lane. Accepts a bare state string or `{state, drain?}`. `drain` (when
 * served) wins over what the state string implies, because it is the
 * separately-reported fact §D2 asks for.
 */
export function parseLane(v: unknown): LaneView {
  const served = typeof v === "string" ? v : isRecord(v) ? str(v.state) : null;
  const explicit =
    isRecord(v) && "drain" in v ? parseDrainObject(v.drain) : null;
  if (explicit) return { served, drain: explicit };
  switch (served) {
    case "open":
      return { served, drain: { state: "clear" } };
    case "closed_by_drain":
      return {
        served,
        drain: {
          state: "held",
          until: isRecord(v) ? str(v.until) : null,
          reason: isRecord(v) ? str(v.reason) : null,
        },
      };
    case "closed_by_role":
      return { served, drain: { state: "not_reported" } };
    default:
      return { served, drain: { state: "unknown" } };
  }
}

function parseHistory(v: unknown): RoleHistoryEntry[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isRecord).map((h) => {
    const r = h.dispatch_role ?? h.role;
    return {
      role: isDispatchRole(r) ? r : null,
      at: str(h.updated_at) ?? str(h.at) ?? str(h.changed_at),
      by: str(h.updated_by) ?? str(h.by) ?? str(h.changed_by),
      reason: str(h.reason),
    };
  });
}

/** One machine row, or `null` when it names no machine at all. */
export function parseRoleMachine(v: unknown): RoleMachine | null {
  if (!isRecord(v)) return null;
  const deviceId = str(v.device_id) ?? str(v.machine_device_id) ?? null;
  const ciHostName = str(v.ci_host_name);
  if (deviceId === null && ciHostName === null) return null;

  const rawRole = v.dispatch_role ?? v.role;
  let role: DispatchRole | null = null;
  let unrecognisedRole: string | null = null;
  if (isDispatchRole(rawRole)) role = rawRole;
  else if (
    rawRole !== null &&
    rawRole !== undefined &&
    rawRole !== "unassigned"
  )
    unrecognisedRole = String(rawRole);

  const sug = v.suggestion ?? v.suggested_role;
  let suggestion: RoleSuggestion | null = null;
  if (isDispatchRole(sug)) {
    suggestion = { role: sug, memTotalBytes: null, sampleAgeSecs: null };
  } else if (isRecord(sug) && isDispatchRole(sug.role ?? sug.dispatch_role)) {
    suggestion = {
      role: (sug.role ?? sug.dispatch_role) as DispatchRole,
      memTotalBytes: num(sug.mem_total_bytes),
      sampleAgeSecs: num(sug.sample_age_secs) ?? num(sug.age_secs),
    };
  }

  const lanesRaw = v.lanes ?? v.lane_state;
  const lanes = isRecord(lanesRaw)
    ? { agent: parseLane(lanesRaw.agent), ci: parseLane(lanesRaw.ci) }
    : null;

  const registered =
    typeof v.registered === "boolean" ? v.registered : deviceId !== null;
  const hostOnly =
    typeof v.agent_host === "boolean"
      ? !v.agent_host
      : typeof v.has_agent_host === "boolean"
        ? !v.has_agent_host
        : deviceId === null;

  const name =
    str(v.name) ?? str(v.hostname) ?? ciHostName ?? (deviceId as string);

  return {
    key:
      deviceId !== null
        ? `device:${deviceId.toLowerCase()}`
        : `host:${(ciHostName as string).toLowerCase()}`,
    deviceId,
    ciHostName,
    name,
    role,
    unrecognisedRole,
    registered,
    hostOnly,
    suggestion,
    lanes,
    trustTier: str(v.trust_tier),
    linkedHosts: Array.isArray(v.linked_hosts)
      ? v.linked_hosts
          .map((h) =>
            isRecord(h) ? (str(h.ci_host_name) ?? str(h.name)) : str(h)
          )
          .filter((h): h is string => h !== null)
      : [],
    sessionsBeforeChange:
      num(v.sessions_before_change) ?? num(v.pre_change_sessions),
    updatedAt: str(v.updated_at),
    updatedBy: str(v.updated_by),
    reason: str(v.reason),
    history: parseHistory(v.history ?? v.versions),
  };
}

/** Parse `GET /coord/fleet/dispatch-roles` (through the web proxy). */
export function parseDispatchRoles(body: unknown): DispatchRolesRead {
  const list = Array.isArray(body)
    ? body
    : isRecord(body)
      ? (body.machines ?? body.roles)
      : undefined;
  if (!Array.isArray(list)) {
    return {
      state: "unknown",
      reason:
        "Coord's dispatch-role read came back in a shape this console does " +
        "not recognise, so no machine's role could be read from it.",
    };
  }
  const machines = list
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
  to: DispatchRole
): string {
  const before = from === null ? ROLE_OPENS.workhorse : ROLE_OPENS[from];
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

/** A refusal coord returned for a role write, as the dialog renders it. */
export type RoleWriteRefusal =
  | { kind: "last_open_lane"; lane: Lane | null; message: string }
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
    return {
      kind: "other",
      message: `The request did not reach the server (${body}). Nothing was changed.`,
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
  const coordMsg = inner ? (str(inner.message) ?? str(inner.hint)) : null;

  if (code === "last_open_lane") {
    const laneRaw = inner ? str(inner.lane) : null;
    const lane = laneRaw === "agent" || laneRaw === "ci" ? laneRaw : null;
    const what =
      lane === "agent"
        ? "agent sessions"
        : lane === "ci"
          ? "CI"
          : "one of its lanes";
    return {
      kind: "last_open_lane",
      lane,
      message:
        `Coord refused: after this change no heartbeat-fresh machine would ` +
        `take ${what}. Force applies it anyway (the forced change is ` +
        `audited).${coordMsg ? ` Coord: ${coordMsg}` : ""}`,
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
  if (
    status === 403 ||
    code === "not_coord_tenant_admin" ||
    code === "operator_required" ||
    code === "admin_required"
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
  if (status === 502 || status === 504) {
    return {
      kind: "other",
      message:
        status === 502
          ? "Coord could not be reached. Nothing was changed."
          : "Coord's answer was lost; the change MAY have been applied — the " +
            "list re-reads to show what coord now holds.",
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
