/**
 * The capture-job status vocabulary (plan
 * `2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query`
 * Phase 1b-i). What would go red: a tier shown before the worker's pre-check
 * derived one, an unreadable queue read as an empty one, a list that creates
 * the wrong number of jobs.
 */

import { describe, expect, it } from "vitest";
import type { CaptureJob } from "@/lib/api/design-refs";
import {
  JOB_ATTENTION_BY_KIND,
  JOB_PALETTE,
  JOB_STATES,
  countByState,
  deriveJobsHealth,
  jobStatus,
  parseUrlList,
  tierReading,
} from "./jobStatus";

function job(over: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "j1",
    url: "https://a.example/pricing",
    domain: "a.example",
    scope_kind: "page",
    crawl_depth: null,
    flow_goal: null,
    notes: null,
    source: "operator",
    submitter_kind: "operator",
    submitter_id: null,
    is_reproduction: false,
    state: "queued",
    browser: "launched",
    claimed_by: null,
    claimed_until: null,
    derived_tier: null,
    tier_reason: null,
    error: null,
    created_at: "2026-11-16T00:00:00Z",
    updated_at: "2026-11-16T00:00:00Z",
    ...over,
  };
}

describe("tierReading", () => {
  it("is not derived until the worker's pre-check wrote one", () => {
    const t = tierReading(job());
    expect(t.kind).toBe("unknown");
    expect(t.label).toBe("not derived yet");
  });

  it("shows the derived tier with the worker's reason", () => {
    const t = tierReading(
      job({ derived_tier: "private", tier_reason: { robots: "unreachable" } })
    );
    expect(t).toEqual({
      kind: "private",
      label: "private",
      reason: "robots: unreachable",
    });
  });
});

describe("jobStatus", () => {
  it("covers every state with a badge class and an attention", () => {
    for (const s of JOB_STATES) {
      expect(JOB_PALETTE.badgeClass[s]).toBeTruthy();
      expect(JOB_ATTENTION_BY_KIND[s]).toBeDefined();
    }
  });

  it("carries the worker's error on a failed job", () => {
    const s = jobStatus(
      job({ state: "failed", error: "blocked by a challenge" })
    );
    expect(s.attention).toBe("author");
    expect(s.reason).toBe("blocked by a challenge");
  });

  it("marks only the red kinds with the author glyph", () => {
    const red = JOB_STATES.filter((s) => JOB_ATTENTION_BY_KIND[s] === "author");
    expect([...JOB_PALETTE.authorGlyphKinds].sort()).toEqual([...red].sort());
  });
});

describe("deriveJobsHealth", () => {
  it("reads an unreadable first fetch as unknown, never as an empty queue", () => {
    const h = deriveJobsHealth(null, true);
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/unknown/);
  });

  it("is red while a job failed or awaits approval", () => {
    const h = deriveJobsHealth(
      [job({ state: "failed" }), job({ id: "j2", state: "proposed" })],
      false
    );
    expect(h.level).toBe("red");
    expect(countByState([job({ state: "failed" })]).failed).toBe(1);
  });

  it("is green with only queued and running work", () => {
    const h = deriveJobsHealth(
      [job(), job({ id: "j2", state: "running" })],
      false
    );
    expect(h.level).toBe("green");
  });

  it("does not claim nothing is waiting when the read filled the page", () => {
    const h = deriveJobsHealth(
      [job({ state: "done" }), job({ id: "j2", state: "done" })],
      false,
      2
    );
    expect(h.headline).not.toMatch(/Nothing is waiting to be captured/);
    expect(h.headline).toMatch(/newest 2 jobs/);
    expect(h.detail).toMatch(/counts are a floor/);
  });

  it("says nothing is waiting when the read is shorter than the page", () => {
    const h = deriveJobsHealth([job({ state: "done" })], false, 2);
    expect(h.headline).toBe("Nothing is waiting to be captured.");
    expect(h.detail).toBe("");
  });
});

describe("parseUrlList", () => {
  it("makes one entry per distinct URL", () => {
    expect(
      parseUrlList(
        "https://a.example\n\n  https://b.example \thttps://a.example\n"
      )
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("keeps a comma inside a URL's query as part of that URL", () => {
    expect(
      parseUrlList(
        "https://a.example/search?tags=red,blue&x=1\nhttps://b.example"
      )
    ).toEqual([
      "https://a.example/search?tags=red,blue&x=1",
      "https://b.example",
    ]);
  });
});
