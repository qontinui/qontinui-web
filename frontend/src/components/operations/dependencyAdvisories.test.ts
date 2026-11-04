/**
 * The pure half of the Rust advisory census section (plan
 * `2026-11-02-rust-advisories-have-no-fleet-consumer` Phase 5): how a census
 * row is dated, when it is stale, and when its verdict is not calm. Each case
 * is one of the honesty rules in `dependencyAdvisories.ts`'s module doc.
 */

import { describe, expect, it } from "vitest";
import {
  CENSUS_STALE_AFTER_SECS,
  CLOCK_SKEW_ALLOWANCE_SECS,
  censusAgeSecs,
  censusRowKey,
  lastCensusCycle,
  parseDependencyAdvisoriesPayload,
  rustCensusRows,
  viewCensusRow,
  type DependencyAdvisory,
  type DependencyCensusRow,
} from "./dependencyAdvisories";

const NOW = Date.parse("2026-11-04T12:00:00Z");

function row(
  overrides: Partial<DependencyCensusRow> = {}
): DependencyCensusRow {
  return {
    repo: "qontinui/qontinui-coord",
    ecosystem: "rust",
    sha: "fe1dde77f",
    db_commit: "abc1234",
    state: "clean",
    reason: null,
    advisory_count: 0,
    observed_at: new Date(NOW - 3600 * 1000).toISOString(),
    age_secs: 3600,
    advisories: [],
    ...overrides,
  };
}

function advisory(
  overrides: Partial<DependencyAdvisory> = {}
): DependencyAdvisory {
  return {
    advisory_id: "RUSTSEC-2026-0001",
    package: "tokio",
    version: "1.0.0",
    patched: [">=1.0.1"],
    severity: "high",
    ignored: false,
    first_seen_at: null,
    last_seen_at: null,
    resolved_at: null,
    ...overrides,
  };
}

describe("censusAgeSecs", () => {
  it("reads observed_at against the clock when it parses, ignoring age_secs", () => {
    const r = row({
      observed_at: new Date(NOW - 7200 * 1000).toISOString(),
      age_secs: 5,
    });
    expect(censusAgeSecs(r, NOW, NOW)).toBe(7200);
  });

  it("falls back to age_secs plus the time since the answer when observed_at is absent", () => {
    const r = row({ observed_at: null, age_secs: 100 });
    // Answered 50 s ago: coord's 100 s is now 150 s.
    expect(censusAgeSecs(r, NOW, NOW - 50_000)).toBe(150);
  });

  it("falls back to age_secs when observed_at does not parse", () => {
    const r = row({ observed_at: "not a time", age_secs: 30 });
    expect(censusAgeSecs(r, NOW, NOW)).toBe(30);
  });

  it("is undatable (null) with neither field", () => {
    expect(
      censusAgeSecs(row({ observed_at: null, age_secs: null }), NOW, NOW)
    ).toBeNull();
  });

  it("is undatable with age_secs but no answer time to anchor it", () => {
    expect(
      censusAgeSecs(row({ observed_at: null, age_secs: 30 }), NOW, null)
    ).toBeNull();
  });

  it("is undatable — not age 0 — when observed_at is past the skew allowance in the future", () => {
    const r = row({
      observed_at: new Date(
        NOW + (CLOCK_SKEW_ALLOWANCE_SECS + 60) * 1000
      ).toISOString(),
      age_secs: 10,
    });
    expect(censusAgeSecs(r, NOW, NOW)).toBeNull();
  });

  it("reads a future stamp within the skew allowance as age 0", () => {
    const r = row({ observed_at: new Date(NOW + 60_000).toISOString() });
    expect(censusAgeSecs(r, NOW, NOW)).toBe(0);
  });
});

describe("viewCensusRow — staleness", () => {
  it("an undatable census is stale and amber, even when clean", () => {
    const v = viewCensusRow(
      row({ observed_at: null, age_secs: null }),
      NOW,
      NOW
    );
    expect(v.ageSecs).toBeNull();
    expect(v.stale).toBe(true);
    expect(v.attention).toBe("waiting");
  });

  it("a future-stamped census is stale, not fresh", () => {
    const v = viewCensusRow(
      row({ observed_at: new Date(NOW + 3600 * 1000).toISOString() }),
      NOW,
      NOW
    );
    expect(v.stale).toBe(true);
    expect(v.attention).toBe("waiting");
  });

  it("a census past 36h is stale; one just under is not", () => {
    const at = (secs: number) =>
      viewCensusRow(
        row({ observed_at: new Date(NOW - secs * 1000).toISOString() }),
        NOW,
        NOW
      );
    expect(at(CENSUS_STALE_AFTER_SECS + 1).stale).toBe(true);
    expect(at(CENSUS_STALE_AFTER_SECS - 1).stale).toBe(false);
    expect(at(CENSUS_STALE_AFTER_SECS - 1).attention).toBe("none");
  });
});

