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
 * `probed + manifestBuilt + planned + notBuilt === total`.
 */
export interface CoverageCounts {
  /** Live-probed rows (`liveProbed`) — the only rows with a live verdict. */
  probed: number;
  /** Of `probed`: rows ANSWERING (implemented or partial cell status). */
  live: number;
  /**
   * Of `probed`: rows whose probe is still in flight (cell status `probing`).
   * They have no verdict yet — neither answering nor silent — so while any
   * are pending a view says "probing…" instead of counting them.
   */
  pending: number;
  /**
   * Of `probed`: rows coord answered with its own report (cell status
   * `served`) — an answer, but not a verdict, so neither answering-healthy nor
   * silent.
   */
  served: number;
  /**
   * Of `probed`: rows coord refused to this operator (cell status
   * `restricted` — a Qontinui-internal sub-space, or an admin-only door).
   * Not silent: the observer was never this operator's to read.
   */
  restricted: number;
  /**
   * Of `probed`: rows with no reading at all (cell status `unknown` — the
   * probe failed with nothing held, or answered degraded). Neither answering
   * nor silent: nothing was read, so a view shows UNKNOWN, never a count of
   * them as observers that did not answer.
   */
  unknown: number;
  /**
   * Rows not live-probed that the manifest claims are built (implemented or
   * partial).
   * A claim, not a live verdict.
   */
  manifestBuilt: number;
  /**
   * Of `manifestBuilt`: rows a coord tool answers on demand (cell status
   * `interactive`) — not all of them from Ask the Twin (see `ask_via`).
   */
  interactive: number;
  /** Rows not live-probed on the roadmap (research status `planned`). */
  planned: number;
  /** Rows not live-probed with no observer yet (research status `not-yet`). */
  notBuilt: number;
  total: number;
}

/**
 * Of `probed`: the rows that could answer THIS operator with a verdict — not a
 * report (`served`) and not refused (`restricted`). The denominator of
 * "live-probed, answering".
 */
export function gradedOf(c: CoverageCounts): number {
  return c.probed - c.served - c.restricted;
}

/** Count the coverage buckets of `rows` (see {@link CoverageCounts}). */
export function coverageOf(rows: readonly ResolvedSubspace[]): CoverageCounts {
  const counts: CoverageCounts = {
    probed: 0,
    live: 0,
    pending: 0,
    served: 0,
    restricted: 0,
    unknown: 0,
    manifestBuilt: 0,
    interactive: 0,
    planned: 0,
    notBuilt: 0,
    total: rows.length,
  };
  for (const r of rows) {
    if (r.liveProbed) {
      counts.probed += 1;
      if (r.cellStatus === "implemented" || r.cellStatus === "partial") {
        counts.live += 1;
      } else if (r.cellStatus === "probing") {
        counts.pending += 1;
      } else if (r.cellStatus === "served") {
        counts.served += 1;
      } else if (r.cellStatus === "restricted") {
        counts.restricted += 1;
      } else if (r.cellStatus === "unknown") {
        counts.unknown += 1;
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
