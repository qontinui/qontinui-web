/**
 * Every CLIENT-side filter on `/admin/coord/plans`, composed in one place.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phases 1,
 * 3 and 5. The reconciliation route filters server-side by `q` only, so the
 * status, class, "needs a /vet-imp", "document only" and difficulty filters
 * all narrow the ROWS ON THIS PAGE and ask the corpus nothing. Every count
 * this module produces is therefore a page count, and the page labels it so:
 * a page-scoped filter that read as corpus-wide would be the silent
 * undercount this plan exists to remove.
 */

import { matchesStatus } from "@/components/admin/coord/planReconciliationFilters";
import type { ReconciliationRowData } from "@/components/admin/coord/planReconciliationStatus";
import {
  difficultyCell,
  matchesDifficulty,
  type DifficultyFilter,
  type DifficultyIndex,
} from "@/components/admin/coord/planDifficulty";
import {
  matchesStatusClass,
  needsVetImp,
  type StatusClassFilter,
} from "./statusClass";

/** The two toggle chips — each narrows to a population worth its own view. */
export type RowChip = "document_only" | "needs_vet_imp";

export const ROW_CHIPS: readonly RowChip[] = ["document_only", "needs_vet_imp"];

export interface PageFilters {
  /** axis A's stored status word (`STATUS_FILTERS`). */
  status: string;
  statusClass: StatusClassFilter;
  difficulty: DifficultyFilter;
  chips: RowChip[];
}

export const NO_PAGE_FILTERS: PageFilters = {
  status: "any",
  statusClass: "any",
  difficulty: "any",
  chips: [],
};

/**
 * A document with no coord work unit — the rare hand-POSTed or
 * agent-captured orphan. Only a READABLE axis A can say "no unit": on the
 * degraded population arm nothing is known about units, so no row qualifies.
 */
export function isDocumentOnly(row: ReconciliationRowData): boolean {
  return row.axis_a.readable && !row.axis_a.present;
}

/** Is the difficulty filter in force? Disabled until ratings load. */
function difficultyActive(f: PageFilters, index: DifficultyIndex): boolean {
  return f.difficulty !== "any" && index.state === "loaded";
}

export function pageFiltersActive(
  f: PageFilters,
  index: DifficultyIndex
): boolean {
  return (
    f.status !== "any" ||
    f.statusClass !== "any" ||
    f.chips.length > 0 ||
    difficultyActive(f, index)
  );
}

/** Does any active filter read axis A (so an unreadable axis empties it)? */
export function axisAFilterActive(f: PageFilters): boolean {
  return (
    f.status !== "any" ||
    f.statusClass !== "any" ||
    f.chips.includes("needs_vet_imp") ||
    f.chips.includes("document_only")
  );
}

export function matchesPageFilters(
  row: ReconciliationRowData,
  f: PageFilters,
  index: DifficultyIndex
): boolean {
  if (!matchesStatus(row, f.status)) return false;
  if (!matchesStatusClass(row.axis_a, f.statusClass)) return false;
  if (f.chips.includes("document_only") && !isDocumentOnly(row)) return false;
  if (
    f.chips.includes("needs_vet_imp") &&
    needsVetImp(row.axis_a).need !== "yes"
  ) {
    return false;
  }
  if (
    difficultyActive(f, index) &&
    !matchesDifficulty(difficultyCell(index, row.slug), f.difficulty)
  ) {
    return false;
  }
  return true;
}

/** The names of the filters in force, for the scope and empty-state copy. */
export function activeFilterNames(
  f: PageFilters,
  index: DifficultyIndex
): string[] {
  const out: string[] = [];
  if (f.status !== "any") out.push(`coord status ${f.status}`);
  if (f.statusClass !== "any") out.push(`class ${f.statusClass}`);
  if (f.chips.includes("needs_vet_imp")) out.push("needs a /vet-imp");
  if (f.chips.includes("document_only")) out.push("document only");
  if (difficultyActive(f, index)) out.push(`difficulty ${f.difficulty}`);
  return out;
}

export interface PageChipCounts {
  document_only: number;
  needs_vet_imp: number;
  /** Rows the vet-imp predicate could not decide — counted, never dropped. */
  vet_imp_undetermined: number;
}

/** Counts over THIS PAGE's rows — never a corpus figure. */
export function pageChipCounts(rows: ReconciliationRowData[]): PageChipCounts {
  let documentOnly = 0;
  let yes = 0;
  let undetermined = 0;
  for (const row of rows) {
    if (isDocumentOnly(row)) documentOnly += 1;
    const need = needsVetImp(row.axis_a).need;
    if (need === "yes") yes += 1;
    else if (need === "undetermined") undetermined += 1;
  }
  return {
    document_only: documentOnly,
    needs_vet_imp: yes,
    vet_imp_undetermined: undetermined,
  };
}
