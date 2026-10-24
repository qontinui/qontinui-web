import { describe, expect, it } from "vitest";
import { FULL_FLOW, NULL_FLOW } from "../__fixtures__/flow";
import {
  NO_DATA,
  deriveFlowHealth,
  durationWords,
  failureSentence,
  flowQuery,
  histogramPoints,
  metricTitle,
  metricValue,
  parseFlowReadFailure,
  passWord,
  percentWords,
  readFlowBody,
  scopeCounts,
  sessionHref,
} from "./overlordFlowStatus";

describe("flowQuery", () => {
  it("maps each window onto contract §2's window_hours", () => {
    expect(flowQuery("24h")).toBe("window_hours=24");
    expect(flowQuery("7d")).toBe("window_hours=168");
    expect(flowQuery("30d")).toBe("window_hours=720");
  });
});

describe("readFlowBody", () => {
  it("refuses a body that is not a flow answer", () => {
    expect(readFlowBody(null)).toBeNull();
    expect(readFlowBody([])).toBeNull();
    expect(readFlowBody({ ok: false })).toBeNull();
    expect(readFlowBody({ error: "x" })).toBeNull();
  });

  it("keeps coord's explicit null apart from an absent field", () => {
    const nulls = readFlowBody(NULL_FLOW)!;
    expect(nulls.timeToClose.medianSecs).toBeNull();
    expect(nulls.nudge.progressRate).toBeNull();

    const absent = readFlowBody({ ok: true })!;
    expect(absent.timeToClose.medianSecs).toBeUndefined();
    expect(absent.nudge.progressRate).toBeUndefined();
    expect(absent.passesConsidered).toBeUndefined();
    expect(absent.unchanged).toBeNull();
    expect(absent.series).toBeNull();
    expect(absent.latestUnknown).toBeUndefined();
  });

  it("treats a null COUNT as unknown, never as a zero", () => {
    const v = readFlowBody({ ok: true, nudge: { nudged: null } })!;
    expect(v.nudge.nudged).toBeUndefined();
  });

  it("reads a missing closed_by kind as zero only when the rest add up", () => {
    const complete = readFlowBody({
      ok: true,
      time_to_close: { count: 3, closed_by: { triage: 3 } },
    })!;
    expect(complete.timeToClose.byTriage).toBe(3);
    expect(complete.timeToClose.byAbsent).toBe(0);

    const short = readFlowBody({
      ok: true,
      time_to_close: { count: 5, closed_by: { triage: 3 } },
    })!;
    expect(short.timeToClose.byAbsent).toBeUndefined();
  });

  it("picks the most recent pass's unknown share whatever the list order", () => {
    expect(readFlowBody(FULL_FLOW)!.latestUnknown?.passId).toBe("p-new");
    expect(
      readFlowBody({ ok: true, unknown_share: [] })!.latestUnknown
    ).toBeNull();
  });

  it("sorts the verdict series oldest first", () => {
    expect(readFlowBody(FULL_FLOW)!.series!.map((p) => p.passId)).toEqual([
      "p-old",
      "p-filtered",
      "p-new",
    ]);
  });

  it("drops malformed unchanged rows rather than rendering half a row", () => {
    const v = readFlowBody({
      ok: true,
      unchanged: [{ key: "k" }, FULL_FLOW.unchanged[0]],
    })!;
    expect(v.unchanged).toHaveLength(1);
  });
});

