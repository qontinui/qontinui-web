/**
 * Plan difficulty — the join onto coord work units and the three cell states.
 *
 * Plan `2026-09-18-plan-library-difficulty-field`. Pinned here:
 *   - the join key precedence: `work_unit_slug` first, the artifact's own
 *     `slug` only as a fallback, first (newest-written) row wins;
 *   - rated / unrated / unknown stay distinct — an unrated plan is never
 *     `low`, and an unanswered read is never "unrated";
 *   - the filter never lets an unknown cell match anything but `any`.
 */

import { describe, expect, it } from "vitest";
import {
  describeDifficultyCell,
  describeSignals,
  difficultyCell,
  indexDifficulty,
  matchesDifficulty,
  type PlanDifficultyItem,
  type PlanDifficultyResponse,
} from "./planDifficulty";

function item(over: Partial<PlanDifficultyItem> = {}): PlanDifficultyItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "2026-09-18-a",
    work_unit_slug: "2026-09-18-a",
    source_repo: "qontinui-dev-notes/plans",
    difficulty: "high",
    difficulty_conceptual: "high",
    difficulty_implementation: "medium",
    difficulty_source: "computed",
    difficulty_rubric_version: 1,
    difficulty_signals: {
      phases: 3,
      repos: ["qontinui-web"],
      computed_level: "high",
    },
    ...over,
  };
}

function response(items: PlanDifficultyItem[]): PlanDifficultyResponse {
  return {
    items,
    count: items.length,
    rerated: 0,
    rerate_failed_reason: null,
    rubric_version: 1,
    model_tiers: {
      high: "Fable 5.1",
      medium: "Opus 5",
      low: "Sonnet 5.0 / DeepSeek Flash 4.1 / Gemini 3.8 Flash",
    },
  };
}

describe("indexDifficulty", () => {
  it("keys on work_unit_slug, keeping the first (newest-written) row", () => {
    const index = indexDifficulty(
      response([
        item({ id: "newest", difficulty: "low" }),
        item({ id: "older-fork", difficulty: "high" }),
      ])
    );
    const cell = difficultyCell(index, "2026-09-18-a");
    expect(cell.kind).toBe("rated");
    expect(cell.kind === "rated" && cell.item.id).toBe("newest");
  });

  it("falls back to the artifact slug, but never over an explicit key", () => {
    const index = indexDifficulty(
      response([
        // A hand-POSTed row whose OWN slug collides with another row's
        // work_unit_slug must not displace it.
        item({ id: "stray", slug: "wu-1", work_unit_slug: null }),
        item({ id: "linked", slug: "artifact-x", work_unit_slug: "wu-1" }),
        item({ id: "unlinked", slug: "wu-2", work_unit_slug: null }),
      ])
    );
    const one = difficultyCell(index, "wu-1");
    const two = difficultyCell(index, "wu-2");
    expect(one.kind === "rated" && one.item.id).toBe("linked");
    expect(two.kind === "rated" && two.item.id).toBe("unlinked");
  });
});

describe("difficultyCell", () => {
  it("is UNKNOWN before the read answers, never unrated", () => {
    expect(difficultyCell({ state: "pending" }, "x").kind).toBe("unknown");
  });

  it("is UNKNOWN when the read failed, and says why", () => {
    const cell = difficultyCell({ state: "failed", reason: "HTTP 503" }, "x");
    expect(cell.kind).toBe("unknown");
    expect(describeDifficultyCell(cell).title).toContain("HTTP 503");
  });

  it("is UNRATED when the read answered without this plan — not low", () => {
    const cell = difficultyCell(indexDifficulty(response([])), "x");
    expect(cell.kind).toBe("unrated");
    const { label, title } = describeDifficultyCell(cell);
    expect(label).toBe("unrated");
    expect(title).toContain("Unrated is not low");
  });

  it("names the model tier the backend served for the level", () => {
    const cell = difficultyCell(
      indexDifficulty(response([item()])),
      "2026-09-18-a"
    );
    const { label, title } = describeDifficultyCell(cell);
    expect(label).toBe("high");
    expect(title).toContain("route to Fable 5.1");
    expect(title).toContain("Conceptual: high");
    expect(title).toContain("implementation: medium");
    expect(title).toContain("computed (rubric v1)");
  });

  it("says when the level was declared and what the rubric would have said", () => {
    const cell = difficultyCell(
      indexDifficulty(
        response([
          item({
            difficulty: "low",
            difficulty_source: "declared",
            difficulty_signals: { computed_level: "high" },
          }),
        ])
      ),
      "2026-09-18-a"
    );
    expect(describeDifficultyCell(cell).title).toContain(
      "declared in the plan (the rubric computed high)"
    );
  });
});

describe("matchesDifficulty", () => {
  const rated = difficultyCell(
    indexDifficulty(response([item()])),
    "2026-09-18-a"
  );
  const unrated = { kind: "unrated" } as const;
  const unknown = { kind: "unknown", reason: "r" } as const;

  it("matches a rated cell on its level only", () => {
    expect(matchesDifficulty(rated, "high")).toBe(true);
    expect(matchesDifficulty(rated, "low")).toBe(false);
    expect(matchesDifficulty(rated, "unrated")).toBe(false);
  });

  it("keeps unrated apart from every level", () => {
    expect(matchesDifficulty(unrated, "unrated")).toBe(true);
    expect(matchesDifficulty(unrated, "low")).toBe(false);
  });

  it("lets an unknown cell match nothing but any", () => {
    expect(matchesDifficulty(unknown, "any")).toBe(true);
    expect(matchesDifficulty(unknown, "unrated")).toBe(false);
    expect(matchesDifficulty(unknown, "high")).toBe(false);
  });
});

describe("describeSignals", () => {
  it("renders the measured inputs in operator words", () => {
    expect(
      describeSignals({
        phases: 1,
        repos: ["qontinui-web", "qontinui-coord"],
        file_paths: 12,
        lines: 240,
        concept_families: ["concurrency"],
      })
    ).toEqual([
      "1 phase",
      "2 repos (qontinui-web, qontinui-coord)",
      "12 file paths",
      "240 lines",
      "concerns: concurrency",
    ]);
  });

  it("is empty, not a crash, for absent signals", () => {
    expect(describeSignals(undefined)).toEqual([]);
  });
});

describe("unrated says only what the answer supports", () => {
  it("names a pending backlog rather than claiming there is no body", () => {
    const index = indexDifficulty({ ...response([]), rerate_pending: 12 });
    const cell = difficultyCell(index, "x");
    expect(cell.kind).toBe("unrated");
    const { title } = describeDifficultyCell(cell);
    expect(title).toContain("still rating 12 plans");
    expect(title).not.toContain("holds no body");
  });

  it("names a failed re-rating", () => {
    const index = indexDifficulty({
      ...response([]),
      rerate_pending: null,
      rerate_failed_reason: "OperationalError: boom",
    });
    const { title } = describeDifficultyCell(difficultyCell(index, "x"));
    expect(title).toContain("Re-rating failed (OperationalError: boom)");
  });
});
