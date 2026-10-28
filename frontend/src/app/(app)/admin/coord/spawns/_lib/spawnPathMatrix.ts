/**
 * spawnPathMatrix — one row per spawn path, built from what coord serves (plan
 * `2026-10-23-console-presentation-spaces` Phase 4).
 *
 * ## Where each row comes from
 *
 * 1. **Served.** Every row coord's agent registry serves (the effective fold,
 *    and the raw tenant defaults) that is a SPAWN PATH: a kind of the spawn
 *    contract (`spawnPathContract.ts`), a class switch, or any row whose spawn
 *    path is `standing_continuation` — a session coord starts on its own,
 *    which is how a kind newer than this build's copy of the contract still
 *    gets its row. Agent ROLE rows (`code-reviewer` …) are Agent-tool roles,
 *    not paths: counted, and left to the agent registry page.
 * 2. **Contract.** A contract kind or seeded class that no read served (an
 *    older coord, or a read that failed): its row stays, and every value on it
 *    is UNKNOWN with the reason — a missing path is never silently absent.
 * 3. **Hand-kept.** `UNSERVED_PATHS`: the post-merge follow-up and the
 *    runner-local paths. `spawnPathContract.test.ts` pins that no hand-kept
 *    row shadows a served name.
 *
 * ## What each row carries
 *
 * Its gates (the model is `spawnPathGates.ts`), primary first: a coord path's
 * own registry row (`registryGates.ts`), then every other switch this console
 * can read that governs it — its class row (a mirror of that row's value),
 * the merge-settings dial or knob of a fixer (`mergeSettingsGates.ts`: the
 * PR fixer's `auto_fix_pr`, the red-main fixer's `auto_fix_red_main`, the
 * stalled-train responder's `auto_fix_admission_stall`), and the next-step
 * autonomy level and fleet flag of a dispatch arm (`nextStepGates.ts`). And
 * when it last spawned (`spawnPathLastSpawned.ts`). The rows are never folded
 * into one verdict per path: each gate's value is the one coord serves for it.
 */

