/**
 * Which plans move each twin sub-space — the join behind the Twin map (plan
 * `2026-10-23-console-presentation-spaces` Phase 5).
 *
 * A sub-space's plans are its manifest `plan` slug ∪ every work unit whose
 * `metadata.area` is one of its manifest `areas`. The work units are the ones
 * the console already reads for `/admin/coord/work-units` (coord's work-unit
 * list, walked in authoring order — `useTwinWorkUnits`); nothing here fetches.
 *
 * What a join over a READ may and may not claim:
 *
 * - An explicit slug that is not among the units read is UNKNOWN when the read
 *   was partial, and "not a registered work unit" only when the read reached
 *   the end of coord's list. The link to its work-unit page is kept either
 *   way: that page answers for itself.
 * - A mapped area no unit carries is DRIFT between the manifest and the
 *   tenant's work units (`unmatchedAreas`), never "this sub-space has no
 *   plans" — and it is computed only over a complete read, because a partial
 *   one cannot tell a missing area from an unread page.
 *
 * `area` is coord's ONE steering key, kebab-case and matched exactly
 * (`work_unit_registry.rs` `ListQuery::area`): `Area`, `topic` and friends are
 * not it, and a non-kebab value can never match an area filter, so neither is
 * read as an area here.
 *
 * Pure functions (unit-tested in `twin-plans.test.ts`).
 */

import {
  derivePlanStatus,
  describePlanStatus,
  isTerminalPlanStatus,
  planRowTime,
  type CoordPlanRow,
  type PlanStatusTone,
} from "@/components/admin/coord/planStatus";
import type { RowStatus } from "@/components/console";
import type { WalkOutcome } from "@/app/(app)/admin/coord/work-units/planWalk";
import { operationsErrorReading } from "@/lib/api/operations/base";
import { failureStatus } from "./failure-text";
import type { SubspaceManifestEntry } from "./types";

/** coord's spelling rule for an `area` an area filter can match. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether `value` is spelled as coord's area filter can match it. */
export function isAreaSpelling(value: string): boolean {
  return KEBAB_CASE.test(value);
}

/**
 * A work unit's area: `metadata.area` when it is a kebab-case string, else
 * `null` (no metadata, no area, or a value no area filter could match).
 */
export function workUnitArea(
  unit: Pick<CoordPlanRow, "metadata">
): string | null {
  const area = unit.metadata?.area;
  return typeof area === "string" && isAreaSpelling(area) ? area : null;
}

/**
 * Every repository a work unit names, for the presentation lens's redaction
 * (which shows free text only when EVERY repository is provably
 * first-party): `metadata.repo`, each of `metadata.repos`, and the repository
 * its plan document lives in (`metadata.source_path`'s first segment, the
 * scanner's `<repo>/<dir>` form). coord serves these as bare names, with no
 * owner, so under D3.3 they withhold rather than clear — a plan unit's title
 * becomes its descriptor in presentation mode until coord serves an owner.
 */
export function workUnitRepos(unit: Pick<CoordPlanRow, "metadata">): string[] {
  const meta = unit.metadata;
  if (!meta) return [];
  const repos: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) repos.push(value.trim());
  };
  push(meta.repo);
  if (Array.isArray(meta.repos)) meta.repos.forEach(push);
  if (typeof meta.source_path === "string") {
    push(meta.source_path.split(/[\\/]/)[0]);
  }
  return [...new Set(repos)];
}

/** The work units read, indexed for the join. */
export interface WorkUnitIndex {
  readonly bySlug: ReadonlyMap<string, CoordPlanRow>;
  readonly byArea: ReadonlyMap<string, readonly CoordPlanRow[]>;
  /**
   * The read reached the end of coord's list, so absence from it is evidence
   * (within `planWalk.ts`'s one stated bound on a keyset walk).
   */
  readonly complete: boolean;
}

