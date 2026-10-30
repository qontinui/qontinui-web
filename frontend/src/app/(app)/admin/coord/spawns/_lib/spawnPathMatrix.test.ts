/**
 * The spawn-path matrix's derivation (plan
 * `2026-10-23-console-presentation-spaces` Phase 4) — every arm, without a
 * DOM:
 *
 * 1. **Rows come from what coord serves.** A served kind or class is a row;
 *    a served agent ROLE is not; a served standing kind this build has never
 *    heard of is still a row; a contract kind nothing served stays a row whose
 *    values are UNKNOWN; the hand-kept rows are the four nothing serves.
 * 2. **Each switch is coord's value, never folded.** A registry row reads its
 *    TENANT DEFAULT (what coord enforces), never the signed-in member's own
 *    preference, which is an operator-only note; a path's other switches each
 *    carry their own served value — including the red-main and stalled-train
 *    knobs coord names as their conjuncts; an unreadable source is UNKNOWN
 *    naming it; a stale one says so.
 * 3. **Enforced?** — `enforce` for a registry row (by coord, each runner, or
 *    both), the post-merge row's served rollout `mode` (and, when unknown,
 *    the read that failed), `env-only` for a fleet flag, `runner-only` for a
 *    runner path.
 * 4. **Last spawned** — UNKNOWN when the ledger is not deployed, unreadable,
 *    carries no field naming the path, or names only some of its starts; a
 *    start as a lower bound; "none" as what the window measured — never
 *    "never", blank or 0.
 * 5. **After a write, the read-back** — a match, a contradiction, a refusal,
 *    an unconfirmed outcome (UNKNOWN until re-read), a failed read-back
 *    (UNKNOWN), a write in flight.
 * 6. **Presentation** — no token, variable, file path, failure text, "coord"
 *    or member preference in any gate.
 */

