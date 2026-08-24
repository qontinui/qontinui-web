import { describe, it, expect } from "vitest";
import { sortPlans, SORTS, type SortKey } from "./planSort";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

const row = (
  slug: string,
  created?: string | null,
  updated?: string | null
): CoordPlanRow => ({ slug, created_at: created, updated_at: updated });

const CORPUS: CoordPlanRow[] = [
  row("b-mid", "2026-06-01T00:00:00Z", "2026-08-10T00:00:00Z"),
  row("a-oldest", "2026-01-15T00:00:00Z", "2026-08-01T00:00:00Z"),
  row("c-newest", "2026-08-16T00:00:00Z", "2026-08-02T00:00:00Z"),
];

describe("sortPlans", () => {
  it("orders by creation date in both directions", () => {
    expect(sortPlans(CORPUS, "created_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "b-mid",
      "c-newest",
    ]);
    expect(sortPlans(CORPUS, "created_desc").map((r) => r.slug)).toEqual([
      "c-newest",
      "b-mid",
      "a-oldest",
    ]);
  });

  it("orders by updated date independently of creation order", () => {
    // Guards against the two keys being wired to the same field.
    expect(sortPlans(CORPUS, "updated_desc").map((r) => r.slug)).toEqual([
      "b-mid",
      "c-newest",
      "a-oldest",
    ]);
  });

  it("sorts by slug", () => {
    expect(sortPlans(CORPUS, "slug_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "b-mid",
      "c-newest",
    ]);
  });

  it("sinks rows with NO creation date to the bottom in BOTH directions", () => {
    // The honesty property: a missing created_at is UNKNOWN. If it were
    // coerced to epoch-zero it would top the "oldest created" list, and the
    // page would confidently answer the question with its least-known row.
    const withGap = [...CORPUS, row("z-undated", null, "2026-08-11T00:00:00Z")];

    expect(sortPlans(withGap, "created_asc").at(-1)?.slug).toBe("z-undated");
    expect(sortPlans(withGap, "created_desc").at(-1)?.slug).toBe("z-undated");
  });

  it("sinks an UNPARSEABLE date too, not just a missing one", () => {
    const withJunk = [...CORPUS, row("z-junk", "not-a-date")];
    expect(sortPlans(withJunk, "created_asc").at(-1)?.slug).toBe("z-junk");
    expect(sortPlans(withJunk, "created_desc").at(-1)?.slug).toBe("z-junk");
  });

  it("breaks ties on slug so the order is stable across polls", () => {
    // The page re-fetches every 10s; an unstable comparator would reshuffle
    // equal-timestamped rows under the operator's cursor.
    const same = [
      row("b", "2026-05-01T00:00:00Z"),
      row("a", "2026-05-01T00:00:00Z"),
      row("c", "2026-05-01T00:00:00Z"),
    ];
    expect(sortPlans(same, "created_desc").map((r) => r.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortPlans(same, "created_asc").map((r) => r.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not mutate its input", () => {
    const original = [...CORPUS];
    sortPlans(CORPUS, "created_asc");
    expect(CORPUS).toEqual(original);
  });

  it("handles an empty list", () => {
    expect(sortPlans([], "created_desc")).toEqual([]);
  });

  it("exposes a label for every sort key", () => {
    const keys: SortKey[] = [
      "created_desc",
      "created_asc",
      "updated_desc",
      "updated_asc",
      "slug_asc",
    ];
    for (const k of keys) {
      expect(SORTS.find((s) => s.value === k)?.label).toBeTruthy();
    }
    expect(SORTS).toHaveLength(keys.length);
  });
});
