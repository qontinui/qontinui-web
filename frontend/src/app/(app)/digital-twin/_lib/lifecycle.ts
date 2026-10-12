/**
 * The software-development lifecycle the twin observes, and the three coupled
 * twins that observe it — the vocabulary of the Lifecycle tab.
 *
 * The twin of the software-development process is three twins: the
 * ENVIRONMENT twin (the system being built and run), the PROCESS twin (the
 * work in flight) and the INTENT twin (what the operator wants). Each manifest
 * row names its twin and the lifecycle stages it observes; the helpers below
 * count, per stage and per twin, how much is live-probed versus only claimed
 * by the manifest. Pure data + pure functions (unit-tested in
 * `lifecycle.test.ts`).
 */

import { claimsBuilt } from "./resolve";
import type {
  LifecycleStage,
  ResolvedSubspace,
  SubspaceManifestEntry,
  TwinPlant,
} from "./types";

/** An existing console page that covers a stage. */
export interface ConsoleLink {
  href: string;
  label: string;
}

export interface LifecycleStageInfo {
  id: LifecycleStage;
  label: string;
  /** The question the twin answers at this stage. */
  description: string;
  /** The human touchpoint that remains at this stage, as plain text. */
  humanTouchpoint: string;
  /**
   * Console pages that already cover the stage. Every href must resolve to a
   * `page.tsx` under `src/app` — `lifecycle.test.ts` checks it on disk.
   */
  consoleLinks: readonly ConsoleLink[];
}

