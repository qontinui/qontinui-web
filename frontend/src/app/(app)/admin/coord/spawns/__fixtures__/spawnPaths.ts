/**
 * Wire fixtures for the spawn-path matrix and the machine list on
 * `/admin/coord/spawns`, shaped field for field by the existing doors' bodies:
 * the web backend's agent-registry proxies (`agent_registry.py`), coord's
 * next-step settings, the merge settings' dial fields, the per-repo follow-up
 * reads, coord's drain map and the session run record's concurrency read.
 */

import type {
  AdminAgentRegistryRow,
  AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import type {
  NextStepDomain,
  NextStepSettings,
} from "@/lib/api/operations/coordSettings";
import type { EffectiveProfile } from "@/lib/api/operations/prMerge";
import type { PostMergeFollowupScopeView } from "@/lib/api/operations/repoFollowupDials";
import { readAutoFixPr } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import type { MergeSettingsRead } from "../_lib/spawnPathGates";
import type { ConcurrencyWire } from "@/app/(app)/admin/coord/session-load/_lib/sessionLoadStatus";
import { SEEDED_CLASS_ROWS, SPAWN_KIND_SEEDS } from "../_lib/spawnPathContract";
import { AS_OF, DEVICE_A, DEVICE_B } from "./coordSpawns";

/** An agent ROLE row — served by the registry, not a spawn path. */
export const ROLE_ROW_NAME = "code-reviewer";

/** One effective row, as coord's fold serves it. */
export function effectiveFx(
  name: string,
  spawnPath: string,
  overrides: Partial<AgentRegistryEntry> = {}
): AgentRegistryEntry {
  return {
    agent_name: name,
    purpose: `purpose of ${name}`,
    spawn_path: spawnPath,
    model: null,
    effort: null,
    policy_required: false,
    fanout_bound: 1,
    enabled: true,
    disposition: "degrade",
    source: "default",
    ...overrides,
  };
}

/** One raw registry row (the tenant default). */
export function defaultsFx(
  name: string,
  spawnPath: string,
  overrides: Partial<AdminAgentRegistryRow> = {}
): AdminAgentRegistryRow {
  return {
    agent_name: name,
    purpose: `purpose of ${name}`,
    trigger_condition: "",
    spawn_path: spawnPath,
    model: null,
    effort: null,
    default_enabled: true,
    policy_required: false,
    allowed_dispositions: ["block", "degrade", "warn_proceed"],
    fanout_bound: 1,
    pref_count: 0,
    pref_differs_from_default_count: 0,
    ...overrides,
  };
}

/** Every contract kind and seeded class, plus one role row — all served, all on. */
export function servedNames(): Array<{ name: string; spawnPath: string }> {
  return [
    ...SPAWN_KIND_SEEDS.map((k) => ({
      name: k.agentName,
      spawnPath: k.spawnPath as string,
    })),
    ...SEEDED_CLASS_ROWS.map((c) => ({
      name: c as string,
      spawnPath: c as string,
    })),
    { name: ROLE_ROW_NAME, spawnPath: "in_session_subagent" },
  ];
}

export function effectiveBody(
  patch: Record<string, Partial<AgentRegistryEntry>> = {}
): { agents: AgentRegistryEntry[] } {
  return {
    agents: servedNames().map(({ name, spawnPath }) =>
      effectiveFx(name, spawnPath, patch[name] ?? {})
    ),
  };
}

export function defaultsBody(
  patch: Record<string, Partial<AdminAgentRegistryRow>> = {}
): { agents: AdminAgentRegistryRow[] } {
  return {
    agents: servedNames().map(({ name, spawnPath }) =>
      defaultsFx(name, spawnPath, patch[name] ?? {})
    ),
  };
}

const FLAGS: Record<string, string> = {
  next_step: "COORD_NEXT_STEP_AUTODISPATCH_ENABLED",
  pr_fix: "COORD_PR_FIX_AUTODISPATCH_ENABLED",
  red_main_fix: "COORD_RED_MAIN_FIX_AUTODISPATCH_ENABLED",
  admission_stall_fix: "COORD_ADMISSION_STALL_FIX_AUTODISPATCH_ENABLED",
};

export function domainFx(
  domain: string,
  overrides: Partial<NextStepDomain> = {}
): NextStepDomain {
  return {
    decision_domain: domain,
    label: `label of ${domain}`,
    description: `description of ${domain}`,
    autonomy_level: "auto_decide",
    default_autonomy_level: "guidance_only",
    default_source: "system_row",
    mode: "guidance",
    resolved_from: "tenant",
    autonomy_level_source: "policy_row",
    requires_master: true,
    master_flag: FLAGS[domain] ?? null,
    master_flag_enabled: true,
    effective: true,
    effective_state: "effective",
    ...overrides,
  };
}

export function nextStepBody(
  patch: Record<string, Partial<NextStepDomain>> = {},
  overrides: Partial<NextStepSettings> = {}
): NextStepSettings {
  return {
    master_enabled: true,
    can_edit: true,
    domains: Object.keys(FLAGS).map((d) => domainFx(d, patch[d] ?? {})),
    ...overrides,
  };
}

/** The merge-settings knobs the matrix reads besides the dial. */
export interface MergeKnobsFx {
  /** `profile.auto_fix_red_main`; `undefined` leaves the field out. */
  auto_fix_red_main?: boolean;
  /** `profile.rulebook_overrides`, where `auto_fix_admission_stall` is recorded. */
  rulebook_overrides?: Record<string, unknown> | null;
}

/**
 * `GET /pr-merge/settings`, carrying what the matrix reads: the dial, the
 * red-main knob (coord resolves it at tenant level; default on) and the
 * rulebook overrides (nothing recorded by default).
 */
export function mergeSettingsBody(
  dial: { tenant: boolean | null; resolved: boolean; source: string } = {
    tenant: null,
    resolved: true,
    source: "default",
  },
  knobs: MergeKnobsFx = { auto_fix_red_main: true, rulebook_overrides: null }
) {
  return {
    tenant_id: "00000000-0000-4000-8000-0000000000aa",
    profile: {
      auto_fix_pr_tenant: dial.tenant,
      auto_fix_pr: dial.resolved,
      auto_fix_pr_source: dial.source,
      ...knobs,
    },
  };
}

/** The merge settings as the dial hook holds them after `body` answered. */
export function mergeSettingsRead(
  body: ReturnType<typeof mergeSettingsBody> = mergeSettingsBody()
): MergeSettingsRead {
  return {
    loading: false,
    error: null,
    dial: readAutoFixPr(body.profile),
    // The fixture carries only the fields the matrix reads.
    profile: body.profile as unknown as EffectiveProfile,
  };
}

export const REPOS = ["acme/widgets", "acme/gadgets"];

export function reposBody(repos: readonly string[] = REPOS) {
  return { repos: repos.map((repo) => ({ repo })) };
}

export function scopeBody(
  repo: string,
  overrides: Partial<PostMergeFollowupScopeView> = {}
): PostMergeFollowupScopeView {
  return {
    repo,
    scope: "all",
    code_paths: [],
    resolved_scope: "default",
    mode: "shadow",
    can_edit: true,
    ...overrides,
  };
}

export function deliveryBody(repo: string) {
  return {
    repo,
    mode: "in_session_with_spawn_fallback",
    resolved_scope: "default",
    stored_value: null,
    provenance_known: true,
    can_edit: true,
  };
}

/** Coord's drain map: DEVICE_B drained for a day, with an actor and a reason. */
export function drainBody(nowMs: number, reason = "rebuilding the box") {
  return {
    as_of: new Date(nowMs).toISOString(),
    drained: {
      [DEVICE_B]: {
        until: new Date(nowMs + 24 * 3600_000).toISOString(),
        reason,
        drained_by: "operator@example.com",
        drained_at: new Date(nowMs - 3600_000).toISOString(),
      },
    },
  };
}

/** The 24-hour concurrency read: DEVICE_A heartbeating with 3 open, DEVICE_B absent. */
export function concurrencyBody(
  overrides: Partial<ConcurrencyWire> = {}
): ConcurrencyWire {
  return {
    window_seconds: 86_400,
    bucket_seconds: 900,
    devices: [
      {
        device_id: DEVICE_A,
        name: "msi-wsl",
        known_device: true,
        heartbeat_age_seconds: 30,
        open_now: 3,
        peak: 5,
        p95: 4,
        budget: { state: "published", value: 8 },
        series: [],
      },
    ],
    truncated: false,
    as_of: AS_OF,
    ...overrides,
  };
}