import { describe, expect, it } from "vitest";
import type {
  AdminAgentRegistryRow,
  AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import { AS_OF, listFx, rowFx } from "../__fixtures__/coordSpawns";
import {
  ROLE_ROW_NAME,
  REPOS,
  defaultsBody,
  effectiveBody,
  effectiveFx,
  mergeSettingsBody,
  mergeSettingsRead,
  nextStepBody,
  scopeBody,
} from "../__fixtures__/spawnPaths";
import type { RepoDialReading } from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import { SEEDED_CLASS_ROWS, SPAWN_KIND_SEEDS } from "./spawnPathContract";
import { UNSERVED_PATHS } from "./spawnPathCatalog";
import type { ReadPart, SwitchWrite } from "./spawnPathGates";
import {
  classifyServedRow,
  deriveSpawnPathMatrix,
  type MatrixInputs,
} from "./spawnPathMatrix";

const NOW_MS = Date.parse(AS_OF);

function ok<T>(data: T): ReadPart<T> {
  return { data, error: null, asOfMs: NOW_MS, loading: false };
}

function failed<T>(error: string, data: T | null = null): ReadPart<T> {
  return { data, error, asOfMs: data === null ? null : NOW_MS, loading: false };
}

function readings(
  mode: "shadow" | "enforce" | null = "shadow"
): Record<string, RepoDialReading> {
  const out: Record<string, RepoDialReading> = {};
  for (const repo of REPOS) {
    out[repo] = {
      scope: scopeBody(repo, { mode }),
      scopeError: null,
      scopeReadbackError: null,
      delivery: null,
      deliveryError: null,
      deliveryReadbackError: null,
    };
  }
  return out;
}

function inputs(overrides: Partial<MatrixInputs> = {}): MatrixInputs {
  return {
    effective: ok(effectiveBody().agents),
    defaults: ok(defaultsBody().agents),
    nextStep: ok(nextStepBody()),
    mergeSettings: mergeSettingsRead(),
    followup: {
      loading: false,
      repos: [...REPOS],
      reposError: null,
      readings: readings(),
    },
    ledger: { list: listFx([]), issue: null, windowLabel: "last 7 days" },
    writes: {},
    presenting: false,
    ...overrides,
  };
}

function rowOf(m: ReturnType<typeof deriveSpawnPathMatrix>, key: string) {
  const row = m.rows.find((r) => r.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
}

function gateOf(
  m: ReturnType<typeof deriveSpawnPathMatrix>,
  rowKey: string,
  gateKey: string
) {
  const gate = rowOf(m, rowKey).gates.find((g) => g.key === gateKey);
  if (!gate) throw new Error(`no gate ${gateKey} on ${rowKey}`);
  return gate;
}

describe("rows come from what coord serves", () => {
  it("lists every served kind and class once, keeps roles off, and adds the four hand-kept rows", () => {
    const m = deriveSpawnPathMatrix(inputs());
    const coordKeys = [
      ...SPAWN_KIND_SEEDS.map((k) => k.agentName),
      ...SEEDED_CLASS_ROWS,
    ];
    for (const key of coordKeys) {
      expect(
        m.rows.filter((r) => r.key === key),
        key
      ).toHaveLength(1);
      expect(rowOf(m, key).source).toBe("served");
    }
    expect(m.rows.some((r) => r.key === ROLE_ROW_NAME)).toBe(false);
    expect(m.roleRows).toBe(1);
    for (const hand of UNSERVED_PATHS) {
      expect(rowOf(m, hand.key).source).toBe("hand");
    }
    expect(m.rows).toHaveLength(coordKeys.length + UNSERVED_PATHS.length);
  });

  it("counts the rows by kind: automatic, launched by a person, class switches, each machine's own", () => {
    const m = deriveSpawnPathMatrix(inputs());
    // 10 automatic contract kinds + the post-merge follow-up; the console's
    // launcher; the two seeded classes; the three runner paths.
    expect(m.counts).toEqual({
      automatic: 11,
      person: 1,
      classes: 2,
      runner: 3,
    });
    expect(rowOf(m, "operator_spawn").startedByPerson).toBe(true);
    expect(rowOf(m, "next_step_dispatch").startedByPerson).toBe(false);
  });

  it("gives a served standing kind this build has never heard of its own row, named by its token", () => {
    const agents: AgentRegistryEntry[] = [
      ...effectiveBody().agents,
      effectiveFx("brand_new_dispatch", "standing_continuation", {
        enabled: false,
      }),
      // An in-session row the contract does not name is an agent role.
      effectiveFx("helper-role", "in_session_subagent"),
    ];
    const m = deriveSpawnPathMatrix(inputs({ effective: ok(agents) }));
    const row = rowOf(m, "brand_new_dispatch");
    expect(row.label).toBe("Brand new dispatch");
    expect(row.source).toBe("served");
    // No raw row for it, so no default is known — and the member's fold row
    // (sourced `default`) is not used while the raw rows answered.
    expect(row.gates[0]?.effective.state).toBe("unknown");
    // Its class switch governs it too, mirrored read-only.
    expect(row.gates.map((g) => g.key)).toContain(
      "mirror:standing_continuation"
    );
    expect(m.rows.some((r) => r.key === "helper-role")).toBe(false);
    expect(m.roleRows).toBe(2);
  });

  it("does not count a row it cannot classify as an agent role, and names it", () => {
    const agents = [
      ...effectiveBody().agents,
      // A new kind on the in-session class: snake_case, so not a role's name.
      effectiveFx("new_inline_kind", "in_session_subagent"),
      // A hyphenated name on a class no role is ever on.
      effectiveFx("fanout-thing", "parallel_fanout"),
      effectiveFx("no-path-at-all", null as unknown as string),
    ];
    const m = deriveSpawnPathMatrix(inputs({ effective: ok(agents) }));
    expect(m.roleRows).toBe(1);
    expect(m.unclassified).toEqual([
      "fanout-thing",
      "new_inline_kind",
      "no-path-at-all",
    ]);
    for (const name of m.unclassified) {
      expect(m.rows.some((r) => r.key === name)).toBe(false);
    }
  });

  it("classifies a served row: a contract name or a standing kind is a path, a hyphenated in-session name a role", () => {
    expect(classifyServedRow("pr_fix_dispatch", "standing_continuation")).toBe(
      "path"
    );
    expect(classifyServedRow("operator_spawn", "in_session_subagent")).toBe(
      "path"
    );
    expect(classifyServedRow("parallel_fanout", "parallel_fanout")).toBe(
      "path"
    );
    expect(classifyServedRow("brand-new", "standing_continuation")).toBe(
      "path"
    );
    expect(classifyServedRow("code-reviewer", "in_session_subagent")).toBe(
      "role"
    );
    expect(classifyServedRow("reviewer", "in_session_subagent")).toBe("role");
    expect(classifyServedRow("new_inline_kind", "in_session_subagent")).toBe(
      "unclassified"
    );
    expect(classifyServedRow("code-reviewer", null)).toBe("unclassified");
  });

  it("keeps every contract row when neither registry read answered, each value UNKNOWN naming the read", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: failed("GET /api/v1/agent-registry failed: 502"),
        defaults: failed(
          "GET /api/v1/agent-registry/admin/registry failed: 502"
        ),
      })
    );
    expect(m.roleRows).toBeNull();
    for (const seed of SPAWN_KIND_SEEDS) {
      const row = rowOf(m, seed.agentName);
      expect(row.source).toBe("contract");
      const gate = row.gates[0]!;
      expect(gate.effective.state).toBe("unknown");
      expect(gate.effective.title).toContain(
        "The tenant defaults could not be read"
      );
      expect(gate.effective.title).toContain("admin/registry failed: 502");
      // A switch nobody read is not offered — and says why.
      expect(gate.write).toBeNull();
      expect(gate.readOnly).toContain("did not answer");
    }
  });

  it("says a kind the registry does not serve is unknown, not on", () => {
    const drop = <T extends { agent_name: string }>(rows: T[]) =>
      rows.filter((a) => a.agent_name !== "merge_shepherd");
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: ok(drop(effectiveBody().agents)),
        defaults: ok(drop(defaultsBody().agents)),
      })
    );
    const gate = gateOf(m, "merge_shepherd", "registry:merge_shepherd");
    expect(rowOf(m, "merge_shepherd").source).toBe("contract");
    expect(gate.effective.state).toBe("unknown");
    expect(gate.effective.title).toContain("holds no row named merge_shepherd");
  });

  it("orders the plan's paths first, the class switches after, the runner paths last", () => {
    const keys = deriveSpawnPathMatrix(inputs()).rows.map((r) => r.key);
    expect(keys.slice(0, 9)).toEqual([
      "next_step_dispatch",
      "pr_fix_dispatch",
      "red_main_fix_dispatch",
      "admission_stall_fix_dispatch",
      "merge_shepherd",
      "gate_continuation",
      "post_merge_followup",
      "unit_continuation",
      "condition_autodispatch",
    ]);
    expect(keys.slice(-3)).toEqual([
      "runner_stewards",
      "runner_scheduler",
      "account_migration",
    ]);
    const classes = keys.indexOf("standing_continuation");
    expect(classes).toBeGreaterThan(keys.indexOf("operator_spawn"));
    expect(classes).toBeLessThan(keys.indexOf("runner_stewards"));
  });
});

