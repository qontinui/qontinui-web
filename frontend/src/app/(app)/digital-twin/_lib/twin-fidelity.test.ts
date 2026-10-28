import { describe, expect, it } from "vitest";

import { formatAge, httpStatusOf, readFidelity } from "./twin-fidelity";
import type { RawVerdictResponse } from "./types";

const idle = { isLoading: false, isError: false, error: null };

describe("httpStatusOf", () => {
  it("reads the status the http client's error message carries", () => {
    expect(httpStatusOf(new Error("GET /x failed: 404 - nope"))).toBe(404);
    expect(httpStatusOf(new Error("GET /x failed: 403 - {}"))).toBe(403);
    expect(httpStatusOf(new Error("network down"))).toBeNull();
    expect(httpStatusOf("not an error")).toBeNull();
  });
});

describe("readFidelity", () => {
  it("is loading while the read is in flight", () => {
    expect(
      readFidelity({ ...idle, data: undefined, isLoading: true }, 0)
    ).toEqual({ kind: "loading" });
  });

  it("is UNKNOWN for a read react-query holds — never a report coord did not return", () => {
    // Pending and not fetching (this browser offline): coord was not asked.
    expect(readFidelity({ ...idle, data: undefined }, 0)).toEqual({
      kind: "unknown",
      reason:
        "no read of coord's twin-fidelity report has answered, and none is in flight",
    });
    // An answer carrying no report is coord's own silence, and says so.
    const empty = {
      subspace: "twin_fidelity",
      tool: "t",
    } as unknown as RawVerdictResponse;
    expect(readFidelity({ ...idle, data: empty }, 0)).toEqual({
      kind: "unknown",
      reason: "coord returned no report",
    });
  });

  it("is UNKNOWN on a failure other than 403, never a zero report", () => {
    const read = readFidelity(
      {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("GET /x failed: 502 - bad gateway"),
      },
      0
    );
    expect(read).toEqual({
      kind: "unknown",
      reason: "the twin-fidelity read failed (HTTP 502)",
    });
  });

  it("is UNKNOWN for a body with none of the report's fields", () => {
    const read = readFidelity(
      {
        ...idle,
        data: { subspace: "twin_fidelity", tool: "t", verdict: {} },
      },
      0
    );
    expect(read.kind).toBe("unknown");
  });

  it("dates a report from computed_at when it carries no age_seconds", () => {
    const computedAt = "2026-10-11T12:00:00Z";
    const now = Date.parse(computedAt) + 90_000;
    const read = readFidelity(
      {
        ...idle,
        data: {
          subspace: "twin_fidelity",
          tool: "t",
          verdict: { observability_rate: 1, computed_at: computedAt },
        },
      },
      now
    );
    if (read.kind !== "report") throw new Error(`read ${read.kind}`);
    expect(read.report.ageSeconds).toBe(90);
    expect(read.report.observabilityRate).toBe(1);
    // A field coord does not serve is UNKNOWN, not 0.
    expect(read.report.staleEvidenceViolations).toBeNull();
  });
});

describe("formatAge", () => {
  it("renders UNKNOWN for no age", () => {
    expect(formatAge(null)).toBe("UNKNOWN");
    expect(formatAge(30)).toBe("30s old");
    expect(formatAge(7200)).toBe("2h old");
  });
});
