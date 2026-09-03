import { describe, it, expect } from "vitest";
import { sortPlans, SORTS, type SortKey } from "./planSort";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

const row = (
  slug: string,
  created?: string | null,
  updated?: string | null,
  authored?: string | null
): CoordPlanRow => ({
  slug,
  created_at: created,
  updated_at: updated,
  authored_at: authored,
});

/**
 * Three timestamps per row, in three DIFFERENT orders, so a sort wired to the
 * wrong column cannot pass by accident (oldest → newest):
 *
 *   authored:  a-oldest, c-newest, b-mid    (b-mid was WRITTEN last)
 *   created:   a-oldest, b-mid, c-newest    (ingest order — the slugs)
 *   updated:   a-oldest, c-newest, b-mid    (same order as authored, but
 *              different instants; `updated_asc` and `authored_asc` are told
 *              apart by the undated-row tests below, where only one column
 *              is null)
 */
const CORPUS: CoordPlanRow[] = [
  row(
    "b-mid",
    "2026-06-01T00:00:00Z",
    "2026-08-10T00:00:00Z",
    "2026-08-20T00:00:00Z"
  ),
  row(
    "a-oldest",
    "2026-01-15T00:00:00Z",
    "2026-08-01T00:00:00Z",
    "2026-01-10T00:00:00Z"
  ),
  row(
    "c-newest",
    "2026-08-16T00:00:00Z",
    "2026-08-02T00:00:00Z",
    "2026-07-01T00:00:00Z"
  ),
];

describe("sortPlans", () => {
  it("orders by AUTHORING date in both directions", () => {
    expect(sortPlans(CORPUS, "authored_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "c-newest",
      "b-mid",
    ]);
    expect(sortPlans(CORPUS, "authored_desc").map((r) => r.slug)).toEqual([
      "b-mid",
      "c-newest",
      "a-oldest",
    ]);
  });

  it("orders by INGEST date in both directions, independently of authoring", () => {
    // The defect this plan closes: `created_at` is when coord first saw the
    // row, and for most of the corpus that is a bulk-backfill date. It is a
    // real question, kept under the label "ingested" — but it must not be the
    // same ordering as authored, or the two keys are wired to one column.
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

  it("orders by updated date independently of both", () => {
    // Guards against any two keys being wired to the same field.
    expect(sortPlans(CORPUS, "updated_desc").map((r) => r.slug)).toEqual([
      "b-mid",
      "c-newest",
      "a-oldest",
    ]);
    expect(sortPlans(CORPUS, "updated_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "c-newest",
      "b-mid",
    ]);
  });

  it("sorts by slug", () => {
    expect(sortPlans(CORPUS, "slug_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "b-mid",
      "c-newest",
    ]);
  });

  it("sinks rows with NO authoring date to the bottom in BOTH directions", () => {
    // The honesty property: a missing authored_at is UNKNOWN. If it were
    // coerced to epoch-zero it would top the "oldest authored" list, and the
    // page would confidently answer the question with its least-known row.
    // The undated row has BOTH other timestamps, and the newest of each, so
    // a fallback to either would surface it at the top instead.
    const withGap = [
      ...CORPUS,
      row("z-undated", "2026-08-30T00:00:00Z", "2026-08-31T00:00:00Z", null),
    ];

    expect(sortPlans(withGap, "authored_asc").at(-1)?.slug).toBe("z-undated");
    expect(sortPlans(withGap, "authored_desc").at(-1)?.slug).toBe("z-undated");
    // ...and the rest of the order is untouched by the sunk row.
    expect(
      sortPlans(withGap, "authored_desc")
        .slice(0, 3)
        .map((r) => r.slug)
    ).toEqual(["b-mid", "c-newest", "a-oldest"]);
  });

  it("sinks rows with NO ingest date to the bottom in BOTH directions", () => {
    const withGap = [
      ...CORPUS,
      row("z-undated", null, "2026-08-11T00:00:00Z", "2026-08-11T00:00:00Z"),
    ];

    expect(sortPlans(withGap, "created_asc").at(-1)?.slug).toBe("z-undated");
    expect(sortPlans(withGap, "created_desc").at(-1)?.slug).toBe("z-undated");
  });

  it("sinks a corpus with NO authoring dates at all, stably, by slug", () => {
    // A coord that predates the `authored_at` column serves none. The
    // default sort must then degrade to a stable slug order — not a shuffle,
    // and not an ordering of the ingest dates wearing the authored label.
    const undated = CORPUS.map((r) => ({ ...r, authored_at: undefined }));
    expect(sortPlans(undated, "authored_desc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "b-mid",
      "c-newest",
    ]);
    expect(sortPlans(undated, "authored_asc").map((r) => r.slug)).toEqual([
      "a-oldest",
      "b-mid",
      "c-newest",
    ]);
  });

  it("sinks an UNPARSEABLE date too, not just a missing one", () => {
    const withJunk = [
      ...CORPUS,
      row("z-junk", "not-a-date", null, "not-a-date"),
    ];
    expect(sortPlans(withJunk, "authored_asc").at(-1)?.slug).toBe("z-junk");
    expect(sortPlans(withJunk, "authored_desc").at(-1)?.slug).toBe("z-junk");
    expect(sortPlans(withJunk, "created_asc").at(-1)?.slug).toBe("z-junk");
    expect(sortPlans(withJunk, "created_desc").at(-1)?.slug).toBe("z-junk");
  });

  it("breaks ties on slug so the order is stable across polls", () => {
    // The page re-fetches every 10s; an unstable comparator would reshuffle
    // equal-timestamped rows under the operator's cursor.
    const same = [
      row("b", "2026-05-01T00:00:00Z", null, "2026-05-01T00:00:00Z"),
      row("a", "2026-05-01T00:00:00Z", null, "2026-05-01T00:00:00Z"),
      row("c", "2026-05-01T00:00:00Z", null, "2026-05-01T00:00:00Z"),
    ];
    for (const key of [
      "authored_desc",
      "authored_asc",
      "created_desc",
      "created_asc",
    ] as const) {
      expect(sortPlans(same, key).map((r) => r.slug)).toEqual(["a", "b", "c"]);
    }
  });

  it("does not mutate its input", () => {
    const original = [...CORPUS];
    sortPlans(CORPUS, "authored_asc");
    expect(CORPUS).toEqual(original);
  });

  it("handles an empty list", () => {
    expect(sortPlans([], "authored_desc")).toEqual([]);
  });

  it("exposes a label for every sort key, and names the ingest sorts honestly", () => {
    const keys: SortKey[] = [
      "authored_desc",
      "authored_asc",
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
    // "created" was the label under which the ingest date posed as the
    // authoring date. It must not come back.
    for (const s of SORTS) {
      expect(s.label).not.toMatch(/created/i);
    }
    expect(SORTS.find((s) => s.value === "created_desc")?.label).toBe(
      "Newest ingested"
    );
    expect(SORTS[0]?.value).toBe("authored_desc");
  });
});