describe("a registry row reads the tenant default coord enforces", () => {
  const prefOff = () =>
    ok(
      effectiveBody({
        next_step_dispatch: { enabled: false, source: "user_pref" },
      }).agents
    );

  it("shows the tenant default as the path's state, and the operator's own preference only beside it", () => {
    const m = deriveSpawnPathMatrix(inputs({ effective: prefOff() }));
    const gate = gateOf(m, "next_step_dispatch", "registry:next_step_dispatch");
    // Coord folds the defaults only: the tenant default (on) is enforced.
    expect(gate.effective.state).toBe("on");
    expect(gate.effective.text).toBe("On");
    expect(gate.effective.title).toContain("does not bind its enforcement");
    expect(gate.preference?.text).toBe("Your preference: off");
    expect(gate.preference?.title).toContain("does not switch this path");
    expect(gate.write).toEqual({
      door: "registry",
      agentName: "next_step_dispatch",
      current: true,
    });
  });

  it("never shows a member's preference while presenting — the line reads the tenant default", () => {
    const m = deriveSpawnPathMatrix(
      inputs({ effective: prefOff(), presenting: true })
    );
    const gate = gateOf(m, "next_step_dispatch", "registry:next_step_dispatch");
    expect(gate.effective.text).toBe("On");
    expect(gate.effective.title).toBe("Switched on for the whole project.");
    expect(gate.preference).toBeUndefined();
  });

  it("says how many members chose otherwise on a row each runner reads, since a runner follows its member's preference", () => {
    const defaults = defaultsBody({
      parallel_fanout: { pref_count: 3, pref_differs_from_default_count: 2 },
      standing_continuation: { pref_differs_from_default_count: 1 },
      // A coord-only row: members' preferences do not bind it, so no count.
      merge_shepherd: { pref_count: 4, pref_differs_from_default_count: 4 },
    });
    const m = deriveSpawnPathMatrix(inputs({ defaults: ok(defaults.agents) }));
    const fanout = gateOf(m, "parallel_fanout", "registry:parallel_fanout");
    expect(fanout.effective.state).toBe("on");
    expect(fanout.effective.text).toBe("On · 2 member preferences differ");
    expect(fanout.effective.title).toContain(
      "runners signed in as them follow that instead"
    );
    expect(
      gateOf(m, "standing_continuation", "registry:standing_continuation")
        .effective.text
    ).toBe("On · 1 member preference differs");
    const shepherd = gateOf(m, "merge_shepherd", "registry:merge_shepherd");
    expect(shepherd.effective.text).toBe("On");
    expect(shepherd.effective.title).toContain(
      "coord's enforcement does not read"
    );
  });

  it("falls back to the member's fold row only where it carries the default, when the raw rows did not answer", () => {
    const effective = effectiveBody({
      merge_shepherd: { enabled: false, source: "default" },
      next_step_dispatch: { enabled: false, source: "user_pref" },
    });
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: ok(effective.agents),
        defaults: failed(
          "only a coord tenant admin of the active project may read it (HTTP 403)"
        ),
      })
    );
    const shepherd = gateOf(m, "merge_shepherd", "registry:merge_shepherd");
    expect(shepherd.effective.state).toBe("off");
    expect(shepherd.effective.title).toContain("you recorded no preference");
    // The default was not read from the raw rows: no switch is offered.
    expect(shepherd.write).toBeNull();
    // A preference row is not the default: UNKNOWN, saying so.
    const next = gateOf(m, "next_step_dispatch", "registry:next_step_dispatch");
    expect(next.effective.state).toBe("unknown");
    expect(next.effective.title).toContain("HTTP 403");
    expect(next.effective.title).toContain("not the value coord enforces");
  });

  it("keeps the last good default of a failed refresh, labelled stale", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        defaults: failed(
          "GET /api/v1/agent-registry/admin/registry failed: 504",
          defaultsBody().agents
        ),
      })
    );
    const cell = gateOf(
      m,
      "unit_continuation",
      "registry:unit_continuation"
    ).effective;
    expect(cell.state).toBe("on");
    expect(cell.stale).toBe(true);
  });
});

