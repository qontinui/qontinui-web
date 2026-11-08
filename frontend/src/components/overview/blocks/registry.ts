/**
 * The live blocks a fenced code block can name in any overview markdown —
 * the ONE list `MarkdownView` renders from (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2,
 * D3; Phase 9 of `2026-09-19-project-overview-for-business-leaders` named the
 * first four).
 *
 * A fence whose language is a name here renders that block's component; any
 * other fence renders exactly as before. A fence whose language starts with
 * one of {@link BLOCK_NAME_PREFIXES} but is not registered renders a visible
 * "This block isn't available" notice — never a silent nothing — unless the
 * language is real code that shares the prefix
 * ({@link CODE_LANGUAGES_WITH_BLOCK_PREFIX}: Objective-C and its relatives),
 * which renders as code.
 *
 * ## Self-enforcing
 *
 * `registry.test.ts` holds the plan's D3 table written out by hand and fails
 * when this list and that table disagree in either direction, and it fails
 * an entry whose `module` has no component file, or no test file that
 * renders the block through a fence (in the style of `sections.ts` and
 * `console/consoleSurfaces.ts`). Adding a block is one row here, its
 * component, and its test.
 *
 * ## Adding a block
 *
 * Give it a strict zod schema in `blockArgs.ts` (every key it accepts; no
 * URL, HTML or script among them), a component in this directory, loaded
 * lazily below (never imported directly), a `<Component>.test.tsx` that
 * renders it through `PageBody` or `IntentSection`, and a row below. A report
 * block reads its report only from `ReportContext` — never a fetch of its own
 * (D2).
 */

import { lazy, type ComponentType } from "react";
import type { z } from "zod";
import {
  objectiveCheckpointsArgs,
  overviewKpiArgs,
  overviewPlanVsActualArgs,
  overviewRisksArgs,
  overviewTimelineArgs,
  reportChangesArgs,
  reportFiguresArgs,
  reportItemsArgs,
  reportScorecardArgs,
  reportTimelineArgs,
  type DataBlockProps,
  type ReportBlockProps,
} from "./blockArgs";

// Each block's component loads only when a document shows that block.
// `MarkdownView` is on every overview page; importing the blocks here would
// pull all of them, and recharts with them, into every one of those pages.
// `LiveBlock` shows a loading notice while one loads, and a notice if it
// cannot.
const ObjectiveCheckpoints = lazy(() =>
  import("./ObjectiveCheckpoints").then((m) => ({
    default: m.ObjectiveCheckpoints,
  }))
);
const OverviewKpi = lazy(() =>
  import("./OverviewKpi").then((m) => ({ default: m.OverviewKpi }))
);
const OverviewPlanVsActual = lazy(() =>
  import("./OverviewPlanVsActual").then((m) => ({
    default: m.OverviewPlanVsActual,
  }))
);
const OverviewRisks = lazy(() =>
  import("./OverviewRisks").then((m) => ({ default: m.OverviewRisks }))
);
const OverviewTimeline = lazy(() =>
  import("./OverviewTimeline").then((m) => ({ default: m.OverviewTimeline }))
);
const ReportChanges = lazy(() =>
  import("./ReportChanges").then((m) => ({ default: m.ReportChanges }))
);
const ReportFigures = lazy(() =>
  import("./ReportFigures").then((m) => ({ default: m.ReportFigures }))
);
const ReportItems = lazy(() =>
  import("./ReportItems").then((m) => ({ default: m.ReportItems }))
);
const ReportScorecard = lazy(() =>
  import("./ReportScorecard").then((m) => ({ default: m.ReportScorecard }))
);
const ReportTimeline = lazy(() =>
  import("./ReportTimeline").then((m) => ({ default: m.ReportTimeline }))
);

/** A fence language with one of these prefixes is meant as a block. */
export const BLOCK_NAME_PREFIXES = [
  "overview-",
  "report-",
  "objective-",
] as const;

/**
 * Code languages whose names happen to start with a block prefix. A fence
 * tagged with one is code, never a block: `objective-` is reserved for blocks,
 * but Objective-C, Objective-C++ and Objective-J are real languages. Matched
 * without regard to case (` ```Objective-C ` is the same language).
 */
export const CODE_LANGUAGES_WITH_BLOCK_PREFIX = [
  "objective-c",
  "objective-c++",
  "objective-cpp",
  "objective-j",
] as const;

const CODE_LANGUAGES = new Set<string>(CODE_LANGUAGES_WITH_BLOCK_PREFIX);

type Settings = Record<string, unknown>;

