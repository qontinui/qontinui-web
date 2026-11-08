/**
 * What each live block's settings may be — the schemas `registry.ts` names
 * (plan `2026-11-07-interactive-stakeholder-reports-in-the-project-overview`
 * D2, D3).
 *
 * `parseBlockArgs` reads the settings as text; these decide what the text may
 * say. Every schema is strict, so a setting a block does not have is an
 * error, and none accepts a URL, HTML or script: values are names (a report's
 * slug, a table's id, a figure from a closed list) and small numbers.
 *
 * Kept apart from the registry so a block can import its own settings' type
 * without importing every other block.
 */

import { z } from "zod";

/** A report's slug: letters and digits of any script, joined by hyphens —
 *  what the server's `slugify` makes. */
export const REPORT_SLUG = z
  .string()
  .max(120)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u)
  .describe("the report's name, as its address writes it");

/** An id inside a snapshot (a table, a figure, a group): the contract's slug. */
const SNAPSHOT_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

/** `all`, or one id. A snapshot id `all` is read as "all". */
const ID_OR_ALL = SNAPSHOT_ID.describe("all, or one id from the report");

/** A success measure's document name: lowercase words joined by hyphens. */
const METRIC_NAME = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
  .describe("the measure's document name");

/** The figures `overview-kpi` can show — a closed list over existing reads. */
export const KPI_FIGURES = [
  "forecast-finish",
  "slip",
  "current-phase",
  "next-gate",
  "work-done",
  "work-in-progress",
  "work-planned",
] as const;

export type KpiFigure = (typeof KPI_FIGURES)[number];

export const overviewKpiArgs = z
  .object({
    figure: z.enum(KPI_FIGURES).describe(`one of: ${KPI_FIGURES.join(", ")}`),
  })
  .strict();

export const overviewTimelineArgs = z.object({}).strict();

export const overviewPlanVsActualArgs = z.object({}).strict();

export const overviewRisksArgs = z
  .object({
    top: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .describe("a whole number from 1 to 99")
      .optional(),
  })
  .strict();

const report = REPORT_SLUG.optional();

export const reportTimelineArgs = z.object({ report }).strict();

export const reportScorecardArgs = z
  .object({
    report,
    table: SNAPSHOT_ID.describe("the id of one of the report's tables"),
  })
  .strict();

export const reportFiguresArgs = z
  .object({ report, set: ID_OR_ALL.optional() })
  .strict();

export const reportItemsArgs = z
  .object({ report, group: ID_OR_ALL.optional() })
  .strict();

export const reportChangesArgs = z.object({ report }).strict();

export const objectiveCheckpointsArgs = z
  .object({ metric: METRIC_NAME })
  .strict();

export type OverviewKpiArgs = z.infer<typeof overviewKpiArgs>;
export type OverviewTimelineArgs = z.infer<typeof overviewTimelineArgs>;
export type OverviewPlanVsActualArgs = z.infer<typeof overviewPlanVsActualArgs>;
export type OverviewRisksArgs = z.infer<typeof overviewRisksArgs>;
export type ReportTimelineArgs = z.infer<typeof reportTimelineArgs>;
export type ReportScorecardArgs = z.infer<typeof reportScorecardArgs>;
export type ReportFiguresArgs = z.infer<typeof reportFiguresArgs>;
export type ReportItemsArgs = z.infer<typeof reportItemsArgs>;
export type ReportChangesArgs = z.infer<typeof reportChangesArgs>;
export type ObjectiveCheckpointsArgs = z.infer<typeof objectiveCheckpointsArgs>;

/** The props every report block is rendered with: its settings, and the
 *  report it shows (its `report:` setting, else the page's bound report). */
export interface ReportBlockProps<A> {
  args: A;
  report: string;
}

/** The props every other block is rendered with. */
export interface DataBlockProps<A> {
  args: A;
}
