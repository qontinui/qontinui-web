/**
 * The spawn-path matrix's derivation (plan
 * `2026-10-23-console-presentation-spaces` Phase 4) — every arm, without a
 * DOM:
 *
 * 1. **Rows come from what coord serves.** A served kind or class is a row;
 *    a served agent ROLE is not; a served standing kind this build has never
 *    heard of is still a row; a contract kind nothing served stays a row whose
 *    values are UNKNOWN; the hand-kept rows are the four nothing serves.
 * 2. **Each switch is coord's value, never folded.** The registry gate reads
 *    the effective row; a path's other switches each carry their own served
 *    value; an unreadable source is UNKNOWN naming it; a stale one says so.
 * 3. **Enforced?** — `enforce` for a registry row (by coord, or by each
 *    runner), the post-merge row's served rollout `mode`, `env-only` for a
 *    fleet flag, `runner-only` for a runner path.
 * 4. **Last spawned** — UNKNOWN when the ledger is not deployed, unreadable,
 *    or carries no field naming the path; stale when the last good list is
 *    kept; a measured window otherwise — never "never", blank or 0.
 * 5. **After a write, the read-back** — a match, a contradiction, a failed
 *    read-back (UNKNOWN), a refusal, a write in flight.
 * 6. **Presentation** — no token, variable or failure text in any gate.
 */