interface EntryBase {
  /** The fence's language: ` ```report-scorecard `. */
  name: string;
  /** The setting a bare value on the fence's first line is read as. */
  positional?: string;
  /** What the block shows, in a writer's words. */
  description: string;
  /** False while the block can only say its data isn't built yet. */
  available: boolean;
  /** The component's file in this directory, without `.tsx`. */
  module: string;
}

export type BlockEntry = EntryBase & {
  /** Every setting the block accepts, and what each may be. */
  args: z.AnyZodObject;
} & (
    | {
        /** Reads one report from `ReportContext`; takes `report: <slug>`. */
        kind: "report";
        component: ComponentType<ReportBlockProps<Settings>>;
      }
    | {
        /** Reads the overview's own live data. */
        kind: "overview" | "objective";
        component: ComponentType<DataBlockProps<Settings>>;
      }
  );

function reportBlock<S extends z.AnyZodObject>(
  entry: EntryBase & {
    args: S;
    component: ComponentType<ReportBlockProps<z.infer<S>>>;
  }
): BlockEntry {
  return { ...entry, kind: "report" } as unknown as BlockEntry;
}

function dataBlock<S extends z.AnyZodObject>(
  kind: "overview" | "objective",
  entry: EntryBase & {
    args: S;
    component: ComponentType<DataBlockProps<z.infer<S>>>;
  }
): BlockEntry {
  return { ...entry, kind } as unknown as BlockEntry;
}

export const BLOCKS: readonly BlockEntry[] = [
  dataBlock("overview", {
    name: "overview-kpi",
    args: overviewKpiArgs,
    positional: "figure",
    component: OverviewKpi,
    description:
      "One headline figure, with its source and as-of: when the project is expected to finish, how far it has slipped, where it is now, its next gate, or how much of its work is done, in progress or planned.",
    available: true,
    module: "OverviewKpi",
  }),
  dataBlock("overview", {
    name: "overview-timeline",
    args: overviewTimelineArgs,
    component: OverviewTimeline,
    description:
      "The Timeline's chart of phases, planned against actual, read-only.",
    available: true,
    module: "OverviewTimeline",
  }),
  dataBlock("overview", {
    name: "overview-plan-vs-actual",
    args: overviewPlanVsActualArgs,
    component: OverviewPlanVsActual,
    description:
      "Each phase's planned dates against what happened or is now expected, with how far it has slipped, in words.",
    available: true,
    module: "OverviewPlanVsActual",
  }),
  dataBlock("overview", {
    name: "overview-risks",
    args: overviewRisksArgs,
    component: OverviewRisks,
    description:
      "The project's top risks. Risks are not built yet, so it says so.",
    available: false,
    module: "OverviewRisks",
  }),
  reportBlock({
    name: "report-timeline",
    args: reportTimelineArgs,
    component: ReportTimeline,
    description:
      "A report's stops, one per snapshot. Choosing a stop changes every other block of that report on the page.",
    available: true,
    module: "ReportTimeline",
  }),
  reportBlock({
    name: "report-scorecard",
    args: reportScorecardArgs,
    component: ReportScorecard,
    description:
      "One of a report's score tables at the chosen stop, each score with its change since the stop before.",
    available: true,
    module: "ReportScorecard",
  }),
  reportBlock({
    name: "report-figures",
    args: reportFiguresArgs,
    component: ReportFigures,
    description:
      "A report's headline figures at the chosen stop: value, baseline, target, verdict, source and a small trend.",
    available: true,
    module: "ReportFigures",
  }),
  reportBlock({
    name: "report-items",
    args: reportItemsArgs,
    component: ReportItems,
    description:
      "A report's status list at the chosen stop, in plain words, with what changed since the stop before.",
    available: true,
    module: "ReportItems",
  }),
  reportBlock({
    name: "report-changes",
    args: reportChangesArgs,
    component: ReportChanges,
    description:
      "What changed between the chosen stop and the one before it, in sentences.",
    available: true,
    module: "ReportChanges",
  }),
  dataBlock("objective", {
    name: "objective-checkpoints",
    args: objectiveCheckpointsArgs,
    component: ObjectiveCheckpoints,
    description: "A success measure's checkpoint results.",
    available: true,
    module: "ObjectiveCheckpoints",
  }),
];

const BY_NAME = new Map(BLOCKS.map((b) => [b.name, b] as const));

export function findBlock(name: string): BlockEntry | undefined {
  return BY_NAME.get(name);
}

/** Whether a fence's language names a block — registered, or meant as one.
 *  A code language that shares a block prefix never does. */
export function isBlockName(language: string): boolean {
  if (CODE_LANGUAGES.has(language.toLowerCase())) return false;
  return (
    BY_NAME.has(language) ||
    BLOCK_NAME_PREFIXES.some((prefix) => language.startsWith(prefix))
  );
}