export function indexWorkUnits(
  units: readonly CoordPlanRow[],
  complete: boolean
): WorkUnitIndex {
  const bySlug = new Map<string, CoordPlanRow>();
  const byArea = new Map<string, CoordPlanRow[]>();
  for (const unit of units) {
    if (bySlug.has(unit.slug)) continue;
    bySlug.set(unit.slug, unit);
    const area = workUnitArea(unit);
    if (area === null) continue;
    const list = byArea.get(area);
    if (list) list.push(unit);
    else byArea.set(area, [unit]);
  }
  return { bySlug, byArea, complete };
}

/** Why a plan is tied to a sub-space. */
export type PlanLinkVia =
  | { readonly kind: "plan" }
  | { readonly kind: "area"; readonly area: string };

export interface ResolvedPlan {
  readonly slug: string;
  /**
   * The work unit, or `null` when the slug is not among the units read — see
   * {@link WorkUnitIndex.complete} for what that absence means.
   */
  readonly unit: CoordPlanRow | null;
  readonly via: readonly PlanLinkVia[];
}

export interface SubspacePlans {
  readonly plans: readonly ResolvedPlan[];
  /**
   * Mapped areas no unit read carries — manifest/corpus drift. `null` on a
   * partial read, which cannot tell a missing area from an unread page.
   */
  readonly unmatchedAreas: readonly string[] | null;
}

/** One sub-space's plans: its `plan` slug ∪ its areas' units, by slug. */
export function plansForSubspace(
  entry: Pick<SubspaceManifestEntry, "plan" | "areas">,
  index: WorkUnitIndex
): SubspacePlans {
  const bySlug = new Map<
    string,
    { unit: CoordPlanRow | null; via: PlanLinkVia[] }
  >();
  const add = (slug: string, unit: CoordPlanRow | null, via: PlanLinkVia) => {
    const seen = bySlug.get(slug);
    if (seen) seen.via.push(via);
    else bySlug.set(slug, { unit, via: [via] });
  };

  const explicit = entry.plan?.trim();
  if (explicit)
    add(explicit, index.bySlug.get(explicit) ?? null, { kind: "plan" });

  const unmatched: string[] = [];
  for (const area of entry.areas ?? []) {
    const units = index.byArea.get(area);
    if (!units || units.length === 0) {
      unmatched.push(area);
      continue;
    }
    for (const unit of units) add(unit.slug, unit, { kind: "area", area });
  }

  return {
    plans: [...bySlug.entries()].map(([slug, { unit, via }]) => ({
      slug,
      unit,
      via,
    })),
    unmatchedAreas: index.complete ? unmatched : null,
  };
}

/** A plan of a set of sub-spaces, with the sub-spaces it moves. */
export interface GroupPlan extends ResolvedPlan {
  /** The ids of the sub-spaces it is tied to, in the order given. */
  readonly subspaces: readonly string[];
}

/** The plans of several sub-spaces (an aspect), deduplicated by slug and sorted. */
export function plansForSubspaces(
  entries: readonly Pick<SubspaceManifestEntry, "id" | "plan" | "areas">[],
  index: WorkUnitIndex
): GroupPlan[] {
  const bySlug = new Map<
    string,
    { unit: CoordPlanRow | null; via: PlanLinkVia[]; subspaces: string[] }
  >();
  for (const entry of entries) {
    for (const plan of plansForSubspace(entry, index).plans) {
      const seen = bySlug.get(plan.slug);
      if (!seen) {
        bySlug.set(plan.slug, {
          unit: plan.unit,
          via: [...plan.via],
          subspaces: [entry.id],
        });
        continue;
      }
      if (!seen.subspaces.includes(entry.id)) seen.subspaces.push(entry.id);
      for (const via of plan.via) {
        if (!seen.via.some((v) => sameVia(v, via))) seen.via.push(via);
      }
    }
  }
  return sortPlans(
    [...bySlug.entries()].map(([slug, { unit, via, subspaces }]) => ({
      slug,
      unit,
      via,
      subspaces,
    }))
  );
}