describe("each switch carries coord's own value", () => {
  it("lists every switch that governs the PR fixer, each with its own served value", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(
          nextStepBody({
            pr_fix: {
              autonomy_level: "guidance_only",
              effective_state: "not_effective",
              master_flag_enabled: false,
            },
          })
        ),
      })
    );
    const row = rowOf(m, "pr_fix_dispatch");
    expect(row.gates.map((g) => g.key)).toEqual([
      "registry:pr_fix_dispatch",
      "mirror:standing_continuation",
      "dial:auto_fix_pr",
      "autonomy:pr_fix",
      "flag:pr_fix",
    ]);
    const [registry, , dial, autonomy, flag] = row.gates;
    expect(registry!.effective.text).toBe("On");
    expect(dial!.effective.text).toBe("On");
    expect(autonomy!.effective.state).toBe("guidance_only");
    expect(autonomy!.effective.text).toBe(
      "Guidance only · coord's verdict: it does not dispatch"
    );
    expect(flag!.effective.text).toBe("Off");
    expect(flag!.where).toContain("COORD_PR_FIX_AUTODISPATCH_ENABLED");
    // Never folded: the path's own switch still reads its own value.
    expect(registry!.effective.state).toBe("on");
  });

  it("puts the red-main knob on the red-main fixer, read from the merge settings and written through their door", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody(undefined, { auto_fix_red_main: false })
        ),
      })
    );
    const row = rowOf(m, "red_main_fix_dispatch");
    expect(row.gates.map((g) => g.key)).toEqual([
      "registry:red_main_fix_dispatch",
      "mirror:standing_continuation",
      "knob:auto_fix_red_main",
      "autonomy:red_main_fix",
      "flag:red_main_fix",
    ]);
    const knob = gateOf(m, "red_main_fix_dispatch", "knob:auto_fix_red_main");
    expect(knob.scope).toBe("tenant");
    expect(knob.scopeNote).toContain("can override it");
    expect(knob.enforced.kind).toBe("enforce");
    expect(knob.effective.text).toBe("Off");
    expect(knob.where).toContain("auto_fix_red_main");
    expect(knob.write).toEqual({ door: "auto_fix_red_main", current: false });
  });

  it("reads the red-main knob as UNKNOWN when coord does not report it or the read failed — and offers no switch", () => {
    const missing = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody(undefined, { rulebook_overrides: null })
        ),
      })
    );
    const a = gateOf(
      missing,
      "red_main_fix_dispatch",
      "knob:auto_fix_red_main"
    );
    expect(a.effective.state).toBe("unknown");
    expect(a.effective.title).toContain("carry no auto_fix_red_main value");
    expect(a.write).toBeNull();
    const broken = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: {
          loading: false,
          error: "HTTP 502",
          dial: null,
          profile: null,
        },
      })
    );
    const b = gateOf(broken, "red_main_fix_dispatch", "knob:auto_fix_red_main");
    expect(b.effective.title).toContain("HTTP 502");
    expect(b.write).toBeNull();
  });

  it("puts the admission-stall knob on the stalled-train responder: a recorded value, else UNKNOWN naming the missing read", () => {
    const recorded = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody(undefined, {
            auto_fix_red_main: true,
            rulebook_overrides: { auto_fix_admission_stall: "False" },
          })
        ),
      })
    );
    const row = rowOf(recorded, "admission_stall_fix_dispatch");
    expect(row.gates.map((g) => g.key)).toContain(
      "knob:auto_fix_admission_stall"
    );
    const knob = gateOf(
      recorded,
      "admission_stall_fix_dispatch",
      "knob:auto_fix_admission_stall"
    );
    expect(knob.effective.text).toBe("Off");
    expect(knob.write).toBeNull();
    expect(knob.readOnly).toContain("replaces the whole rulebook_overrides");

    const absent = deriveSpawnPathMatrix(inputs());
    const unknown = gateOf(
      absent,
      "admission_stall_fix_dispatch",
      "knob:auto_fix_admission_stall"
    );
    expect(unknown.effective.state).toBe("unknown");
    expect(unknown.effective.title).toContain(
      "record no auto_fix_admission_stall value"
    );
    expect(unknown.effective.title).toContain("coord_fixer_arm_readiness");

    const typo = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody(undefined, {
            rulebook_overrides: { auto_fix_admission_stall: "yes" },
          })
        ),
      })
    );
    expect(
      gateOf(
        typo,
        "admission_stall_fix_dispatch",
        "knob:auto_fix_admission_stall"
      ).effective.title
    ).toContain('("yes") is not one coord recognises');
  });

  it("names, for the operator, the setting coord says its verdict cannot see", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(
          nextStepBody({
            red_main_fix: {
              effective_state: "unknown",
              effective_unknown_reason:
                "the per-(tenant, repo) `auto_fix_red_main` knob checked at gate 3",
            },
          })
        ),
      })
    );
    const autonomy = gateOf(
      m,
      "red_main_fix_dispatch",
      "autonomy:red_main_fix"
    );
    expect(autonomy.effective.text).toContain("unknown");
    expect(autonomy.effective.title).toContain(
      "Coord names what it cannot see: the per-(tenant, repo) `auto_fix_red_main` knob"
    );
  });

  it("reads the fixer dial as UNKNOWN when the merge settings failed or this coord does not serve it", () => {
    const failedDial = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: {
          loading: false,
          error: "HTTP 502",
          dial: null,
          profile: null,
        },
      })
    );
    const a = gateOf(failedDial, "pr_fix_dispatch", "dial:auto_fix_pr");
    expect(a.effective.state).toBe("unknown");
    expect(a.effective.title).toContain("HTTP 502");
    expect(a.write).toBeNull();
    const unserved = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: { ...mergeSettingsRead(), dial: null },
      })
    );
    expect(
      gateOf(unserved, "pr_fix_dispatch", "dial:auto_fix_pr").effective.title
    ).toContain("does not serve the auto_fix_pr dial");
  });

  it("reads a flag coord did not report as UNKNOWN, not off", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(
          nextStepBody({ next_step: { master_flag_enabled: null } })
        ),
      })
    );
    const flag = gateOf(m, "next_step_dispatch", "flag:next_step");
    expect(flag.effective.state).toBe("unknown");
    expect(flag.effective.title).toContain("unknown, not off");
  });

  it("offers no autonomy control when coord says this account may not edit", () => {
    const m = deriveSpawnPathMatrix(
      inputs({ nextStep: ok(nextStepBody({}, { can_edit: false })) })
    );
    const gate = gateOf(m, "red_main_fix_dispatch", "autonomy:red_main_fix");
    expect(gate.write).toBeNull();
    expect(gate.readOnly).toContain("may not change");
  });
});

