/**
 * continueModel — the pure half of the Continue dialog: the effort it starts
 * at, the wire body of `POST /subprojects/{id}/spawn`, and the sentences for
 * every way the request can end.
 *
 * Plan `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D8 and Phase 6. The dialog is `ContinueDialog.tsx`; this module has no React
 * in it, so every rule below is pinned by `continueModel.test.ts`.
 *
 * Three rules carry the plan's honesty clauses:
 *
 * - **The default effort is the served one, or says why it is not.** The
 *   `implementation` profile of the tenant's `agent_playbook/spawn-effort-profiles`
 *   document is the fleet's answer to "at what effort does merge-bound work
 *   run" (served policy `production-and-cost` `spawn-effort-profiles`). When
 *   it cannot be read the default is `high`, and the dialog says which read
 *   failed — the fallback is never presented as the profile.
 * - **Requested is not applied.** coord echoes the effort it was ASKED for;
 *   nothing reports the effort a runner started the session at until plan
 *   `2026-10-27-spawn-time-effort-and-ultracode-profiles-for-every-fleet-spawn-path`
 *   Phase 8, so the applied effort reads `not reported` — never the requested
 *   value (served policy `ux-priorities`
 *   `a-status-signal-must-observe-the-state-it-names`).
 * - **A refusal is coord's typed answer, worded.** The subproject codes are
 *   read here; every placement code `/agents/spawn` already returns is read by
 *   `spawnPlacement.ts`'s `describeSpawnRefusal`, so the two dialogs cannot
 *   word one refusal two ways.
 */

import {
  describeSpawnRefusal,
  extractCoordRefusal,
  type SpawnRefusalKind,
} from "@/components/admin/coord/spawnPlacement";
import type {
  SubprojectEffort,
  SubprojectSpawnRequest,
  SubprojectSpawnResponse,
} from "@/lib/api/operations/coordSubprojects";

/** The effort levels coord accepts (the contract's enum), least first. */
export const EFFORTS: readonly SubprojectEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** The default when the served profile cannot be read (the plan's brief). */
export const FALLBACK_EFFORT: SubprojectEffort = "high";

/** Where the default comes from. */
export const EFFORT_PROFILES_DOCUMENT = {
  kind: "agent_playbook",
  name: "spawn-effort-profiles",
} as const;

/** Continue's work is merge-bound implementation, so it starts at that
 *  profile (the playbook's own classification of "a plan phase"). */
export const CONTINUE_PROFILE = "implementation";

export function isEffort(value: unknown): value is SubprojectEffort {
  return (
    typeof value === "string" && (EFFORTS as readonly string[]).includes(value)
  );
}

/** The effort the dialog opens at, and where it came from. */
export type EffortDefault =
  | {
      source: "profile";
      effort: SubprojectEffort;
      ultracode: boolean;
      profile: string;
    }
  | {
      source: "fallback";
      effort: SubprojectEffort;
      ultracode: false;
      /** Why the profile could not be used — said beside the select. */
      reason: string;
    };

function fallback(reason: string): EffortDefault {
  return {
    source: "fallback",
    effort: FALLBACK_EFFORT,
    ultracode: false,
    reason,
  };
}

/** The served document's body: the operator door serves the document flat,
 *  coord's agent door wraps it in `document`. Both are coord's own shapes. */
function bodyOf(doc: unknown): string | null {
  if (typeof doc !== "object" || doc === null) return null;
  const flat = (doc as { body?: unknown }).body;
  if (typeof flat === "string") return flat;
  const wrapped = (doc as { document?: { body?: unknown } }).document?.body;
  return typeof wrapped === "string" ? wrapped : null;
}

/**
 * The `implementation` profile out of the served playbook's ONE fenced
 * `spawn-effort` block — the same block the runner reads, held to the same
 * rules the document states for it: exactly one block, JSON, `version: 1`.
 * Anything else falls back to `high` and names what was wrong.
 */
export function effortDefaultFromProfiles(doc: unknown): EffortDefault {
  const body = bodyOf(doc);
  if (body === null)
    return fallback("the effort profiles document came back without a body");
  const blocks = [...body.matchAll(/```spawn-effort[^\n]*\n([\s\S]*?)```/g)];
  if (blocks.length === 0)
    return fallback("the effort profiles document has no spawn-effort block");
  if (blocks.length > 1)
    return fallback(
      `the effort profiles document has ${blocks.length} spawn-effort blocks, and only one is read`
    );
  const raw = blocks[0]?.[1];
  if (raw === undefined)
    return fallback("the effort profiles document has no spawn-effort block");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback(
      "the effort profiles' spawn-effort block is not valid JSON"
    );
  }
  if (typeof parsed !== "object" || parsed === null)
    return fallback("the effort profiles' spawn-effort block is not an object");
  const block = parsed as { version?: unknown; profiles?: unknown };
  if (block.version !== 1)
    return fallback(
      `the effort profiles' spawn-effort block is version ${String(block.version)}, and this page reads version 1`
    );
  const profiles =
    typeof block.profiles === "object" && block.profiles !== null
      ? (block.profiles as Record<string, unknown>)
      : {};
  const profile = Object.prototype.hasOwnProperty.call(
    profiles,
    CONTINUE_PROFILE
  )
    ? profiles[CONTINUE_PROFILE]
    : undefined;
  if (typeof profile !== "object" || profile === null)
    return fallback(
      `the effort profiles define no ${CONTINUE_PROFILE} profile`
    );
  const { effort, ultracode } = profile as {
    effort?: unknown;
    ultracode?: unknown;
  };
  if (!isEffort(effort))
    return fallback(
      `the ${CONTINUE_PROFILE} profile's effort "${String(effort)}" is not one of ${EFFORTS.join(", ")}`
    );
  if (ultracode !== undefined && typeof ultracode !== "boolean")
    return fallback(
      `the ${CONTINUE_PROFILE} profile's ultracode is not true or false`
    );
  return {
    source: "profile",
    effort,
    ultracode: ultracode === true,
    profile: CONTINUE_PROFILE,
  };
}