import type {
  AdminAgentRegistryRow,
  AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import type { NextStepSettings } from "@/lib/api/operations/coordSettings";
import {
  UNSERVED_PATHS,
  servedPathWords,
  type ServedPathWords,
  type UnservedPath,
} from "./spawnPathCatalog";
import {
  SEEDED_CLASS_ROWS,
  SPAWN_KIND_SEEDS,
  isSpawnClass,
  kindSeed,
} from "./spawnPathContract";
import type {
  FollowupRead,
  MatrixGate,
  MergeSettingsRead,
  ReadPart,
  SwitchWrite,
} from "./spawnPathGates";
import { mirrorGate, registryGate } from "./registryGates";
import { autonomyGate, fleetFlagGate } from "./nextStepGates";
import {
  admissionStallKnobGate,
  fixerDialGate,
  redMainKnobGate,
} from "./mergeSettingsGates";
import { followupScopeGate, runnerGate } from "./followupGates";
import {
  lastSpawnedCell,
  type LastSpawnedCell,
  type LedgerListView,
} from "./spawnPathLastSpawned";

export interface MatrixInputs {
  effective: ReadPart<AgentRegistryEntry[]>;
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  nextStep: ReadPart<NextStepSettings>;
  mergeSettings: MergeSettingsRead;
  followup: FollowupRead;
  ledger: LedgerListView;
  /** The matrix's writes in flight or done, by gate key. */
  writes: Readonly<Record<string, SwitchWrite>>;
  presenting: boolean;
}

/** Where a row's existence comes from (see the module doc). */
export type RowSource = "served" | "contract" | "hand";

export interface MatrixRow {
  /** The registry name for a coord path; the hand-kept key otherwise. */
  key: string;
  label: string;
  summary: string;
  startedBy: "coord" | "runner";
  /** Sessions a person asks for (the console's launcher), not started on its own. */
  startedByPerson: boolean;
  source: RowSource;
  isClass: boolean;
  /** Primary first. Never empty. */
  gates: MatrixGate[];
  lastSpawned: LastSpawnedCell;
}

/** The rows by kind, for the section's note: what the matrix lists, counted. */
export interface MatrixCounts {
  /** Paths the coordination service starts on its own. */
  automatic: number;
  /** Paths a person starts (the console's launcher). */
  person: number;
  /** Class switches, each governing many paths at once. */
  classes: number;
  /** Paths each machine starts on its own. */
  runner: number;
}

export interface SpawnPathMatrix {
  rows: MatrixRow[];
  counts: MatrixCounts;
  /**
   * Served registry rows that are agent ROLES, not spawn paths; `null` when
   * neither registry read has answered.
   */
  roleRows: number | null;
}

/**
 * The plan's order — the dispatch arms, then the continuations, then the
 * rest coord serves, the class switches, and the runner-local paths. A name
 * not listed sorts after the listed coord paths, before the class switches.
 */
const ROW_ORDER: readonly string[] = [
  "next_step_dispatch",
  "pr_fix_dispatch",
  "red_main_fix_dispatch",
  "admission_stall_fix_dispatch",
  "merge_shepherd",
  "gate_continuation",
  "post_merge_followup",
  "unit_continuation",
  "condition_autodispatch",
  "operator_page_remediation",
  "onboarding_audit",
  "operator_spawn",
];

const RUNNER_ORDER: readonly string[] = [
  "runner_stewards",
  "runner_scheduler",
  "account_migration",
];

function rank(row: MatrixRow): number {
  const listed = ROW_ORDER.indexOf(row.key);
  if (listed >= 0) return listed;
  if (row.isClass) return 2000;
  const runner = RUNNER_ORDER.indexOf(row.key);
  if (runner >= 0) return 3000 + runner;
  return 1000;
}

/** Whether a served registry row is a spawn path rather than an agent role. */
export function isSpawnPathRow(
  name: string,
  spawnPath: string | null
): boolean {
  return (
    kindSeed(name) !== undefined ||
    isSpawnClass(name) ||
    spawnPath === "standing_continuation"
  );
}

/** Every served name, with the spawn path a read gave it. */
function servedNames(inputs: MatrixInputs): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of inputs.effective.data ?? []) {
    out.set(r.agent_name, r.spawn_path || null);
  }
  for (const r of inputs.defaults.data ?? []) {
    if (!out.has(r.agent_name)) out.set(r.agent_name, r.spawn_path || null);
  }
  return out;
}

/** The class row a kind's spawn path names, when coord seeds one. */
function classOf(spawnPath: string | null): string | null {
  if (spawnPath === null || !isSpawnClass(spawnPath)) return null;
  return (SEEDED_CLASS_ROWS as readonly string[]).includes(spawnPath)
    ? spawnPath
    : null;
}

/** A mirror of another registry row onto a path, read-only. */
function mirrorOf(name: string, inputs: MatrixInputs): MatrixGate {
  const words = servedPathWords(name, name);
  return mirrorGate({
    name,
    words,
    effective: inputs.effective,
    defaults: inputs.defaults,
    presenting: inputs.presenting,
    mirrorLabel: words.label,
  });
}

