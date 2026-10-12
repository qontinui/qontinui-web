/**
 * The shipped-by reading (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 7): no
 * unreported count reads as 0, no empty name list reads as "nobody", and
 * coord's `attribution_available: false` is UNKNOWN with its reason.
 */

import { describe, expect, it } from "vitest";
import {
  deriveAttribution,
  describePrRef,
  describeShippedBy,
} from "./attribution";
import { httpStatusOfError } from "@/components/console/readFailure";

const LOADED = {
  slug: "s",
  attribution_available: true,
  shipped_by: [
    {
      session_name: "plan-foo",
      pr_refs: [
        {
          repo: "o/r",
          pr_number: 12,
          merged: true,
          attribution_is_single_session: true,
        },
        { repo: "o/r", pr_number: 13, merged: null },
      ],
    },
  ],
  unnamed_session_count: 0,
  unverified_session_count: 0,
  unattributed_pr_count: 0,
};

describe("deriveAttribution", () => {
  it("reads names, tri-state merge flags and counts", () => {
    const r = deriveAttribution(LOADED);
    expect(r).toEqual({
      state: "loaded",
      groups: [
        {
          sessionName: "plan-foo",
          prs: [
            { repo: "o/r", prNumber: 12, merged: true },
            { repo: "o/r", prNumber: 13, merged: null },
          ],
        },
      ],
      unnamedSessions: 0,
      unverifiedSessions: 0,
      unattributedPrs: 0,
      singleSessionPerPr: true,
    });
  });

  it("an ABSENT count (older coord) is null, never 0", () => {
    const { unverified_session_count: _drop, ...older } = LOADED;
    const r = deriveAttribution(older);
    expect(r.state === "loaded" && r.unverifiedSessions).toBeNull();
  });

  it("attribution_available:false is unavailable with coord's reason", () => {
    expect(
      deriveAttribution({
        attribution_available: false,
        unavailable_reason: "lineage_tenant_column_missing",
        unavailable_detail: "column absent",
        shipped_by: [],
        unnamed_session_count: null,
      })
    ).toEqual({
      state: "unavailable",
      reason: "lineage_tenant_column_missing",
      detail: "column absent",
    });
  });

  it("a PRESENT but malformed count is unparseable, not 'not reported'", () => {
    expect(
      deriveAttribution({ ...LOADED, unverified_session_count: -1 }).state
    ).toBe("unparseable");
    expect(
      deriveAttribution({ ...LOADED, unattributed_pr_count: "2" }).state
    ).toBe("unparseable");
  });

  it.each([null, "x", [], {}, { attribution_available: true }])(
    "an unreadable body is unparseable: %j",
    (b) => {
      expect(deriveAttribution(b).state).toBe("unparseable");
    }
  );
});

describe("describeShippedBy", () => {
  it("names the sessions and discloses one-session-per-PR", () => {
    const d = describeShippedBy(deriveAttribution(LOADED));
    expect(d.summary).toBe("plan-foo");
    expect(d.unknown).toBe(false);
    expect(d.notes.join(" ")).toMatch(/one session/);
  });

  it("every count a reported 0 and no names is an observed 'no cited PR'", () => {
    const d = describeShippedBy(
      deriveAttribution({ ...LOADED, shipped_by: [] })
    );
    expect(d.summary).toBe("no cited PR — nothing to attribute");
    expect(d.unknown).toBe(false);
  });

  it("no names beside a non-zero count is UNKNOWN who, never 'nobody'", () => {
    const d = describeShippedBy(
      deriveAttribution({
        ...LOADED,
        shipped_by: [],
        unattributed_pr_count: 2,
        unverified_session_count: 1,
      })
    );
    expect(d.unknown).toBe(true);
    expect(d.summary).toMatch(/UNKNOWN/);
    expect(d.notes.join(" ")).toMatch(/2 cited PRs have no session attribution/);
    expect(d.notes.join(" ")).toMatch(/1 attributed session could not be verified/);
  });

  it("an older coord (no unverified count) still answers 'no cited PR' from the counts it reports", () => {
    const { unverified_session_count: _drop, ...older } = LOADED;
    const d = describeShippedBy(deriveAttribution({ ...older, shipped_by: [] }));
    expect(d.summary).toBe("no cited PR — nothing to attribute");
    expect(d.unknown).toBe(false);
  });

  it("an older coord's names carry the 'verification not reported' note", () => {
    const { unverified_session_count: _drop, ...older } = LOADED;
    const d = describeShippedBy(deriveAttribution(older));
    expect(d.summary).toBe("plan-foo");
    expect(d.notes.join(" ")).toMatch(/not reported/);
  });

  it("an unreported unnamed or unattributed count is never 'no cited PR'", () => {
    const d = describeShippedBy(
      deriveAttribution({ ...LOADED, shipped_by: [], unattributed_pr_count: null })
    );
    expect(d.unknown).toBe(true);
  });

  it("unavailable is UNKNOWN with the reason", () => {
    const d = describeShippedBy({
      state: "unavailable",
      reason: "citation_tenant_mismatch",
      detail: null,
    });
    expect(d.unknown).toBe(true);
    expect(d.summary).toMatch(/citation_tenant_mismatch/);
  });

  it("a 403 and a 404 are said apart from a read that never landed", () => {
    expect(
      describeShippedBy({ state: "failed", reason: "x", status: 403 }).summary
    ).toMatch(/not available to this sign-in/);
    expect(
      describeShippedBy({ state: "failed", reason: "x", status: 404 }).summary
    ).toMatch(/404/);
    const d = describeShippedBy({ state: "failed", reason: "boom", status: null });
    expect(d.summary).toMatch(/read failed/);
    expect(d.notes).toEqual(["boom"]);
  });
});

describe("helpers", () => {
  it("httpStatusOfError reads httpClient's message shape", () => {
    expect(httpStatusOfError(new Error("GET /x failed: 403 - {}"))).toBe(403);
    expect(httpStatusOfError(new Error("network down"))).toBeNull();
  });

  it("describePrRef says an UNKNOWN merge state", () => {
    expect(describePrRef({ repo: "o/r", prNumber: 1, merged: null })).toBe(
      "o/r#1 (merge state UNKNOWN)"
    );
    expect(describePrRef({ repo: "o/r", prNumber: 2, merged: false })).toBe(
      "o/r#2 (not merged)"
    );
  });
});
