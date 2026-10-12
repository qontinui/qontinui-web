/**
 * `rowFilters.ts` — the page-scoped filters composed, and the document-only
 * population (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`
 * Phases 1, 3 and 5).
 */

import { describe, expect, it } from "vitest";
import type { ReconciliationRowData } from "@/components/admin/coord/planReconciliationStatus";
import {
  indexDifficulty,
  type DifficultyIndex,
} from "@/components/admin/coord/planDifficulty";
import {
  NO_PAGE_FILTERS,
  activeFilterNames,
  axisAFilterActive,
  isDocumentOnly,
  matchesPageFilters,
  pageChipCounts,
  pageFiltersActive,
} from "./rowFilters";

function row(
  slug: string,
  axisA: ReconciliationRowData["axis_a"]
): ReconciliationRowData {
  return {
    slug,
    document_state: "present",
    document_axis_complete: true,
    axis_a: axisA,
    axis_b: {
      readable: true,
      present: true,
      document_state: "present",
      complete: true,
    },
    axis_c: { readable: true, present: true, computed: false },
    classification: "UNKNOWN_AXIS_UNREADABLE",
    verdict: "unknown",
    reason: "r",
  };
}

const draft = row("2026-01-01-draft", {
  readable: true,
  present: true,
  status: "draft",
  status_class: "free_known",
});
const staleVetted = row("2026-01-02-stale", {
  readable: true,
  present: true,
  status: "vetted",
  status_class: "attested",
  vet_state: "moved",
});
const unknownVetted = row("2026-01-03-unknown", {
  readable: true,
  present: true,
  status: "vetted",
  status_class: "attested",
  vet_state: null,
});
const orphan = row("2026-01-04-orphan", { readable: true, present: false });
const unreadable = row("2026-01-05-unreadable", {
  readable: false,
  present: false,
});

const PENDING: DifficultyIndex = { state: "pending" };

describe("isDocumentOnly", () => {
  it("is a READABLE axis A with no unit — never an unreadable one", () => {
    expect(isDocumentOnly(orphan)).toBe(true);
    expect(isDocumentOnly(unreadable)).toBe(false);
    expect(isDocumentOnly(draft)).toBe(false);
  });
});

describe("matchesPageFilters", () => {
  const rows = [draft, staleVetted, unknownVetted, orphan, unreadable];

  it("passes everything with no filter", () => {
    expect(
      rows.filter((r) => matchesPageFilters(r, NO_PAGE_FILTERS, PENDING))
    ).toHaveLength(5);
  });

  it("the needs-vet-imp chip keeps exactly the 'yes' rows", () => {
    const f = { ...NO_PAGE_FILTERS, chips: ["needs_vet_imp" as const] };
    expect(
      rows.filter((r) => matchesPageFilters(r, f, PENDING)).map((r) => r.slug)
    ).toEqual(["2026-01-01-draft", "2026-01-02-stale"]);
  });

  it("the document-only chip keeps the orphan alone", () => {
    const f = { ...NO_PAGE_FILTERS, chips: ["document_only" as const] };
    expect(
      rows.filter((r) => matchesPageFilters(r, f, PENDING)).map((r) => r.slug)
    ).toEqual(["2026-01-04-orphan"]);
  });

  it("composes class and difficulty (an unrated plan is not low)", () => {
    const index = indexDifficulty({
      items: [
        {
          id: "a",
          kind: "plan",
          slug: "2026-01-02-stale",
          work_unit_slug: "2026-01-02-stale",
          difficulty: "low",
          difficulty_source: "computed",
          difficulty_rubric_version: 1,
          difficulty_conceptual: "low",
          difficulty_implementation: "low",
        },
      ],
      model_tiers: {},
    } as never);
    const low = { ...NO_PAGE_FILTERS, difficulty: "low" as const };
    expect(
      rows.filter((r) => matchesPageFilters(r, low, index)).map((r) => r.slug)
    ).toEqual(["2026-01-02-stale"]);
    const unrated = { ...NO_PAGE_FILTERS, difficulty: "unrated" as const };
    expect(
      rows.filter((r) => matchesPageFilters(r, unrated, index))
    ).toHaveLength(4);
    const both = {
      ...NO_PAGE_FILTERS,
      difficulty: "low" as const,
      statusClass: "free_known" as const,
    };
    expect(rows.filter((r) => matchesPageFilters(r, both, index))).toEqual([]);
  });

  it("does not apply a difficulty filter until the ratings load", () => {
    const f = { ...NO_PAGE_FILTERS, difficulty: "high" as const };
    expect(pageFiltersActive(f, PENDING)).toBe(false);
    expect(rows.filter((r) => matchesPageFilters(r, f, PENDING))).toHaveLength(
      5
    );
  });
});

describe("page counts and names", () => {
  it("counts the chips over this page, with undetermined kept separate", () => {
    expect(
      pageChipCounts([draft, staleVetted, unknownVetted, orphan, unreadable])
    ).toEqual({ document_only: 1, needs_vet_imp: 2, vet_imp_undetermined: 2 });
  });

  it("names what is in force", () => {
    const f = {
      status: "draft",
      statusClass: "needs_cleanup" as const,
      difficulty: "any" as const,
      chips: ["needs_vet_imp" as const],
    };
    expect(activeFilterNames(f, PENDING)).toEqual([
      "coord status draft",
      "class needs_cleanup",
      "needs a /vet-imp",
    ]);
    expect(axisAFilterActive(f)).toBe(true);
    expect(axisAFilterActive(NO_PAGE_FILTERS)).toBe(false);
  });
});