function coordRow(
  name: string,
  spawnPath: string | null,
  source: RowSource,
  inputs: MatrixInputs
): MatrixRow {
  const words: ServedPathWords = servedPathWords(name, spawnPath);
  const { presenting } = inputs;
  const gates: MatrixGate[] = [
    registryGate({
      name,
      words,
      effective: inputs.effective,
      defaults: inputs.defaults,
      write: inputs.writes[`registry:${name}`],
      presenting,
    }),
  ];
  const cls = words.isClass ? null : classOf(spawnPath);
  if (cls !== null) gates.push(mirrorOf(cls, inputs));
  if (words.tenantDial === "auto_fix_pr") {
    gates.push(
      fixerDialGate(
        inputs.mergeSettings,
        inputs.writes["dial:auto_fix_pr"],
        presenting
      )
    );
  }
  if (words.tenantKnob === "auto_fix_red_main") {
    gates.push(
      redMainKnobGate(
        inputs.mergeSettings,
        inputs.writes["knob:auto_fix_red_main"],
        presenting
      )
    );
  }
  if (words.tenantKnob === "auto_fix_admission_stall") {
    gates.push(admissionStallKnobGate(inputs.mergeSettings, presenting));
  }
  if (words.nextStepDomain) {
    const domain = words.nextStepDomain;
    gates.push(
      autonomyGate(
        inputs.nextStep,
        domain,
        inputs.writes[`autonomy:${domain}`],
        presenting
      ),
      fleetFlagGate(inputs.nextStep, domain, presenting)
    );
  }
  return {
    key: name,
    label: words.label,
    summary: words.summary,
    startedBy: "coord",
    startedByPerson: words.startedByPerson === true,
    source,
    isClass: words.isClass === true,
    gates,
    lastSpawned: lastSpawnedCell(inputs.ledger, {
      origin: words.ledgerOrigin,
      blind: words.isClass
        ? "a class switch governs several paths, and the ledger records each request under its own origin"
        : "the ledger records this path under an origin it shares with other paths, so no field names it",
    }),
  };
}

function handRow(path: UnservedPath, inputs: MatrixInputs): MatrixRow {
  const { presenting } = inputs;
  let gates: MatrixGate[];
  if (path.key === "post_merge_followup") {
    gates = [
      followupScopeGate(inputs.followup, presenting),
      mirrorOf("gate_continuation", inputs),
      mirrorOf("standing_continuation", inputs),
    ];
  } else {
    gates = [
      runnerGate(
        path.key,
        path.where ?? {
          operator: "Set on each runner.",
          presented: "Switched on each machine.",
        },
        presenting
      ),
    ];
  }
  return {
    key: path.key,
    label: path.label,
    summary: path.summary,
    startedBy: path.startedBy,
    startedByPerson: false,
    source: "hand",
    isClass: false,
    gates,
    lastSpawned: lastSpawnedCell(inputs.ledger, {
      origin: path.ledgerOrigin,
      blind:
        path.ledgerBlind ?? "the ledger carries no field that names this path",
      partial: path.ledgerPartial,
    }),
  };
}

function countRows(rows: readonly MatrixRow[]): MatrixCounts {
  const counts: MatrixCounts = {
    automatic: 0,
    person: 0,
    classes: 0,
    runner: 0,
  };
  for (const row of rows) {
    if (row.isClass) counts.classes += 1;
    else if (row.startedBy === "runner") counts.runner += 1;
    else if (row.startedByPerson) counts.person += 1;
    else counts.automatic += 1;
  }
  return counts;
}

/** The matrix: one row per spawn path, in the plan's order. */
export function deriveSpawnPathMatrix(inputs: MatrixInputs): SpawnPathMatrix {
  const served = servedNames(inputs);
  const rows: MatrixRow[] = [];
  const seen = new Set<string>();
  let roleRows = 0;
  for (const [name, spawnPath] of served) {
    if (!isSpawnPathRow(name, spawnPath)) {
      roleRows += 1;
      continue;
    }
    rows.push(coordRow(name, spawnPath, "served", inputs));
    seen.add(name);
  }
  for (const seed of SPAWN_KIND_SEEDS) {
    if (seen.has(seed.agentName)) continue;
    rows.push(coordRow(seed.agentName, seed.spawnPath, "contract", inputs));
    seen.add(seed.agentName);
  }
  for (const cls of SEEDED_CLASS_ROWS) {
    if (seen.has(cls)) continue;
    rows.push(coordRow(cls, cls, "contract", inputs));
    seen.add(cls);
  }
  // The hand list is for what nothing serves: a path coord has started
  // serving under the same name is coord's row, not a second one.
  for (const path of UNSERVED_PATHS) {
    if (!seen.has(path.key)) rows.push(handRow(path, inputs));
  }
  rows.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  const answered =
    inputs.effective.data !== null || inputs.defaults.data !== null;
  return {
    rows,
    counts: countRows(rows),
    roleRows: answered ? roleRows : null,
  };
}