describe("latest unknown share", () => {
  const entry = {
    pass_id: "p1",
    started_at: "2026-10-23T20:00:00Z",
    rows: 40,
    unknown_rows: 2,
  };

  it("keeps an absent or non-number share UNKNOWN, never 'no data'", () => {
    for (const share of [undefined, "5%", Number.NaN]) {
      const v = readFlowBody({
        ok: true,
        unknown_share: [{ ...entry, share }],
      })!;
      expect(v.latestUnknown?.share).toBeUndefined();
    }
    const nulled = readFlowBody({
      ok: true,
      unknown_share: [{ ...entry, share: null }],
    })!;
    expect(nulled.latestUnknown?.share).toBeNull();
  });

  it("is unknown when entries arrived and none could be read", () => {
    const v = readFlowBody({
      ok: true,
      unknown_share: [{ pass_id: "p1" }, "garbage", { ...entry, rows: "40" }],
    })!;
    expect(v.latestUnknown).toBeUndefined();
  });

  it("is 'no pass' (null) only for an empty list", () => {
    expect(
      readFlowBody({ ok: true, unknown_share: [] })!.latestUnknown
    ).toBeNull();
  });
});

describe("pass scope and mode", () => {
  it("keeps an unrecognised scope or mode as null, never a default", () => {
    const v = readFlowBody({
      ok: true,
      verdict_series: [
        {
          pass_id: "p1",
          started_at: "2026-10-23T20:00:00Z",
          scope: "partial",
          mode: "dry-run",
          histogram: { BUSY: 1 },
        },
        {
          pass_id: "p2",
          started_at: "2026-10-23T21:00:00Z",
          scope: "filtered",
          mode: "act",
          histogram: { BUSY: 1 },
        },
        {
          pass_id: "p3",
          started_at: "2026-10-23T22:00:00Z",
          histogram: { BUSY: 1 },
        },
      ],
    })!;
    expect(v.series!.map((p) => [p.scope, p.mode])).toEqual([
      [null, null],
      ["filtered", "act"],
      [null, null],
    ]);
    const points = histogramPoints(v.series!);
    expect(scopeCounts(points)).toEqual({ filtered: 1, unknown: 2 });
    expect(passWord(points[0]!.scope)).toBe("unknown");
    expect(passWord(points[1]!.mode)).toBe("act");
  });
});

describe("metric words", () => {
  it("renders the three states distinctly", () => {
    expect(metricValue(5400, durationWords)).toBe("1h 30m");
    expect(metricValue(null, durationWords)).toBe(NO_DATA);
    expect(metricValue(undefined, durationWords)).toBeNull();
    expect(metricTitle(null, "why")).toBe("no data — why");
    expect(metricTitle(undefined, "why")).toMatch(/^unknown/);
    expect(metricTitle(1, "why")).toBeUndefined();
  });

  it("formats durations and percentages", () => {
    expect(durationWords(42)).toBe("42s");
    expect(durationWords(120)).toBe("2m");
    expect(durationWords(3600)).toBe("1h");
    expect(durationWords(20000)).toBe("5h 33m");
    expect(durationWords(90000)).toBe("1d 1h");
    expect(percentWords(0)).toBe("0%");
    expect(percentWords(0.004)).toBe("<1%");
    expect(percentWords(0.4)).toBe("40%");
    expect(percentWords(0.996)).toBe(">99%");
    expect(percentWords(1)).toBe("100%");
  });

  it("renders a non-finite number as unknown, never as a percentage", () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
      expect(percentWords(n)).toBe("–");
      expect(durationWords(n)).toBe("–");
    }
  });
});

describe("parseFlowReadFailure", () => {
  it("reads coord's typed body behind the status", () => {
    const f = parseFlowReadFailure(
      new Error(
        'GET /api/v1/operations/coord/overlord/flow?window_hours=24 failed: 503 - {"error":"schema_migration_pending","detail":"42P01"}'
      )
    );
    expect(f).toEqual({
      status: 503,
      code: "schema_migration_pending",
      detail: "42P01",
    });
    expect(failureSentence(f)).toMatch(/migration is pending/);
  });

  it("names a refused query's field", () => {
    const f = parseFlowReadFailure(
      new Error(
        'GET /x failed: 422 - {"error":"invalid_shape","field":"window_hours"}'
      )
    );
    expect(failureSentence(f)).toBe("coord refused the query (window_hours)");
  });

  it("is 'could not be reached' when no status came back", () => {
    const f = parseFlowReadFailure(new TypeError("Failed to fetch"));
    expect(f.status).toBeNull();
    expect(failureSentence(f)).toBe("coord could not be reached");
  });
});