import { describe, expect, it } from "vitest";
import type { AgentRegistryEntry } from "@/lib/api/agent-registry";
import { FAILURE_REASON_WITHHELD } from "@/components/operations/presentedFailure";
import { AS_OF, listFx, rowFx } from "../__fixtures__/coordSpawns";
import {
  ROLE_ROW_NAME,
  REPOS,
  defaultsBody,
  effectiveBody,
  effectiveFx,
  mergeSettingsBody,
  nextStepBody,
  scopeBody,
} from "../__fixtures__/spawnPaths";
import { readAutoFixPr } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import type { RepoDialReading } from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import { SEEDED_CLASS_ROWS, SPAWN_KIND_SEEDS } from "./spawnPathContract";
import { UNSERVED_PATHS } from "./spawnPathCatalog";
import type { ReadPart, SwitchWrite } from "./spawnPathGates";
import { deriveSpawnPathMatrix, type MatrixInputs } from "./spawnPathMatrix";

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
    autoFixPr: {
      loading: false,
      error: null,
      state: readAutoFixPr(mergeSettingsBody().profile),
    },
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
    expect(row.gates[0]?.effective.state).toBe("off");
    // Its class switch governs it too, mirrored read-only.
    expect(row.gates.map((g) => g.key)).toContain(
      "mirror:standing_continuation"
    );
    expect(m.rows.some((r) => r.key === "helper-role")).toBe(false);
    expect(m.roleRows).toBe(2);
  });

  it("keeps every contract row when neither registry read answered, each value UNKNOWN naming the read", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: failed("GET /api/v1/agent-registry failed: 502"),
        defaults: failed("GET /api/v1/agent-registry/admin/registry failed: 502"),
      })
    );
    expect(m.roleRows).toBeNull();
    for (const seed of SPAWN_KIND_SEEDS) {
      const row = rowOf(m, seed.agentName);
      expect(row.source).toBe("contract");
      const gate = row.gates[0]!;
      expect(gate.effective.state).toBe("unknown");
      expect(gate.effective.title).toContain(
        "Coord's effective agent registry could not be read"
      );
      expect(gate.effective.title).toContain("502");
      // A switch nobody read is not offered — and says why.
      expect(gate.write).toBeNull();
      expect(gate.readOnly).toContain("could not be read");
    }
  });

  it("says a kind the registry does not serve is unknown, not on", () => {
    const agents = effectiveBody().agents.filter(
      (a) => a.agent_name !== "merge_shepherd"
    );
    const m = deriveSpawnPathMatrix(inputs({ effective: ok(agents) }));
    const gate = gateOf(m, "merge_shepherd", "registry:merge_shepherd");
    expect(gate.effective.state).toBe("unknown");
    expect(gate.effective.title).toContain("serves no row named merge_shepherd");
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

  it("names a preference row as the operator's own, and shows the tenant default beside it", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: ok(
          effectiveBody({
            next_step_dispatch: { enabled: false, source: "user_pref" },
          }).agents
        ),
      })
    );
    const gate = gateOf(m, "next_step_dispatch", "registry:next_step_dispatch");
    expect(gate.effective.text).toBe("Off (your preference)");
    expect(gate.effective.title).toContain("YOUR OWN preference row");
    expect(gate.position?.text).toBe("Tenant default on");
    expect(gate.write).toEqual({
      door: "registry",
      agentName: "next_step_dispatch",
      current: true,
    });
  });

  it("keeps the last good value of a failed refresh, labelled stale", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: failed("GET /api/v1/agent-registry failed: 504", effectiveBody().agents),
      })
    );
    const cell = gateOf(m, "unit_continuation", "registry:unit_continuation")
      .effective;
    expect(cell.state).toBe("on");
    expect(cell.stale).toBe(true);
  });

  it("reads the fixer dial as UNKNOWN when the merge settings failed or this coord does not serve it", () => {
    const failedDial = deriveSpawnPathMatrix(
      inputs({ autoFixPr: { loading: false, error: "HTTP 502", state: null } })
    );
    const a = gateOf(failedDial, "pr_fix_dispatch", "dial:auto_fix_pr");
    expect(a.effective.state).toBe("unknown");
    expect(a.effective.title).toContain("HTTP 502");
    expect(a.write).toBeNull();
    const unserved = deriveSpawnPathMatrix(
      inputs({ autoFixPr: { loading: false, error: null, state: null } })
    );
    expect(
      gateOf(unserved, "pr_fix_dispatch", "dial:auto_fix_pr").effective.title
    ).toContain("does not serve the auto_fix_pr dial");
  });

  it("reads a flag coord did not report as UNKNOWN, not off", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(nextStepBody({ next_step: { master_flag_enabled: null } })),
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
  it("is enforce for a registry row, by coord or by each runner", () => {
    const m = deriveSpawnPathMatrix(inputs());
    expect(
      gateOf(m, "gate_continuation", "registry:gate_continuation").enforced
    ).toMatchObject({ kind: "enforce", text: "enforce" });
    expect(
      gateOf(m, "parallel_fanout", "registry:parallel_fanout").enforced
    ).toMatchObject({ kind: "enforce", text: "enforce (each runner)" });
  });

  it("is the post-merge scope's served rollout mode — shadow or enforce — and UNKNOWN when unread", () => {
    const shadow = deriveSpawnPathMatrix(inputs());
    const gate = gateOf(shadow, "post_merge_followup", "scope:post_merge_followup");
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
    const g = gateOf(unread, "post_merge_followup", "scope:post_merge_followup");
    expect(g.enforced.kind).toBe("unknown");
    expect(g.effective.state).toBe("unknown");
    expect(g.effective.title).toContain("500");
  });

  it("is env-only for a fleet flag and runner-only for a runner path, both read-only and saying where they are set", () => {
    const m = deriveSpawnPathMatrix(inputs());
    const flag = gateOf(m, "admission_stall_fix_dispatch", "flag:admission_stall_fix");
    expect(flag.enforced.kind).toBe("env-only");
    expect(flag.scope).toBe("environment variable");
    expect(flag.write).toBeNull();
    expect(flag.readOnly).toContain("deployment environment");
    for (const key of ["runner_stewards", "runner_scheduler", "account_migration"]) {
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

describe("last spawned — UNKNOWN unless the ledger names the path", () => {
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
      inputs({ ledger: { list: listFx([started]), issue: null, windowLabel: "last 7 days" } })
    );
    for (const key of ["pr_fix_dispatch", "merge_shepherd", "post_merge_followup", "account_migration"]) {
      const cell = rowOf(m, key).lastSpawned;
      expect(cell.kind, key).toBe("unknown");
    }
    const pm = rowOf(m, "post_merge_followup").lastSpawned;
    expect(pm.kind === "unknown" && pm.reason).toContain(
      "carries no field that tells the two apart"
    );
  });

  it("is the newest start of the path's own origin", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        ledger: { list: listFx([started, newer]), issue: null, windowLabel: "last 7 days" },
      })
    );
    expect(rowOf(m, "gate_continuation").lastSpawned).toEqual({
      kind: "spawned",
      at: "2026-10-21T11:40:00Z",
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

  it("states a measured window, never 'never' — and only the rows loaded when the list was cut", () => {
    const whole = deriveSpawnPathMatrix(inputs());
    expect(rowOf(whole, "runner_scheduler").lastSpawned).toEqual({
      kind: "none",
      text: "none started in the last 7 days",
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
    expect(rowOf(cut, "runner_stewards").lastSpawned).toEqual({
      kind: "none",
      text: "none started among the 1 most recent requests loaded",
      stale: false,
    });
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

  it("says the read-back matches when coord's effective row reads what was asked", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: ok(effectiveBody({ merge_shepherd: { enabled: false } }).agents),
        writes: { "registry:merge_shepherd": write({}) },
      })
    );
    const cell = gateOf(m, "merge_shepherd", "registry:merge_shepherd").effective;
    expect(cell.text).toBe("Off");
    expect(cell.tone).toBe("known");
    expect(cell.readBack).toEqual({ asked: "off", askedText: "off", matches: true });
  });

  it("shows a read-back that disagrees as a contradiction — the value is coord's, not the request", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        effective: ok(
          effectiveBody({
            merge_shepherd: { enabled: true, source: "user_pref" },
          }).agents
        ),
        writes: { "registry:merge_shepherd": write({}) },
      })
    );
    const cell = gateOf(m, "merge_shepherd", "registry:merge_shepherd").effective;
    expect(cell.state).toBe("on");
    expect(cell.tone).toBe("contradiction");
    expect(cell.readBack?.matches).toBe(false);
  });

  it("is UNKNOWN when the write landed but reading it back failed", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        writes: {
          "registry:merge_shepherd": write({ readbackError: "HTTP 503" }),
        },
      })
    );
    const cell = gateOf(m, "merge_shepherd", "registry:merge_shepherd").effective;
    expect(cell.state).toBe("unknown");
    expect(cell.title).toContain("reading it back failed");
  });

  it("keeps coord's value and says the change was refused", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        writes: {
          "registry:merge_shepherd": write({ phase: "refused", error: "HTTP 403" }),
        },
      })
    );
    const cell = gateOf(m, "merge_shepherd", "registry:merge_shepherd").effective;
    expect(cell.state).toBe("on");
    expect(cell.readBack).toBeUndefined();
    expect(cell.writeNote).toContain("was refused: HTTP 403");
  });

  it("compares an autonomy write with the level coord answers, and a dial write with the tenant column", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        nextStep: ok(nextStepBody({ next_step: { autonomy_level: "guidance_only" } })),
        autoFixPr: {
          loading: false,
          error: null,
          state: readAutoFixPr(
            mergeSettingsBody({ tenant: false, resolved: false, source: "tenant" }).profile
          ),
        },
        writes: {
          "autonomy:next_step": write({ asked: "auto_decide" }),
          "dial:auto_fix_pr": write({ asked: "off" }),
        },
      })
    );
    const autonomy = gateOf(m, "next_step_dispatch", "autonomy:next_step").effective;
    expect(autonomy.readBack).toEqual({
      asked: "auto_decide",
      askedText: "Auto",
      matches: false,
    });
    expect(autonomy.tone).toBe("contradiction");
    const dial = gateOf(m, "pr_fix_dispatch", "dial:auto_fix_pr").effective;
    expect(dial.readBack?.matches).toBe(true);
    expect(dial.text).toBe("Off");
  });

  it("says a write is in flight without showing its value", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        writes: { "registry:merge_shepherd": write({ phase: "writing" }) },
      })
    );
    const cell = gateOf(m, "merge_shepherd", "registry:merge_shepherd").effective;
    expect(cell.state).toBe("on");
    expect(cell.writeNote).toBe("Writing off…");
  });
});

describe("presentation mode", () => {
  it("shows no registry name, variable, route or failure text in any gate", () => {
    const m = deriveSpawnPathMatrix(
      inputs({
        presenting: true,
        nextStep: failed("GET /api/v1/operations/coord/next-step-settings failed: 500"),
      })
    );
    const texts = m.rows.flatMap((r) =>
      r.gates.flatMap((g) => [
        g.title,
        g.where,
        g.scopeNote ?? "",
        g.readOnly ?? "",
        g.enforced.text,
        g.effective.text,
        g.effective.title ?? "",
        g.position?.text ?? "",
        g.position?.title ?? "",
      ])
    );
    const joined = texts.join("\n");
    for (const token of [
      "pr_fix_dispatch",
      "COORD_",
      "/coord/",
      "/api/v1",
      "claude_cli",
      "auto_fix_pr",
      "500",
    ]) {
      expect(joined, token).not.toContain(token);
    }
    expect(joined).toContain(FAILURE_REASON_WITHHELD);
  });
});