describe("enforced?", () => {
  it("is enforce for a registry row: by coord, by each runner, or by both for the standing class", () => {
    const m = deriveSpawnPathMatrix(inputs());
    expect(
      gateOf(m, "gate_continuation", "registry:gate_continuation").enforced
    ).toMatchObject({ kind: "enforce", text: "enforce" });
    const fanout = gateOf(
      m,
      "parallel_fanout",
      "registry:parallel_fanout"
    ).enforced;
    expect(fanout).toMatchObject({
      kind: "enforce",
      text: "enforce (each runner)",
    });
    // Off degrades fan-out to inline; it is not a refusal.
    expect(fanout.title).toContain("one step at a time");
    expect(fanout.title).not.toContain("refuses to start");
    expect(
      gateOf(m, "standing_continuation", "registry:standing_continuation")
        .enforced
    ).toMatchObject({
      kind: "enforce",
      text: "enforce (coord and each runner)",
    });
  });

  it("is the post-merge scope's served rollout mode — shadow or enforce — and UNKNOWN when unread", () => {
    const shadow = deriveSpawnPathMatrix(inputs());
    const gate = gateOf(
      shadow,
      "post_merge_followup",
      "scope:post_merge_followup"
    );
    expect(gate.enforced.kind).toBe("shadow");
    expect(gate.enforced.title).toContain("suppresses nothing");
    expect(gate.scope).toBe("repo");
    expect(gate.effective.text).toBe("2 repositories: 2 every merge");
    expect(gate.setOn?.href).toBe("/admin/coord/agent-registry");

    const enforce = deriveSpawnPathMatrix(
      inputs({
        followup: {
          loading: false,
          repos: [...REPOS],
          reposError: null,
          readings: readings("enforce"),
        },
      })
    );
    expect(
      gateOf(enforce, "post_merge_followup", "scope:post_merge_followup")
        .enforced.kind
    ).toBe("enforce");
  });

  it("names the repository-list read when that is what failed — never 'no repos' for a list nobody read", () => {
    const unread = deriveSpawnPathMatrix(
      inputs({
        followup: {
          loading: false,
          repos: null,
          reposError: "GET /api/v1/operations/repos failed: 500",
          readings: {},
        },
      })
    );
    const g = gateOf(
      unread,
      "post_merge_followup",
      "scope:post_merge_followup"
    );
    expect(g.enforced.kind).toBe("unknown");
    expect(g.enforced.title).toContain(
      "the project's repositories could not be read"
    );
    expect(g.enforced.title).toContain("operations/repos failed: 500");
    expect(g.enforced.title).not.toContain("no registered repository");
    expect(g.effective.state).toBe("unknown");
    expect(g.effective.title).toContain("500");

    // A tenant that truly has none is a different sentence.
    const none = deriveSpawnPathMatrix(
      inputs({
        followup: { loading: false, repos: [], reposError: null, readings: {} },
      })
    );
    expect(
      gateOf(none, "post_merge_followup", "scope:post_merge_followup").enforced
        .title
    ).toContain("no registered repository");
  });

  it("says why each unknown repository's scope is unknown, and which reads failed when none could be read", () => {
    const failedScope: RepoDialReading = {
      scope: null,
      scopeError:
        "GET /api/v1/operations/post-merge-followup-scope failed: 503",
      scopeReadbackError: null,
      delivery: null,
      deliveryError: null,
      deliveryReadbackError: null,
    };
    const partial = deriveSpawnPathMatrix(
      inputs({
        followup: {
          loading: false,
          repos: [...REPOS],
          reposError: null,
          readings: { ...readings(), [REPOS[1]!]: failedScope },
        },
      })
    );
    const p = gateOf(
      partial,
      "post_merge_followup",
      "scope:post_merge_followup"
    );
    expect(p.effective.text).toBe("2 repositories: 1 every merge · 1 unknown");
    expect(p.effective.title).toContain(
      "1 repository's scope could not be read"
    );
    expect(p.effective.title).toContain("failed: 503");
    // One repo answered: the mode is still read.
    expect(p.enforced.kind).toBe("shadow");

    const all = deriveSpawnPathMatrix(
      inputs({
        followup: {
          loading: false,
          repos: [...REPOS],
          reposError: null,
          readings: { [REPOS[0]!]: failedScope, [REPOS[1]!]: failedScope },
        },
      })
    );
    const a = gateOf(all, "post_merge_followup", "scope:post_merge_followup");
    expect(a.enforced.kind).toBe("unknown");
    expect(a.enforced.title).toContain("no repository's scope could be read");
    expect(a.enforced.title).toContain("failed: 503");
  });

  it("is env-only for a fleet flag and runner-only for a runner path, both read-only and saying where they are set", () => {
    const m = deriveSpawnPathMatrix(inputs());
    const flag = gateOf(
      m,
      "admission_stall_fix_dispatch",
      "flag:admission_stall_fix"
    );
    expect(flag.enforced.kind).toBe("env-only");
    expect(flag.scope).toBe("environment variable");
    expect(flag.write).toBeNull();
    expect(flag.readOnly).toContain("deployment environment");
    for (const key of [
      "runner_stewards",
      "runner_scheduler",
      "account_migration",
    ]) {
      const gate = rowOf(m, key).gates[0]!;
      expect(gate.enforced.kind, key).toBe("runner-only");
      expect(gate.scope, key).toBe("device");
      expect(gate.write, key).toBeNull();
      expect(gate.readOnly, key).toContain("runner");
      expect(gate.effective.state, key).toBe("unknown");
    }
    expect(rowOf(m, "account_migration").gates[0]!.where).toContain(
      "claude_cli.auto_migrate_on_token_exhaustion"
    );
  });
});