describe("deriveFlowHealth", () => {
  const view = readFlowBody(FULL_FLOW)!;

  it("is UNKNOWN before any answer when the read failed", () => {
    const h = deriveFlowHealth({
      view: null,
      loaded: false,
      failed: true,
      failure: { status: null, code: null, detail: null },
      windowId: "7d",
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Session flow is unknown");
    expect(h.badges.map((b) => b.label)).toEqual([
      "passes –",
      "full –",
      "unchanged –",
    ]);
  });

  it("never paints green over a stale read", () => {
    const h = deriveFlowHealth({
      view: { ...view, unchanged: [] },
      loaded: true,
      failed: true,
      failure: null,
      windowId: "7d",
    });
    expect(h.level).toBe("amber");
    expect(h.detail).toMatch(/^Last refresh failed/);
  });

  it("is amber for a window with no pass — nothing measured is not an all-clear", () => {
    const h = deriveFlowHealth({
      view: { ...view, passesConsidered: 0, unchanged: [] },
      loaded: true,
      failed: false,
      failure: null,
      windowId: "24h",
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("No triage pass recorded in the last 24 hours");
  });

  it("is amber over a truncated read, and when truncation is unstated", () => {
    for (const truncated of [true, undefined]) {
      const h = deriveFlowHealth({
        view: { ...view, truncated, unchanged: [] },
        loaded: true,
        failed: false,
        failure: null,
        windowId: "7d",
      });
      expect(h.level).toBe("amber");
    }
  });

  it("is amber with unchanged sessions and green with none", () => {
    expect(
      deriveFlowHealth({
        view,
        loaded: true,
        failed: false,
        failure: null,
        windowId: "7d",
      }).level
    ).toBe("amber");
    expect(
      deriveFlowHealth({
        view: { ...view, unchanged: [] },
        loaded: true,
        failed: false,
        failure: null,
        windowId: "7d",
      }).level
    ).toBe("green");
  });
});

describe("histogramPoints", () => {
  it("folds unlisted verdicts into 'other' and keeps the full breakdown", () => {
    const [newest] = histogramPoints(readFlowBody(FULL_FLOW)!.series!).slice(
      -1
    );
    expect(newest!.counts).toEqual({
      BUSY: 33,
      STOPPED: 3,
      FINISHED: 0,
      other: 2,
      UNKNOWN: 2,
    });
    expect(newest!.total).toBe(40);
    expect(newest!.topSeries).toBe("UNKNOWN");
    expect(newest!.breakdown[0]).toEqual(["BUSY", 33]);
  });

  it("gives an empty pass a zero total, not a missing bar", () => {
    const [only] = histogramPoints(readFlowBody(NULL_FLOW)!.series!);
    expect(only!.total).toBe(0);
    expect(only!.topSeries).toBeNull();
    expect(only!.breakdown).toEqual([]);
  });
});

describe("topSeries", () => {
  it("is the topmost NON-ZERO segment, whichever verdict it is", () => {
    const [p] = histogramPoints([
      {
        passId: "p",
        startedAt: "2026-10-23T20:00:00Z",
        scope: "full",
        mode: "report",
        histogram: { BUSY: 4, STOPPED: 1 },
      },
    ]);
    expect(p!.topSeries).toBe("STOPPED");
  });
});

describe("sessionHref", () => {
  it("links only a proven Claude session id", () => {
    const [proven, unproven] = readFlowBody(FULL_FLOW)!.unchanged!;
    expect(sessionHref(proven!)).toBe(`/sessions/${proven!.claude_session_id}`);
    expect(sessionHref(unproven!)).toBeNull();
  });
});
