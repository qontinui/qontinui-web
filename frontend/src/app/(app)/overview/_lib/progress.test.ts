import { describe, expect, it } from "vitest";
import { summarizeProgress, titleOf } from "./progress";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

const row = (
  slug: string,
  status: string,
  extra: Partial<CoordPlanRow> = {}
): CoordPlanRow => ({ slug, status, ...extra });

const summarize = (rows: CoordPlanRow[]) =>
  summarizeProgress(rows, { fetchLimit: 500 });

describe("summarizeProgress", () => {
  it("buckets by the console's status vocabulary", () => {
    const p = summarize([
      row("a", "shipped"),
      row("b", "in_progress"),
      row("c", "in-progress"),
      row("d", "partial"),
      row("e", "ready"),
      row("f", "blocked"),
      row("g", "draft"),
      row("h", "vetted"),
      row("i", "vetted_unattested"),
    ]);
    expect(p.counts).toEqual({
      done: 1,
      in_progress: 3,
      ready: 1,
      blocked: 1,
      planned: 3,
      unknown: 0,
    });
    expect(p.total).toBe(9);
  });

  it("does not count ready (dependencies met) as in progress", () => {
    const p = summarize([row("a", "ready")]);
    expect(p.counts.in_progress).toBe(0);
    expect(p.counts.ready).toBe(1);
  });

  it("drops work that will not be done", () => {
    const p = summarize([
      row("a", "superseded"),
      row("b", "obsolete"),
      row("c", "archived"),
      row("d", "shipped"),
    ]);
    expect(p.total).toBe(1);
  });

  it("keeps unrecognised statuses in the total, so they cannot inflate done", () => {
    const p = summarize([
      row("a", "shipped"),
      row("b", "tier3_dispatched"),
      row("c", ""),
    ]);
    expect(p.counts.unknown).toBe(2);
    expect(p.total).toBe(3);
    expect(p.counts.done / p.total).toBeCloseTo(1 / 3);
  });

  it("tolerates padded and mixed-case statuses", () => {
    expect(summarize([row("a", "  Shipped ")]).counts.done).toBe(1);
  });

  it("drops merge-shepherd bookkeeping units even if the server kept them", () => {
    const p = summarize([row("shepherd-pr-12", "draft"), row("x", "draft")]);
    expect(p.total).toBe(1);
  });

  it("marks a full page as a lower bound", () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(`p${i}`, "draft"));
    expect(summarizeProgress(rows, { fetchLimit: 3 }).truncated).toBe(true);
    expect(summarizeProgress(rows, { fetchLimit: 4 }).truncated).toBe(false);
  });

  it("lists the most recently finished work first, and only dated work", () => {
    const p = summarizeProgress(
      [
        row("2026-01-01-old", "shipped", {
          title: "Old",
          first_shipped_at: "2026-02-01T00:00:00Z",
        }),
        row("2026-03-01-new", "shipped", {
          title: "New",
          first_shipped_at: "2026-04-01T00:00:00Z",
        }),
        row("2026-03-02-undated", "shipped"),
        row("2026-03-03-open", "in_progress", {
          first_shipped_at: "2026-05-01T00:00:00Z",
        }),
      ],
      { fetchLimit: 500, recent: 5 }
    );
    expect(p.recentlyFinished.map((f) => f.title)).toEqual(["New", "Old"]);
  });
});

describe("titleOf", () => {
  it("prefers the title and otherwise humanises the slug", () => {
    expect(titleOf({ slug: "2026-09-19-x", title: "Nice title" })).toBe(
      "Nice title"
    );
    expect(titleOf({ slug: "2026-09-19-partner-portal-login" })).toBe(
      "Partner portal login"
    );
  });
});
