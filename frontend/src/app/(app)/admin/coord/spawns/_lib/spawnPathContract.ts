/**
 * spawnPathContract — the spawn kinds and class switches coord's agent
 * registry is seeded with, copied from the canonical contract.
 *
 * The contract is qontinui-schemas `rust/src/spawn_authorization.json`
 * (`kind_seeds`, and the `class_seeds` marked `seeded`). Coord compiles it in
 * and SERVES it: every registry read seeds a missing kind row first
 * (`agent_registry::ensure_spawn_kind_seeds`), so each kind below arrives as a
 * served row of the effective registry. The spawn-path matrix
 * (`spawnPathMatrix.ts`) builds its coord rows from what coord serves; this
 * copy is what tells a served SPAWN KIND apart from an agent ROLE row
 * (`code-reviewer` and the like, which are Agent-tool roles, not spawn paths),
 * and what keeps a kind on the matrix — as UNKNOWN — when a coord build serves
 * no row for it.
 *
 * Only the two fields the matrix reads are copied (`agent_name`, `spawn_path`).
 * `spawnPathContract.test.ts` holds this copy to the contract at the commit
 * `spawn-contract.pin.toml` pins, in every lane as well as locally: it must hold exactly
 * these kinds and seeded classes, so bumping the pin past a new kind fails the
 * test until the matrix knows it. That file is the one record of which commit
 * this copy was taken from.
 */

/** Where this copy came from. */
export const SPAWN_CONTRACT_SOURCE = {
  repo: "qontinui-schemas",
  path: "rust/src/spawn_authorization.json",
} as const;

/** The per-path class names (`spawn_paths`). Each is also a registry key. */
export const SPAWN_CLASSES = [
  "in_session_subagent",
  "parallel_fanout",
  "standing_continuation",
] as const;

export type SpawnClass = (typeof SPAWN_CLASSES)[number];

/** One `kind_seeds` entry. */
export interface SpawnKindSeed {
  readonly agentName: string;
  readonly spawnPath: SpawnClass;
}

/** `kind_seeds`, in the contract's order. */
export const SPAWN_KIND_SEEDS: readonly SpawnKindSeed[] = [
  { agentName: "operator_spawn", spawnPath: "in_session_subagent" },
  { agentName: "gate_continuation", spawnPath: "standing_continuation" },
  { agentName: "unit_continuation", spawnPath: "standing_continuation" },
  { agentName: "next_step_dispatch", spawnPath: "standing_continuation" },
  { agentName: "pr_fix_dispatch", spawnPath: "standing_continuation" },
  { agentName: "red_main_fix_dispatch", spawnPath: "standing_continuation" },
  {
    agentName: "admission_stall_fix_dispatch",
    spawnPath: "standing_continuation",
  },
  { agentName: "merge_shepherd", spawnPath: "standing_continuation" },
  { agentName: "condition_autodispatch", spawnPath: "standing_continuation" },
  { agentName: "onboarding_audit", spawnPath: "standing_continuation" },
  {
    agentName: "operator_page_remediation",
    spawnPath: "standing_continuation",
  },
];

/**
 * The class switches coord seeds as registry rows (`class_seeds` with
 * `seeded: true`). `in_session_subagent` is deliberately not seeded — the
 * runner's no-row branch for it already allows — but an operator can still
 * create that row by hand, so a SERVED row with that name is still a class
 * switch (`isSpawnClass`).
 */
export const SEEDED_CLASS_ROWS: readonly SpawnClass[] = [
  "parallel_fanout",
  "standing_continuation",
];

/** Whether `name` is one of the contract's spawn classes. */
export function isSpawnClass(name: string): name is SpawnClass {
  return (SPAWN_CLASSES as readonly string[]).includes(name);
}

/** The contract's seed for a kind, or `undefined` for any other name. */
export function kindSeed(agentName: string): SpawnKindSeed | undefined {
  return SPAWN_KIND_SEEDS.find((k) => k.agentName === agentName);
}