describe("viewCensusRow — states and counts", () => {
  it("an unrecognised state is amber with an unmeasured (null) count", () => {
    const v = viewCensusRow(row({ state: "partially_clean" }), NOW, NOW);
    expect(v.state).toBe("unrecognised");
    expect(v.openCount).toBeNull();
    expect(v.attention).toBe("waiting");
  });

  it("an unknown state has a null count, never 0, even when coord sent advisory_count 0", () => {
    const v = viewCensusRow(
      row({ state: "unknown", advisory_count: 0, reason: "no cargo-audit" }),
      NOW,
      NOW
    );
    expect(v.openCount).toBeNull();
    expect(v.attention).toBe("waiting");
  });

  it("counts only open advisories: ignored and resolved are not open", () => {
    const v = viewCensusRow(
      row({
        state: "vulnerable",
        advisories: [
          advisory(),
          advisory({ advisory_id: "RUSTSEC-2026-0002", ignored: true }),
          advisory({
            advisory_id: "RUSTSEC-2026-0003",
            resolved_at: "2026-11-04T00:00:00Z",
          }),
        ],
      }),
      NOW,
      NOW
    );
    expect(v.openCount).toBe(1);
    expect(v.ignoredCount).toBe(1);
    expect(v.attention).toBe("author");
    expect(v.contradiction).toBeNull();
  });

  it("vulnerable with nothing open is a contradiction, amber", () => {
    const v = viewCensusRow(
      row({
        state: "vulnerable",
        advisories: [advisory({ ignored: true })],
      }),
      NOW,
      NOW
    );
    expect(v.contradiction).toBe(
      "state vulnerable, but no open advisory listed"
    );
    expect(v.attention).toBe("waiting");
  });

  it("clean with an open advisory is a contradiction, at the same attention as vulnerable-with-nothing-open", () => {
    const clean = viewCensusRow(
      row({
        state: "clean",
        advisories: [advisory(), advisory({ package: "x" })],
      }),
      NOW,
      NOW
    );
    const vuln = viewCensusRow(row({ state: "vulnerable" }), NOW, NOW);
    expect(clean.contradiction).toBe(
      "state clean, but 2 open advisories listed"
    );
    expect(clean.attention).toBe("waiting");
    expect(clean.attention).toBe(vuln.attention);
  });

  it("a fresh clean with nothing open is calm", () => {
    const v = viewCensusRow(row(), NOW, NOW);
    expect(v.contradiction).toBeNull();
    expect(v.openCount).toBe(0);
    expect(v.attention).toBe("none");
  });
});

describe("rust rows, keys and the census cycle", () => {
  it("keeps only ecosystem rust rows", () => {
    const rows = [
      row({ repo: "a" }),
      row({ repo: "b", ecosystem: "npm" }),
      row({ repo: "c", ecosystem: null }),
    ];
    expect(rustCensusRows(rows).map((r) => r.repo)).toEqual(["a"]);
  });

  it("keys a row by repo and ecosystem", () => {
    expect(censusRowKey(row({ repo: "o/r" }))).toBe("o/r:rust");
  });

  it("dates the cycle by the NEWEST datable row", () => {
    const views = [
      viewCensusRow(
        row({ observed_at: new Date(NOW - 50 * 3600 * 1000).toISOString() }),
        NOW,
        NOW
      ),
      viewCensusRow(
        row({ observed_at: new Date(NOW - 2 * 3600 * 1000).toISOString() }),
        NOW,
        NOW
      ),
      viewCensusRow(row({ observed_at: null, age_secs: null }), NOW, NOW),
    ];
    expect(lastCensusCycle(views)).toEqual({ ageSecs: 7200, stale: false });
  });

  it("a cycle whose newest row is past 36h is stale", () => {
    const views = [
      viewCensusRow(
        row({ observed_at: new Date(NOW - 40 * 3600 * 1000).toISOString() }),
        NOW,
        NOW
      ),
    ];
    expect(lastCensusCycle(views).stale).toBe(true);
  });

  it("a cycle with no datable row is undatable and stale", () => {
    expect(lastCensusCycle([])).toEqual({ ageSecs: null, stale: true });
  });
});

describe("parseDependencyAdvisoriesPayload", () => {
  it("accepts the census shape", () => {
    const parsed = parseDependencyAdvisoriesPayload({
      available: true,
      census: [row()],
    });
    expect(parsed?.census).toHaveLength(1);
  });

  it("refuses a body without available: true, so it reads as a failed read, not an empty census", () => {
    expect(parseDependencyAdvisoriesPayload({ census: [] })).toBeNull();
    expect(
      parseDependencyAdvisoriesPayload({ available: false, census: [] })
    ).toBeNull();
  });

  it("refuses a row with no repo or state", () => {
    expect(
      parseDependencyAdvisoriesPayload({
        available: true,
        census: [{ repo: "a" }],
      })
    ).toBeNull();
  });
});
