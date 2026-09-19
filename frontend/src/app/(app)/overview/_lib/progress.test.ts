import { describe, expect, it } from "vitest";
import { summarizeProgress, titleOf } from "./progress";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

const row = (
  slug: string,
  status: string,
  extra: Partial<CoordPlanRow> = {}
): CoordPlanRow => ({ slug, status, ...extra });

describe("summarizeProgress", () => {
  it("buckets the closed status vocabulary and drops abandoned work", () => {
    const p = summarizeProgress(
      [
        row("a", "shipped"),
        row("b", "in_progress"),
        row("c", "ready"),
        row("d", "blocked"),
        row("e", "draft"),
        row("f", "vetted"),
        row("g", "superseded"),
        row("h", "obsolete"),
      ],
      { fetchLimit: 500 }
    );
    expect(p.counts).toEqual({
      done: 1,
      in_progress: 2,
      blocked: 1,
      planned: 2,
    });
    expect(p.total).toBe(6);
    expect(p.other).toBe(0);
    expect(p.truncated).toBe(false);
  });

  it("reports an unrecognised status instead of hiding it", () => {
    const p = summarizeProgress([row("a", "archived"), row("b", "")], {
      fetchLimit: 500,
    });
    expect(p.other).toBe(2);
    expect(p.total).toBe(0);
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