describe("last spawned — UNKNOWN unless the ledger names the path, and only what the list measured", () => {
  const started = rowFx({
    origin: "gate_continuation",
    spawned_at: "2026-10-21T11:00:12Z",
  });
  const newer = rowFx({
    origin: "gate_continuation",
    spawned_at: "2026-10-21T11:40:00Z",
  });

  it("is UNKNOWN, saying so, while the ledger is not deployed", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: null,
          issue: { kind: "ledger_not_deployed", reason: "schema_missing" },
          windowLabel: "last 7 days",
        },
      })
    );
    const cell = rowOf(m, "gate_continuation").lastSpawned;
    expect(cell.kind).toBe("unknown");
    expect(cell.kind === "unknown" && cell.reason).toContain(
      "Spawn ledger not deployed yet"
    );
  });

  it("is UNKNOWN when the ledger could not be read", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: null,
          issue: { kind: "route_unavailable" },
          windowLabel: "last 7 days",
        },
      })
    );
    const cell = rowOf(m, "unit_continuation").lastSpawned;
    expect(cell.kind === "unknown" && cell.reason).toContain(
      "Coord does not serve the spawn ledger yet"
    );
  });

  it("is UNKNOWN when no ledger field names the path, whatever the ledger holds", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([started]),
          issue: null,
          windowLabel: "last 7 days",
        },
      })
    );
    for (const key of [
      "pr_fix_dispatch",
      "merge_shepherd",
      "post_merge_followup",
      "account_migration",
    ]) {
      const cell = rowOf(m, key).lastSpawned;
      expect(cell.kind, key).toBe("unknown");
    }
    const pm = rowOf(m, "post_merge_followup").lastSpawned;
    expect(pm.kind === "unknown" && pm.reason).toContain(
      "carries no field that tells the two apart"
    );
  });

  it("is the newest start of the path's own origin, with what the list measured", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([started, newer]),
          issue: null,
          windowLabel: "last 7 days",
        },
      })
    );
    expect(rowOf(m, "gate_continuation").lastSpawned).toEqual({
      kind: "spawned",
      at: "2026-10-21T11:40:00Z",
      measured: "the requests made in the last 7 days",
      stale: false,
    });
  });

  it("keeps the last good list's answer when a refresh failed, marked stale", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([started]),
          issue: { kind: "error", message: "502" },
          windowLabel: "last 7 days",
        },
      })
    );
    expect(rowOf(m, "gate_continuation").lastSpawned).toMatchObject({
      kind: "spawned",
      stale: true,
    });
  });

  it("says what was measured when nothing started, never 'never' — and only the rows loaded when the list was cut", () => {
    const whole = deriveSpawnPathMatrix(inputs());
    expect(rowOf(whole, "runner_scheduler").lastSpawned).toEqual({
      kind: "none",
      text: "no request in the last 7 days",
      stale: false,
    });
    const waiting = rowFx({
      origin: "scheduler",
      spawned_at: null,
      state: "queued",
    });
    const asked = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([waiting, waiting]),
          issue: null,
          windowLabel: "last 7 days",
        },
      })
    );
    expect(rowOf(asked, "runner_scheduler").lastSpawned).toEqual({
      kind: "none",
      text: "2 requests in the last 7 days, none started",
      stale: false,
    });
    const cut = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([started], { truncated: true, total: 900, shown: 1 }),
          issue: null,
          windowLabel: "last 7 days",
        },
      })
    );
    expect(rowOf(cut, "runner_scheduler").lastSpawned).toEqual({
      kind: "none",
      text: "no request among the 1 most recent loaded",
      stale: false,
    });
  });

  it("proves a steward start but not an absence: stewards started from a runner's own window are recorded otherwise", () => {
    const none = deriveSpawnPathMatrix(inputs());
    const cell = rowOf(none, "runner_stewards").lastSpawned;
    expect(cell.kind).toBe("unknown");
    expect(cell.kind === "unknown" && cell.reason).toContain(
      "recorded as an operator terminal"
    );
    const steward = rowFx({
      origin: "steward",
      spawned_at: "2026-10-21T09:00:00Z",
    });
    const seen = deriveSpawnPathMatrix(
      inputs({
        ledger: {
          list: listFx([steward]),
          issue: null,
          windowLabel: "last 7 days",
        },
      })
    );
    expect(rowOf(seen, "runner_stewards").lastSpawned).toMatchObject({
      kind: "spawned",
      at: "2026-10-21T09:00:00Z",
    });
  });
});

