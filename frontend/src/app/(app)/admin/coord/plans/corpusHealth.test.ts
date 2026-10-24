/**
 * `corpusHealth.ts` — the collapsed strip's one line (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Design decision
 * 4b). An unread or no-rows scan census is UNKNOWN, never "all fresh".
 */

import { describe, expect, it } from "vitest";
import type { ScanRootListResponse } from "../plan-library/types";
import { summarizeScanSources } from "./corpusHealth";

function list(over: Partial<ScanRootListResponse> = {}): ScanRootListResponse {
  return {
    state: "reported",
    detail: null,
    fresh_within_secs: 2700,
    retire_after_secs: 2_592_000,
    retired_count: 0,
    count: 3,
    fresh_count: 1,
    rows: [],
    by_source_repo: [],
    coverage: [],
    ...over,
  } as ScanRootListResponse;
}

describe("summarizeScanSources", () => {
  it("counts stale feeders by the route's own verdict", () => {
    const s = summarizeScanSources(list(), null, false);
    expect(s.text).toBe("2 of 3 scan sources stale");
    expect(s.unknown).toBe(false);
    expect(s.stale).toBe(2);
  });

  it("names feeders behind their default branch", () => {
    const s = summarizeScanSources(
      list({
        rows: [{ behind: 254 }, { behind: 0 }, { behind: null }] as never,
      }),
      null,
      false
    );
    expect(s.text).toBe(
      "2 of 3 scan sources stale, 1 behind its default branch"
    );
  });

  it("a failed first read is UNKNOWN", () => {
    const s = summarizeScanSources(null, "500", false);
    expect(s.unknown).toBe(true);
    expect(s.text).toContain("UNKNOWN");
    expect(s.stale).toBeNull();
  });

  it("the no-rows answer is UNKNOWN, not fresh", () => {
    const s = summarizeScanSources(
      list({ state: "unknown", count: 0, fresh_count: 0 }),
      null,
      false
    );
    expect(s.unknown).toBe(true);
    expect(s.text).toContain("UNKNOWN");
  });

  it("labels a kept reading whose refresh failed", () => {
    const s = summarizeScanSources(list(), "timeout", false);
    expect(s.text).toContain("last good read");
    expect(s.unknown).toBe(true);
  });
});