/** The lifecycle, in order: intent → plan → … → learn. */
export const LIFECYCLE_STAGES: readonly LifecycleStageInfo[] = [
  {
    id: "intent",
    label: "Intent",
    description: "What are we building, for whom, and why?",
    humanTouchpoint:
      "The operator authors or ratifies intent documents and rulings; an agent-drafted clause notifies the operator.",
    consoleLinks: [
      { href: "/admin/coord/prompt-documents", label: "Prompt documents" },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    description: "What work exists, who owns it, and is it registered?",
    humanTouchpoint:
      "Operator-only calls a plan cannot settle itself (closed-list escalations); agents author, vet and rank plans.",
    consoleLinks: [
      { href: "/admin/coord/plans", label: "Plans" },
      { href: "/admin/coord/work-units", label: "Work units" },
    ],
  },
  {
    id: "implement",
    label: "Implement",
    description: "Who is changing what, where — and does the code agree?",
    humanTouchpoint:
      "Questions, permission prompts and sessions idle at a prompt — the touches coord's operator-touch write door records.",
    consoleLinks: [{ href: "/sessions", label: "Sessions" }],
  },
  {
    id: "verify",
    label: "Verify",
    description: "Is the change proven to work?",
    humanTouchpoint:
      "Evidence an agent cannot gather itself; CI, gates and page-spec checks run without a human.",
    consoleLinks: [
      { href: "/admin/coord/gates", label: "Gates" },
      { href: "/admin/coord/ci", label: "CI" },
    ],
  },
  {
    id: "integrate",
    label: "Integrate",
    description: "Will it land, when — and if not, why not?",
    humanTouchpoint:
      "A merge escalation on a diagnosed merge-train defect; agents never merge — the train lands PRs.",
    consoleLinks: [{ href: "/admin/coord/prs", label: "Pull requests" }],
  },
  {
    id: "release",
    label: "Release",
    description: "Is it live where it should be?",
    humanTouchpoint:
      "Only what a served policy clause reserves to the operator; the rollout itself is automated.",
    consoleLinks: [
      { href: "/admin/coord/releases", label: "Releases" },
      { href: "/admin/coord/deploys", label: "Deploys" },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    description: "Is it healthy and within budget?",
    humanTouchpoint:
      "Alarms that email a human (CloudWatch alarms go to SNS email); the twin reads none of them yet.",
    consoleLinks: [{ href: "/admin/coord/devops", label: "Dev Ops" }],
  },
  {
    id: "learn",
    label: "Learn",
    description: "Is the twin right, and what did we learn?",
    humanTouchpoint:
      "Labelling agent decisions — the operator's corrections are what measure the intent twin's fidelity.",
    consoleLinks: [
      { href: "/admin/coord/findings", label: "Findings" },
      { href: "/admin/coord/memory", label: "Memory" },
    ],
  },
];

export interface TwinPlantInfo {
  id: TwinPlant;
  label: string;
  description: string;
}

/** The three coupled twins of the software-development process. */
export const TWIN_PLANTS: readonly TwinPlantInfo[] = [
  {
    id: "environment",
    label: "Environment twin",
    description:
      "The system being built and run — code, dependencies, schema, infrastructure, releases and runtime health.",
  },
  {
    id: "process",
    label: "Process twin",
    description:
      "The work in flight — work units, gates, sessions, CI runs, the merge train, findings and the cost of the work.",
  },
  {
    id: "intent",
    label: "Intent twin",
    description:
      "What the operator wants — policy, intent documents, spec claims and operator touches.",
  },
];

/** Look up a stage's presentation; throws on an id outside the lifecycle. */
export function stageInfo(id: LifecycleStage): LifecycleStageInfo {
  const info = LIFECYCLE_STAGES.find((s) => s.id === id);
  if (!info) throw new Error(`unknown lifecycle stage: ${id}`);
  return info;
}

/** Look up a twin's presentation; throws on an unknown id. */
export function twinPlantInfo(id: TwinPlant): TwinPlantInfo {
  const info = TWIN_PLANTS.find((t) => t.id === id);
  if (!info) throw new Error(`unknown twin plant: ${id}`);
  return info;
}

/** The given stages in lifecycle order (unknown ids sort last). */
export function inLifecycleOrder(
  stages: readonly LifecycleStage[]
): LifecycleStage[] {
  const rank = (s: LifecycleStage) => {
    const i = LIFECYCLE_STAGES.findIndex((info) => info.id === s);
    return i === -1 ? LIFECYCLE_STAGES.length : i;
  };
  return [...stages].sort((a, b) => rank(a) - rank(b));
}

/** The rows that observe `stage`, in manifest order. */
export function rowsForStage<T extends Pick<SubspaceManifestEntry, "stages">>(
  rows: readonly T[],
  stage: LifecycleStage
): T[] {
  return rows.filter((r) => r.stages.includes(stage));
}

/**
 * How much of a set of rows the twin observes, and how credibly. Every row
 * lands in exactly one bucket, so
 * `probed + restricted + manifestBuilt + planned + notBuilt === total`.
 */
export interface CoverageCounts {
  /**
   * Snapshot rows — the only rows this page live-probes — that coord did NOT
   * refuse. The denominator of every live count.
   */
  probed: number;
  /**
   * Snapshot rows coord refused for this tenant (cell status `restricted`):
   * an access decision, not a silent observer, so they sit outside `probed`
   * rather than reading as "probed, not answering" (once qontinui-coord#3128 lands, coord refuses the
   * SystemTenant sub-spaces per cell to a non-system tenant).
   */
  restricted: number;
  /** Of `probed`: rows ANSWERING (implemented or partial cell status). */
  live: number;
  /**
   * Of `probed`: rows whose probe is still in flight (cell status `probing`).
   * They have no verdict yet — neither answering nor silent — so while any
   * are pending a view says "probing…" instead of counting them.
   */
  pending: number;
  /**
   * Non-snapshot rows the manifest claims are built (implemented or partial).
   * A claim, not a live verdict.
   */
  manifestBuilt: number;
  /**
   * Of `manifestBuilt`: rows a coord tool answers on demand (cell status
   * `interactive`) — not all of them from Ask the Twin (see `ask_via`).
   */
  interactive: number;
  /** Non-snapshot rows on the roadmap (research status `planned`). */
  planned: number;
  /** Non-snapshot rows with no observer yet (research status `not-yet`). */
  notBuilt: number;
  total: number;
}

/** Count the coverage buckets of `rows` (see {@link CoverageCounts}). */
export function coverageOf(rows: readonly ResolvedSubspace[]): CoverageCounts {
  const counts: CoverageCounts = {
    probed: 0,
    restricted: 0,
    live: 0,
    pending: 0,
    manifestBuilt: 0,
    interactive: 0,
    planned: 0,
    notBuilt: 0,
    total: rows.length,
  };
  for (const r of rows) {
    if (r.query_kind === "snapshot" && r.cellStatus === "restricted") {
      counts.restricted += 1;
    } else if (r.query_kind === "snapshot") {
      counts.probed += 1;
      if (r.cellStatus === "implemented" || r.cellStatus === "partial") {
        counts.live += 1;
      } else if (r.cellStatus === "probing") {
        counts.pending += 1;
      }
    } else if (claimsBuilt(r.research_status)) {
      counts.manifestBuilt += 1;
      if (r.cellStatus === "interactive") counts.interactive += 1;
    } else if (r.research_status === "planned") {
      counts.planned += 1;
    } else {
      counts.notBuilt += 1;
    }
  }
  return counts;
}

/** Per-stage coverage, keyed by every lifecycle stage (empty stages count 0). */
export function stageSummary(
  rows: readonly ResolvedSubspace[]
): Record<LifecycleStage, CoverageCounts> {
  const out = {} as Record<LifecycleStage, CoverageCounts>;
  for (const stage of LIFECYCLE_STAGES) {
    out[stage.id] = coverageOf(rowsForStage(rows, stage.id));
  }
  return out;
}

/** Per-twin coverage, keyed by every twin (an empty twin counts 0). */
export function twinSummary(
  rows: readonly ResolvedSubspace[]
): Record<TwinPlant, CoverageCounts> {
  const out = {} as Record<TwinPlant, CoverageCounts>;
  for (const plant of TWIN_PLANTS) {
    out[plant.id] = coverageOf(rows.filter((r) => r.twin === plant.id));
  }
  return out;
}