describe("the PR fixer dial when the merge settings could not be read", () => {
  it("says this page's failed read leaves it unknown, and claims nothing treats it as off", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: {
          loading: false,
          error: "GET /api/v1/operations/pr-merge/settings failed: 502",
          dial: null,
          profile: null,
        },
      })
    );
    const { effective } = gateOf(m, "pr_fix_dispatch", "dial:auto_fix_pr");
    expect(effective.state).toBe("unknown");
    expect(effective.title).toContain(
      "Whether coord starts PR fixers right now is unknown."
    );
    expect(effective.title).not.toContain("treated as off");
  });
});

describe("after a write, the read-back", () => {
  const write = (w: Partial<SwitchWrite>): SwitchWrite => ({
    asked: "off",
    phase: "written",
    error: null,
    readbackError: null,
    ...w,
  });
  const defaultsOff = (): ReadPart<AdminAgentRegistryRow[]> =>
    ok(defaultsBody({ merge_shepherd: { default_enabled: false } }).agents);

  it("says the read-back matches when coord's tenant default reads what was asked", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        defaults: defaultsOff(),
        writes: { "registry:merge_shepherd": write({}) },
      })
    );
    const cell = gateOf(
      m,
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(cell.text).toBe("Off");
    expect(cell.tone).toBe("known");
    expect(cell.readBack).toEqual({
      asked: "off",
      askedText: "off",
      matches: true,
    });
  });

  it("does not turn a correct write red when the operator's own preference disagrees with it", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        defaults: defaultsOff(),
        effective: ok(
          effectiveBody({
            merge_shepherd: { enabled: true, source: "user_pref" },
          }).agents
        ),
        writes: { "registry:merge_shepherd": write({}) },
      })
    );
    const gate = gateOf(m, "merge_shepherd", "registry:merge_shepherd");
    expect(gate.effective.tone).toBe("known");
    expect(gate.effective.readBack?.matches).toBe(true);
    expect(gate.preference?.text).toBe("Your preference: on");
  });

  it("shows a read-back that disagrees as a contradiction — the value is coord's, not the request", () => {
    const m = deriveSpawnPathMatrix(
      inputs({ writes: { "registry:merge_shepherd": write({}) } })
    );
    const cell = gateOf(
      m,
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(cell.state).toBe("on");
    expect(cell.tone).toBe("contradiction");
    expect(cell.readBack?.matches).toBe(false);
  });

  it("is UNKNOWN when the write landed but reading it back failed, until a read answers", () => {
    const writes = {
      "registry:merge_shepherd": write({ readbackError: "HTTP 503" }),
    };
    const m = deriveSpawnPathMatrix(
      inputs({ defaults: failed("HTTP 503", defaultsBody().agents), writes })
    );
    const cell = gateOf(
      m,
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(cell.state).toBe("unknown");
    expect(cell.title).toContain("reading it back failed");
    // The next read answered: that read is what is compared.
    const later = gateOf(
      deriveSpawnPathMatrix(inputs({ writes })),
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(later.state).toBe("on");
    expect(later.readBack?.matches).toBe(false);
    expect(later.writeNote).toContain("a read made after it");
  });

  it("is UNKNOWN while a write coord could not confirm is re-read, then compares that read", () => {
    const pending = deriveSpawnPathMatrix(
      inputs({
        writes: {
          "dial:auto_fix_pr": write({
            phase: "unconfirmed",
            error: '503 - {"written":null}',
          }),
        },
      })
    );
    const p = gateOf(pending, "pr_fix_dispatch", "dial:auto_fix_pr").effective;
    expect(p.state).toBe("unknown");
    expect(p.readBack).toBeUndefined();
    expect(p.writeNote).toContain("Outcome unknown");
    const settled = deriveSpawnPathMatrix(
      inputs({
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody({
            tenant: false,
            resolved: false,
            source: "tenant",
          })
        ),
        writes: { "dial:auto_fix_pr": write({ outcomeUnknown: true }) },
      })
    );
    const s = gateOf(settled, "pr_fix_dispatch", "dial:auto_fix_pr").effective;
    expect(s.readBack?.matches).toBe(true);
    expect(s.writeNote).toContain("could not confirm the write itself");
  });

  it("keeps coord's value and says the change was refused", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        writes: {
          "registry:merge_shepherd": write({
            phase: "refused",
            error: "HTTP 403",
          }),
        },
      })
    );
    const cell = gateOf(
      m,
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(cell.state).toBe("on");
    expect(cell.readBack).toBeUndefined();
    expect(cell.writeNote).toContain("was refused: HTTP 403");
  });

  it("compares an autonomy write with the level coord answers, and a dial or knob write with what the merge settings read back", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(
          nextStepBody({ next_step: { autonomy_level: "guidance_only" } })
        ),
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody(
            { tenant: false, resolved: false, source: "tenant" },
            { auto_fix_red_main: true }
          )
        ),
        writes: {
          "autonomy:next_step": write({ asked: "auto_decide" }),
          "dial:auto_fix_pr": write({ asked: "off" }),
          "knob:auto_fix_red_main": write({ asked: "off" }),
        },
      })
    );
    const autonomy = gateOf(
      m,
      "next_step_dispatch",
      "autonomy:next_step"
    ).effective;
    expect(autonomy.readBack).toEqual({
      asked: "auto_decide",
      askedText: "Auto",
      matches: false,
    });
    expect(autonomy.tone).toBe("contradiction");
    const dial = gateOf(m, "pr_fix_dispatch", "dial:auto_fix_pr").effective;
    expect(dial.readBack?.matches).toBe(true);
    expect(dial.text).toBe("Off");
    const knob = gateOf(
      m,
      "red_main_fix_dispatch",
      "knob:auto_fix_red_main"
    ).effective;
    expect(knob.readBack?.matches).toBe(false);
    expect(knob.tone).toBe("contradiction");
  });

  it("says a write is in flight without showing its value", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        writes: { "registry:merge_shepherd": write({ phase: "writing" }) },
      })
    );
    const cell = gateOf(
      m,
      "merge_shepherd",
      "registry:merge_shepherd"
    ).effective;
    expect(cell.state).toBe("on");
    expect(cell.writeNote).toBe("Writing off…");
  });
});