function sameVia(a: PlanLinkVia, b: PlanLinkVia): boolean {
  if (a.kind === "plan" || b.kind === "plan") return a.kind === b.kind;
  return a.area === b.area;
}

// ---------------------------------------------------------------------------
// Progress: what a plan's live status says about the sub-spaces it moves.
// ---------------------------------------------------------------------------

/**
 * A plan's progress, from its live coord status. `unknown` covers both a
 * status this console has no word for (coord's status is opaque text) and a
 * slug that is not among the units read — never "not started".
 */
export type PlanProgress =
  | "in-flight"
  | "blocked"
  | "queued"
  | "unknown"
  | "done";

/** Display order: what is moving, what is stuck, what waits, what we cannot say, what is finished. */
export const PLAN_PROGRESS_ORDER: readonly PlanProgress[] = [
  "in-flight",
  "blocked",
  "queued",
  "unknown",
  "done",
];

/** Plain-language labels, for counts and headings. */
export const PLAN_PROGRESS_LABEL: Readonly<Record<PlanProgress, string>> = {
  "in-flight": "in progress",
  blocked: "blocked",
  queued: "queued",
  unknown: "status unknown",
  done: "shipped or closed",
};

export function planProgress(
  unit: Pick<CoordPlanRow, "status"> | null
): PlanProgress {
  if (!unit) return "unknown";
  // Terminal first: coord accepts free-text terminal spellings (`done`,
  // `landed`, `complete`) the status vocabulary has no tag for.
  if (isTerminalPlanStatus(unit.status)) return "done";
  switch (describePlanStatus(unit.status).tone) {
    case "active":
      return "in-flight";
    case "blocked":
      return "blocked";
    case "pending":
    case "ready":
      return "queued";
    case "shipped":
    case "closed":
      return "done";
    case "unknown":
      return "unknown";
  }
}

/**
 * A plan's status badge as presentation mode shows it (plan
 * `2026-10-23-console-presentation-spaces` D3.3): words from a FIXED
 * vocabulary only. coord's status is opaque text, and the console renders a
 * word it does not recognise verbatim — right for the operator, who must see
 * what coord holds, but free text an outsider must not be shown: a tenant can
 * write anything there (`waiting-on-<client>`). So a recognised status keeps
 * its word; an unrecognised one says its progress class instead ("Status
 * unknown", or "Shipped or closed" for a terminal spelling such as `landed`);
 * and the free-text phase (`current_phase`, the badge's reason) is dropped.
 * The tone — the badge's colour — stays the console's own reading.
 */
export function presentedPlanStatus(
  unit: Pick<CoordPlanRow, "status">
): RowStatus<PlanStatusTone> {
  const status = derivePlanStatus({ status: unit.status });
  if (describePlanStatus(unit.status).recognised) return status;
  const word = PLAN_PROGRESS_LABEL[planProgress(unit)];
  return { ...status, label: word.charAt(0).toUpperCase() + word.slice(1) };
}

/** How many plans sit in each progress class. Every class is present. */
export function countByProgress(
  plans: readonly Pick<ResolvedPlan, "unit">[]
): Record<PlanProgress, number> {
  const counts: Record<PlanProgress, number> = {
    "in-flight": 0,
    blocked: 0,
    queued: 0,
    unknown: 0,
    done: 0,
  };
  for (const plan of plans) counts[planProgress(plan.unit)] += 1;
  return counts;
}

/** The time a plan row reports (shipped → authored → ingested), as epoch ms. */
function rowTimeMs(unit: CoordPlanRow | null): number {
  if (!unit) return Number.NEGATIVE_INFINITY;
  const at = planRowTime(unit).at;
  const ms = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Progress order, then newest first, then slug — a total, stable order. */
export function sortPlans<P extends ResolvedPlan>(plans: readonly P[]): P[] {
  const rank = (p: P) => PLAN_PROGRESS_ORDER.indexOf(planProgress(p.unit));
  return [...plans].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      rowTimeMs(b.unit) - rowTimeMs(a.unit) ||
      a.slug.localeCompare(b.slug)
  );
}