/** The default when the document read itself failed. */
export function effortDefaultAfterReadFailure(detail: string): EffortDefault {
  return fallback(`the effort profiles could not be read (${detail})`);
}

/** The line beside the effort select. */
export function describeEffortDefault(d: EffortDefault): string {
  return d.source === "profile"
    ? `Default ${d.effort}${d.ultracode ? " with ultracode" : ""}: the ${d.profile} profile of agent_playbook/spawn-effort-profiles.`
    : `Default ${d.effort}: ${d.reason}.`;
}

/** Repos as typed: commas, spaces or new lines; trimmed; first one wins. */
export function parseRepoList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const repo = part.trim();
    if (repo && !out.includes(repo)) out.push(repo);
  }
  return out;
}

/** The device ids coord's `Uuid` accepts (as `spawnModel.ts` `UUID_RE`). */
const UUID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

export function isDeviceId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * The wire body (the contract's `SubprojectSpawnRequest`). Every optional key
 * is OMITTED when empty, never sent as `""` or `[]`: no device is coord's pool
 * placement (the "next available runner"), no repos is coord deriving them from
 * the members (D8), and no addendum is the brief as coord composes it.
 * `ultracode` is always sent, so the request states it either way.
 */
export function buildContinueRequestBody(input: {
  effort: SubprojectEffort;
  ultracode: boolean;
  deviceId: string;
  repos: readonly string[];
  addendum: string;
}): SubprojectSpawnRequest {
  const device = input.deviceId.trim();
  const addendum = input.addendum.trim();
  return {
    effort: input.effort,
    ultracode: input.ultracode,
    ...(device === "" ? {} : { target_device_id: device }),
    ...(input.repos.length === 0
      ? {}
      : { repos: input.repos.map((repo) => ({ repo })) }),
    ...(addendum === "" ? {} : { prompt_addendum: addendum }),
  };
}

/** The button's guard: a typed device must be a uuid; blank is automatic. */
export function canSubmitContinue(input: {
  submitting: boolean;
  deviceId: string;
}): boolean {
  const device = input.deviceId.trim();
  return !input.submitting && (device === "" || isDeviceId(device));
}

// ─────────────────────────────── refusals ───────────────────────────────

export type ContinueRefusalKind =
  | SpawnRefusalKind
  | "subproject_has_no_repo"
  | "invalid_effort"
  | "no_capacity"
  | "subproject_not_found"
  | "migration_pending";

export interface ContinueRefusal {
  kind: ContinueRefusalKind;
  /** One line: what happened. */
  headline: string;
  /** coord's own specifics, when it gave any. May be `""`. */
  detail: string;
  /** What the operator can do next. May be `""`. */
  remedy: string;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Turn a non-2xx Continue answer into a specific refusal. The subproject's own
 * codes are read first; every other code goes to `describeSpawnRefusal`, which
 * already words `/agents/spawn`'s placement refusals. Continue sends no
 * `override_drain` (the contract has none), so a drained pin is never offered
 * an override here — its remedy is restated without one.
 */
export function describeContinueRefusal(
  status: number,
  body: string,
  ctx: { pinned: boolean; deviceName: string; deviceId: string }
): ContinueRefusal {
  const obj = extractCoordRefusal(body);
  const code = obj !== null ? text(obj.error) : "";
  const detail =
    obj !== null ? text(obj.detail) || text(obj.hint) || text(obj.message) : "";
  if (code === "subproject_has_no_repo") {
    return {
      kind: "subproject_has_no_repo",
      headline: "coord found no repository to continue this subproject in",
      detail,
      remedy:
        "Name the repos in the Repos field, or attach a work unit whose plan names its repos.",
    };
  }
  if (code === "invalid_effort") {
    return {
      kind: "invalid_effort",
      headline: "coord refused the effort level",
      detail,
      remedy: `Pick one of ${EFFORTS.join(", ")}.`,
    };
  }
  if (code === "no_capacity") {
    return {
      kind: "no_capacity",
      headline: "Every runner is at its session cap",
      detail,
      remedy:
        "Continue again when a session ends, or pin a device that has room.",
    };
  }
  if (code === "schema_migration_pending") {
    return {
      kind: "migration_pending",
      headline: "Subprojects are not migrated yet, so nothing was spawned",
      detail,
      remedy: "Continue once coord's subproject tables exist.",
    };
  }
  if (status === 404 && code !== "no_such_route" && code !== "NOT_FOUND") {
    return {
      kind: "subproject_not_found",
      headline: "coord does not know this subproject in your tenant",
      detail,
      remedy:
        "Reload the page: it may have been merged into another subproject.",
    };
  }
  const spawn = describeSpawnRefusal(status, body, ctx);
  return {
    kind: spawn.kind,
    headline: spawn.headline,
    detail: spawn.detail,
    remedy:
      spawn.kind === "device_drained" && ctx.pinned
        ? "An operator took this machine out of service. Use the next available runner, or pick another device."
        : spawn.remedy,
  };
}

// ─────────────────────────────── the success ─────────────────────────────

/** A 2xx body, read field by field: a field coord left out is absent here,
 *  never invented. `null` when the body is not an object at all. */
export function readContinueResponse(
  body: unknown
): Partial<SubprojectSpawnResponse> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return null;
  const b = body as Record<string, unknown>;
  const out: Partial<SubprojectSpawnResponse> = {};
  if (typeof b.subproject_id === "string") out.subproject_id = b.subproject_id;
  if (typeof b.allocation_agent_id === "string")
    out.allocation_agent_id = b.allocation_agent_id;
  if (typeof b.target_device_id === "string" || b.target_device_id === null)
    out.target_device_id = b.target_device_id as string | null;
  if (typeof b.placement === "string") out.placement = b.placement;
  if (typeof b.effort_requested === "string")
    out.effort_requested = b.effort_requested;
  if (typeof b.ultracode_requested === "boolean")
    out.ultracode_requested = b.ultracode_requested;
  if (Array.isArray(b.repos))
    out.repos = b.repos.filter((r): r is string => typeof r === "string");
  if (typeof b.brief_preview === "string") out.brief_preview = b.brief_preview;
  return out;
}

/** Where the session went, and who chose it. */
export function describeContinuePlacement(
  result: Partial<SubprojectSpawnResponse>,
  deviceLabel: (deviceId: string) => string
): string {
  const where = result.target_device_id
    ? deviceLabel(result.target_device_id)
    : "a device coord did not name";
  if (result.placement === "pinned")
    return `on ${where} — the device you named`;
  if (result.placement === "pool")
    return `on ${where} — placed by coord on the next available runner`;
  return `on ${where} (coord did not say how it placed the session)`;
}

/** The title on "applied: not reported". */
export const APPLIED_EFFORT_NOT_REPORTED =
  "No runner reports the effort a session started at yet (plan 2026-10-27-spawn-time-effort-and-ultracode-profiles-for-every-fleet-spawn-path, Phase 8), so the applied effort is not reported — it is never assumed to be the one requested.";

/** "effort requested <x> · applied: not reported" — the requested half as
 *  coord ECHOED it, or said to be missing. */
export function describeEffortOutcome(
  result: Partial<SubprojectSpawnResponse>
): string {
  const requested =
    result.effort_requested === undefined
      ? "not echoed by coord"
      : `${result.effort_requested}${result.ultracode_requested === true ? " with ultracode" : ""}`;
  return `effort requested ${requested} · applied: not reported`;
}