describe("presentation mode", () => {
  function presentedTexts(m: ReturnType<typeof deriveSpawnPathMatrix>): string {
    return m.rows
      .flatMap((r) => [
        r.summary,
        ...r.gates.flatMap((g) => [
          g.title,
          g.where,
          g.scopeNote ?? "",
          g.readOnly ?? "",
          g.enforced.text,
          g.enforced.title,
          g.effective.text,
          g.effective.title ?? "",
          g.effective.writeNote ?? "",
          g.effective.readBack ? "you asked" : "",
          g.preference?.text ?? "",
        ]),
        r.lastSpawned.kind === "unknown" ? r.lastSpawned.presentedReason : "",
      ])
      .join("\n");
  }

  it("shows no registry name, variable, file path, route, failure text, 'coord' or preference in any gate", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        presenting: true,
        effective: ok(
          effectiveBody({
            next_step_dispatch: { enabled: false, source: "user_pref" },
          }).agents
        ),
        nextStep: failed(
          "GET /api/v1/operations/coord/next-step-settings failed: 500"
        ),
        mergeSettings: mergeSettingsRead(
          mergeSettingsBody({ tenant: true, resolved: false, source: "repo" })
        ),
        followup: {
          loading: false,
          repos: null,
          reposError: "GET /api/v1/operations/repos failed: 500",
          readings: {},
        },
        writes: {
          "registry:merge_shepherd": {
            asked: "off",
            phase: "refused",
            error: "HTTP 403 not_coord_tenant_admin",
            readbackError: null,
          },
          // A write the operator made before presenting: coord's value only.
          "registry:gate_continuation": {
            asked: "off",
            phase: "written",
            error: null,
            readbackError: null,
          },
        },
      })
    );
    // The arms the first render does not reach: a member who may not edit,
    // and tenant defaults that did not answer.
    const locked = deriveSpawnPathMatrix(
      inputs({
        presenting: true,
        nextStep: ok(nextStepBody({}, { can_edit: false })),
        defaults: failed(
          "GET /api/v1/agent-registry/admin/registry failed: 403"
        ),
      })
    );
    expect(
      gateOf(locked, "red_main_fix_dispatch", "autonomy:red_main_fix").readOnly
    ).toBe("Set by an administrator of the project.");
    const joined = `${presentedTexts(m)}\n${presentedTexts(locked)}`;
    for (const token of [
      "pr_fix_dispatch",
      "COORD_",
      "/coord/",
      "/api/v1",
      "claude_cli",
      "auto_fix",
      "rulebook",
      ".qontinui",
      "config.yml",
      "500",
      "403",
      "Your preference",
      "you asked",
      // The operator's reasons a control is withheld.
      "so the switch is not offered",
      "so it is not offered",
    ]) {
      expect(joined, token).not.toContain(token);
    }
    expect(joined).not.toMatch(/\bcoord\b/i);
    expect(joined).toContain("could not be read");
  });

  it("keeps a failure UNKNOWN in fixed words where a reason is quoted", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        presenting: true,
        ledger: {
          list: null,
          issue: { kind: "error", message: "GET http://10.0.0.5/coord failed" },
          windowLabel: "last 7 days",
        },
      })
    );
    const cell = rowOf(m, "gate_continuation").lastSpawned;
    expect(cell.kind).toBe("unknown");
    expect(cell.kind === "unknown" && cell.presentedReason).toBe(
      "When this path last started a session is unknown: the record of spawn requests could not be read."
    );
  });
});