/** The console's page for one work unit. */
export function workUnitHref(slug: string): string {
  return `/admin/coord/work-units/${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// The read itself.
// ---------------------------------------------------------------------------

/**
 * What the Twin map knows about the work units. Its reasons are worded for
 * the mode it was read in ({@link planReadOf}): every consumer prints them as
 * they are, so none can show an operator's sentence to an evaluator.
 */
export type TwinPlanRead =
  | { readonly kind: "loading" }
  | {
      readonly kind: "error";
      readonly reason: string;
      readonly at: number | null;
    }
  | {
      readonly kind: "ready";
      readonly index: WorkUnitIndex;
      /** How many units were read. */
      readonly units: number;
      /** Why the read is not the whole list, or `null` when it is. */
      readonly incomplete: string | null;
      /** A later refresh failed: the plans shown are from the last good read. */
      readonly refreshError: string | null;
      /** When the plans shown were read (epoch ms), or `null` when unknown. */
      readonly asOf: number | null;
    };

/** The query state the read is derived from (a `useTwinWorkUnits` result). */
export interface WorkUnitQueryState {
  readonly data: WalkOutcome | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
}

/** The mode a read's reasons are worded for. */
export interface PlanReadMode {
  /**
   * Presentation mode: a failure says a fixed phrase and its HTTP status,
   * never the error's sentence, which quotes the upstream response body —
   * text that can name an internal host, a tenant or a client (D3.3).
   */
  readonly presenting: boolean;
}

/** Why the work-unit read failed, worded for the mode. */
function failureReason(error: unknown, { presenting }: PlanReadMode): string {
  if (!presenting) return operationsErrorReading(error).sentence;
  const status = failureStatus(error);
  return status === null
    ? "coord's work-unit list gave no readable answer"
    : `coord's work-unit list answered HTTP ${status}`;
}

type PartialWalk = Extract<WalkOutcome, { kind: "partial" }>;

function partialReason(outcome: PartialWalk, mode: PlanReadMode): string {
  const pages = `${outcome.pages} page${outcome.pages === 1 ? "" : "s"}`;
  switch (outcome.reason) {
    case "error":
      // The failing read's sentence is the operator's alone (see PlanReadMode).
      return `coord's work-unit list stopped answering after ${pages}${outcome.error && !mode.presenting ? `: ${outcome.error}` : ""}`;
    case "page_cap":
      return `the read stopped at its ${pages} bound before the end of coord's list`;
    case "stalled":
      return "coord repeated a page of its work-unit list, so the read stopped early";
  }
}

/** Why a walk outcome is not the whole list, or `null` when it is. */
export function incompleteReason(
  outcome: WalkOutcome,
  mode: PlanReadMode
): string | null {
  switch (outcome.kind) {
    case "complete":
      return null;
    case "partial":
      return partialReason(outcome, mode);
    case "single_page":
      // A page short of the cap held everything the filter matched.
      return outcome.truncated
        ? "coord answered one full page and cannot be walked further, so later units were not read"
        : null;
  }
}

export function planReadOf(
  query: WorkUnitQueryState,
  mode: PlanReadMode
): TwinPlanRead {
  const { data } = query;
  if (!data) {
    if (query.isError) {
      return {
        kind: "error",
        reason: failureReason(query.error, mode),
        at: query.errorUpdatedAt > 0 ? query.errorUpdatedAt : null,
      };
    }
    return { kind: "loading" };
  }
  const incomplete = incompleteReason(data, mode);
  return {
    kind: "ready",
    index: indexWorkUnits(data.rows, incomplete === null),
    units: data.rows.length,
    incomplete,
    refreshError: query.isError ? failureReason(query.error, mode) : null,
    asOf: query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
  };
}
