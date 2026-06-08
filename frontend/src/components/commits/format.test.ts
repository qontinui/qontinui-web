/**
 * Unit tests for the pure commit-lineage formatting helpers (`format.ts`).
 */

import { describe, expect, it } from "vitest";

import { commitUrl, formatTs, sessionLabel, shortSha } from "./format";

describe("shortSha", () => {
  it("truncates a full sha to 7 chars", () => {
    expect(shortSha("deadbeefdeadbeefdeadbeef")).toBe("deadbee");
  });

  it("returns the whole string when shorter than 7 chars", () => {
    expect(shortSha("abc")).toBe("abc");
  });

  it("returns empty for an empty sha", () => {
    expect(shortSha("")).toBe("");
  });
});

describe("sessionLabel", () => {
  it("prefers the trimmed session name when present", () => {
    expect(sessionLabel("  ufix-session  ", "abcd1234-ef")).toBe("ufix-session");
  });

  it("falls back to the first 8 chars of the id when name is blank", () => {
    expect(sessionLabel("   ", "abcd1234-5678-90")).toBe("abcd1234");
  });

  it("falls back to the id when name is null", () => {
    expect(sessionLabel(null, "abcd1234-5678")).toBe("abcd1234");
  });

  it("returns 'unattributed' when both name and id are missing", () => {
    expect(sessionLabel(null, null)).toBe("unattributed");
    expect(sessionLabel(undefined, undefined)).toBe("unattributed");
    expect(sessionLabel("  ", "  ")).toBe("unattributed");
  });
});

describe("formatTs", () => {
  it("returns an em-dash for null", () => {
    expect(formatTs(null)).toBe("—");
  });

  it("returns the raw string for unparseable input", () => {
    expect(formatTs("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp into a locale string", () => {
    const out = formatTs("2026-06-08T12:00:00+00:00");
    expect(out).not.toBe("—");
    expect(out).not.toBe("2026-06-08T12:00:00+00:00");
    // toLocaleString of a valid date is non-empty and parseable back.
    expect(out.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date("2026-06-08T12:00:00+00:00").getTime())).toBe(
      false
    );
  });
});

describe("commitUrl", () => {
  it("builds a GitHub commit URL from repo + sha", () => {
    expect(commitUrl("qontinui/qontinui-web", "deadbeef")).toBe(
      "https://github.com/qontinui/qontinui-web/commit/deadbeef"
    );
  });
});
