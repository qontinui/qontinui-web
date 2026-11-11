import { describe, expect, it } from "vitest";

import * as twinFidelity from "./twin-fidelity";
import {
  fidelityReadAt,
  formatAge,
  readFidelity,
  reportAgeText,
} from "./twin-fidelity";
import type { RawVerdictResponse } from "./types";

const idle = { isLoading: false, isError: false, error: null };

describe("the status a failed read carries", () => {
  it("is read by the console's one anchored reader, not a copy of its own", () => {
    expect("httpStatusOf" in twinFidelity).toBe(false);
  });

  it("reads 403 and 404 from the client's status field", () => {
    const failing = (message: string) =>
      readFidelity(
        {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error(message),
        },
        0
      );
    expect(failing("GET /x failed: 403 - {}")).toEqual({ kind: "internal" });
    expect(failing("GET /x failed: 404 - nope").kind).toBe("unknown");
  });

  it("never reads a status out of text that is not the client's status field", () => {
    // Not an httpClient rejection: no verb, no URL. An unanchored reader took
    // the 403 and showed the calm Qontinui-internal notice for an unknown
    // failure.
    const read = readFidelity(
      {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("proxy failed: 403 - upstream refused"),
      },
      0
    );
    expect(read).toEqual({
      kind: "unknown",
      reason: "the twin-fidelity read failed",
    });
  });
});

describe("fidelityReadAt", () => {
  it("takes a report's ages at its read when one has landed", () => {
    expect(fidelityReadAt({ dataUpdatedAt: 1_000 }, 9_000)).toBe(1_000);
  });

  it("falls back to now while no read has landed", () => {
    expect(fidelityReadAt({ dataUpdatedAt: 0 }, 9_000)).toBe(9_000);
    expect(fidelityReadAt({}, 9_000)).toBe(9_000);
  });
});

describe("reportAgeText", () => {
  it("words a served age as of its read and names coord as its source", () => {
    expect(reportAgeText({ ageSeconds: 120, ageSource: "served" })).toBe(
      "report 2m old as of its read (age served by coord)"
    );
  });

  it("words a computed age as of its read and names computed_at as its source", () => {
    expect(reportAgeText({ ageSeconds: 90, ageSource: "computed_at" })).toBe(
      "report 2m old as of its read (from its computed_at)"
    );
  });

  it("says UNKNOWN for an age the body did not carry", () => {
    expect(reportAgeText({ ageSeconds: null, ageSource: null })).toBe(
      "report age UNKNOWN"
    );
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
    expect(read.report.ageSource).toBe("computed_at");
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
