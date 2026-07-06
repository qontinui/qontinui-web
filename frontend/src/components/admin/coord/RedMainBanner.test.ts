import { describe, it, expect } from "vitest";

import {
  parseRedMainAlerts,
  redMainHeadline,
  sinceLabel,
  type RedMainAlert,
} from "./RedMainBanner";

/**
 * Pure-logic tests for the red-main banner (plan
 * `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert.md`
 * Phase 1 D2). The banner is driven SOLELY by the coord `red_main:<repo>`
 * alert rows, so the parse step is the whole contract: prefix-keyed,
 * unresolved-only, detail-tolerant.
 */
describe("parseRedMainAlerts", () => {
  const redRow = {
    id: 1,
    alert_key: "red_main:jspinak/qontinui-runner",
    severity: "critical",
    kind: "red_main",
    summary: "Main CI for jspinak/qontinui-runner is RED",
    first_seen_at: "2026-07-06T01:00:00Z",
    detail: {
      repo: "jspinak/qontinui-runner",
      workflows: ["CI", "release"],
      blocked_pr_count: 8,
      fix_session: "none",
    },
  };

  it("extracts repo, workflows, blast radius and since from a live row", () => {
    const got = parseRedMainAlerts([redRow]);
    expect(got).toEqual<RedMainAlert[]>([
      {
        alertKey: "red_main:jspinak/qontinui-runner",
        repo: "jspinak/qontinui-runner",
        workflows: ["CI", "release"],
        blockedPrCount: 8,
        since: "2026-07-06T01:00:00Z",
      },
    ]);
  });

  it("ignores non-red_main keys and resolved rows", () => {
    expect(
      parseRedMainAlerts([
        { ...redRow, alert_key: "pr_merge_train_stalled:a/b" },
        { ...redRow, resolved_at: "2026-07-06T02:00:00Z" },
      ])
    ).toEqual([]);
  });

  it("falls back to the alert-key repo when detail is missing or malformed", () => {
    // A malformed detail payload must never hide a live episode.
    const got = parseRedMainAlerts([
      { alert_key: "red_main:owner/repo", detail: undefined },
      { alert_key: "red_main:owner/other", detail: { workflows: "not-a-list" } },
    ]);
    expect(got.map((a) => a.repo)).toEqual(["owner/other", "owner/repo"]);
    for (const a of got) {
      expect(a.workflows).toEqual([]);
      expect(a.blockedPrCount).toBe(0);
    }
  });

  it("sorts per-repo so the banner stack is stable across polls", () => {
    const got = parseRedMainAlerts([
      { ...redRow, alert_key: "red_main:z/last", detail: { repo: "z/last" } },
      { ...redRow, alert_key: "red_main:a/first", detail: { repo: "a/first" } },
    ]);
    expect(got.map((a) => a.repo)).toEqual(["a/first", "z/last"]);
  });

  it("tolerates a non-array body", () => {
    expect(parseRedMainAlerts(undefined)).toEqual([]);
    expect(parseRedMainAlerts(null)).toEqual([]);
    expect(parseRedMainAlerts({ alerts: [] })).toEqual([]);
  });
});

describe("sinceLabel", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");

  it("renders minutes, hours and days", () => {
    expect(sinceLabel("2026-07-06T11:35:00Z", now)).toBe("25m");
    expect(sinceLabel("2026-07-06T08:30:00Z", now)).toBe("3h 30m");
    expect(sinceLabel("2026-07-03T12:00:00Z", now)).toBe("3d");
  });

  it("never goes negative on clock skew and survives bad input", () => {
    expect(sinceLabel("2026-07-06T12:05:00Z", now)).toBe("0m");
    expect(sinceLabel(undefined, now)).toBe("unknown");
    expect(sinceLabel("not-a-date", now)).toBe("not-a-date");
  });
});

describe("redMainHeadline", () => {
  const now = Date.parse("2026-07-06T12:00:00Z");

  it("carries the D2 wording: repo, since, blast radius, no-merges warning", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:jspinak/qontinui-runner",
        repo: "jspinak/qontinui-runner",
        workflows: ["CI"],
        blockedPrCount: 8,
        since: "2026-07-06T09:00:00Z",
      },
      now
    );
    expect(headline).toBe(
      "🔴 jspinak/qontinui-runner main is RED since 3h 0m ago — " +
        "8 PRs blocked, no merges will land until fixed"
    );
  });

  it("uses singular PR for a blast radius of one", () => {
    const headline = redMainHeadline(
      {
        alertKey: "red_main:a/b",
        repo: "a/b",
        workflows: [],
        blockedPrCount: 1,
        since: undefined,
      },
      now
    );
    expect(headline).toContain("1 PR blocked");
    // No first_seen_at → no dangling "since … ago" clause.
    expect(headline).not.toContain("since");
    expect(headline).toContain("a/b main is RED — ");
  });
});
