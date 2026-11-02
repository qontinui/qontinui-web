import { describe, expect, it } from "vitest";
import type { FlowUnchangedSession } from "@/lib/api/operations/overlordFlow";
import {
  FULL_FLOW,
  NULL_FLOW,
  RUNNERS_ALL_COVERED,
  RUNNERS_TWO_SHORT,
  SESSION_ID,
  VERSION_OLD,
} from "../__fixtures__/flow";
import type { FlowUnchangedSession } from "@/lib/api/operations/overlordFlow";
import {
  NO_DATA,
  closedCountMismatch,
  closedSessionHref,
  closedSessionLabel,
  deriveFlowHealth,
  durationWords,
  failureSentence,
  flowQuery,
  histogramPoints,
  lastInterventionWords,
  metricTitle,
  metricValue,
  nudgeNoDataWhy,
  parseFlowReadFailure,
  passWord,
  percentWords,
  readFlowBody,
  laterStopAt,
  scopeCounts,
  sessionHref,
  SEGMENT_GAP_PX,
  UNCHANGED_MIN_PASSES,
  insetSegment,
  unchangedCoverage,
  unchangedRowKey,
  versionWords,
  type ClosedSession,
  type ClosedSessions,
  type FlowView,
  type VersionGroup,
} from "./overlordFlowStatus";

describe("flowQuery", () => {
  it("maps each window onto contract §2's window_hours", () => {
    expect(flowQuery("24h")).toBe(
      "window_hours=24&unchanged_min_passes=3&group_by=overlord_version"
    );
    expect(flowQuery("7d")).toBe(
      "window_hours=168&unchanged_min_passes=3&group_by=overlord_version"
    );
    expect(flowQuery("30d")).toBe(
      "window_hours=720&unchanged_min_passes=3&group_by=overlord_version"
    );
  });
});

describe("the fields coord serves beyond the tiles", () => {
  const view = () => readFlowBody(FULL_FLOW) as FlowView;

  it("reads the census count, the pending nudges and the list-cut flags", () => {
    const v = view();
    expect(v.censusPassesConsidered).toBe(2);
    expect(v.nudge.pending).toBe(1);
    expect(v.unchangedTruncated).toBe(false);
    expect(v.seriesTruncated).toBe(false);
  });

  it("keeps an absent flag unknown, never false", () => {
    const body = { ...FULL_FLOW } as Record<string, unknown>;
    delete body.unchanged_truncated;
    delete body.verdict_series_truncated;
    const v = readFlowBody(body) as FlowView;
    expect(v.unchangedTruncated).toBeUndefined();
    expect(v.seriesTruncated).toBeUndefined();
  });

  it("lists closed sessions newest close first, with the cut flag", () => {
    const closed = view().closed as ClosedSessions;
    expect(closed.truncated).toBe(false);
    expect(closed.sessions.slice(0, 2).map((c) => c.key)).toEqual([
      "terminal:term-3",
      SESSION_ID,
    ]);
  });

  it("makes the whole closed list unknown when any entry cannot be read", () => {
    const ttc = FULL_FLOW.time_to_close;
    const v = readFlowBody({
      ...FULL_FLOW,
      time_to_close: {
        ...ttc,
        sessions: [ttc.sessions[0], { ...ttc.sessions[1], secs: "1800" }],
      },
    }) as FlowView;
    expect(v.closed).toBeNull();
  });

  it.each([
    ["a closed time", { closed_at: "garbage" }],
    ["a first stop", { first_stopped_at: "garbage" }],
    ["a last stop", { stop_episode_started_at: "garbage" }],
  ])("makes the list unknown over an unreadable %s", (_name, bad) => {
    const ttc = FULL_FLOW.time_to_close;
    const v = readFlowBody({
      ...FULL_FLOW,
      time_to_close: { ...ttc, sessions: [{ ...ttc.sessions[0], ...bad }] },
    }) as FlowView;
    expect(v.closed).toBeNull();
  });

  it("takes an absent last stop as not served, not as unreadable", () => {
    const ttc = FULL_FLOW.time_to_close;
    const { stop_episode_started_at: _gone, ...session } = ttc.sessions[0];
    const v = readFlowBody({
      ...FULL_FLOW,
      time_to_close: { ...ttc, sessions: [session] },
    }) as FlowView;
    expect(v.closed?.sessions[0].stopEpisodeStartedAt).toBeNull();
  });

  it("says so when the tile's count and an uncut list disagree", () => {
    const closed = view().closed as ClosedSessions;
    expect(closedCountMismatch(closed, closed.sessions.length)).toBeNull();
    expect(closedCountMismatch(closed, 9)).toContain(
      "counted 9 closed sessions but listed 4"
    );
    expect(closedCountMismatch({ ...closed, truncated: true }, 9)).toBeNull();
  });

  it("labels a closed row without leading on a bare id", () => {
    expect(closedSessionLabel(SESSION_ID)).toBe("session 6f1c2d3e");
    expect(closedSessionLabel("terminal:term-3")).toBe("terminal term-3");
  });

  it("names a later stop only when the last stop differs from the first", () => {
    const closed = (view().closed as ClosedSessions).sessions;
    const recovered = closed.find((c) => c.key === SESSION_ID) as ClosedSession;
    const straight = closed.find(
      (c) => c.key === "terminal:term-3"
    ) as ClosedSession;
    expect(laterStopAt(recovered)).toBe("2026-10-20T11:00:00Z");
    expect(laterStopAt(straight)).toBeNull();
    expect(
      laterStopAt({ ...recovered, stopEpisodeStartedAt: null })
    ).toBeNull();
  });

  it("links a closed session only when its key is a proven session id", () => {
    expect(closedSessionHref(SESSION_ID)).toBe(`/sessions/${SESSION_ID}`);
    expect(closedSessionHref("terminal:term-3")).toBeNull();
  });

  it("keeps one session on two runners as two rows", () => {
    const row = (FULL_FLOW.unchanged[0] ?? {}) as FlowUnchangedSession;
    expect(unchangedRowKey({ ...row, runner_port: 9876 })).not.toBe(
      unchangedRowKey({ ...row, runner_port: 9877 })
    );
  });

  it("reads the version groups in coord's order, with their three states", () => {
    const groups = view().groups as VersionGroup[];
    expect(groups.map((g) => g.version)).toEqual([VERSION_OLD, null]);
    expect(groups[0]).toMatchObject({
      passes: 2,
      censusPasses: 1,
      closed: 0,
      medianSecs: null,
      latestUnknownShare: 0.5,
    });
    expect(groups[1]).toMatchObject({
      medianSecs: 5400,
      unchanged: 1,
      latestUnknownShare: 0.05,
    });
    expect(versionWords(VERSION_OLD)).toBe("2d0c39d0d5");
    expect(versionWords(null)).toBe("none recorded");
  });

  it("applies the list rules to a version's own unchanged list", () => {
    const group = FULL_FLOW.groups[1];
    const read = (over: object) =>
      (
        (
          readFlowBody({
            ...FULL_FLOW,
            groups: [{ ...group, ...over }],
          }) as FlowView
        ).groups as VersionGroup[]
      )[0];
    // An unreadable entry is unknown, never a count that includes it.
    expect(read({ unchanged: [{}] }).unchanged).toBeUndefined();
    expect(read({ unchanged_truncated: true }).unchangedTruncated).toBe(true);
    expect(read({ unchanged_truncated: undefined }).unchangedTruncated).toBe(
      undefined
    );
    // A pass that screened nothing: coord's explicit null, not an unknown.
    expect(
      read({
        unknown_share: [
          {
            pass_id: "p",
            started_at: "2026-10-23T12:00:00Z",
            rows: 0,
            unknown_rows: 0,
            share: null,
          },
        ],
      }).latestUnknownShare
    ).toBeNull();
  });

  it("words a missing version as unknown, not as none recorded", () => {
    expect(versionWords(undefined)).toBe("unknown");
  });

  it.each([
    ["absent", undefined],
    ["a group with no version key", [{ passes_considered: 1 }]],
    ["an empty version", [{ overlord_version: "" }]],
    ["a non-object group", [3]],
  ])("makes the groups unknown for %s", (_name, groups) => {
    const v = readFlowBody({ ...FULL_FLOW, groups }) as FlowView;
    expect(v.groups).toBeNull();
  });
});

describe("nudgeNoDataWhy", () => {
  it("claims only delivery, since coord's counts exclude a failed nudge", () => {
    expect(nudgeNoDataWhy({ nudged: 0, pending: 0 }, "progress")).toBe(
      "no nudge was delivered in this window"
    );
  });

  it("never says that of nudges sent but not yet measured", () => {
    expect(nudgeNoDataWhy({ nudged: 4, pending: 0 }, "progress")).toBe(
      "no nudge in this window has a progress measurement yet"
    );
    expect(nudgeNoDataWhy({ nudged: 4, pending: 0 }, "finish")).toBe(
      "no nudge in this window has a known outcome"
    );
    expect(nudgeNoDataWhy({ nudged: 0, pending: 2 }, "finish")).toBe(
      "2 delivered, and no later pass has seen those sessions yet"
    );
  });

  it("does not assert none when a count did not arrive", () => {
    expect(nudgeNoDataWhy({ nudged: 0, pending: undefined }, "progress")).toBe(
      "no nudge has been measured in this window"
    );
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

  it("keeps a coord that sends no absent_unproven apart from a real zero", () => {
    const read = (ttc: object) =>
      readFlowBody({ ok: true, time_to_close: ttc })!.timeToClose
        .absentUnproven;
    expect(read({ count: 0, absent_unproven: 49 })).toBe(49);
    expect(read({ count: 0, absent_unproven: 0 })).toBe(0);
    expect(read({ count: 0 })).toBeUndefined();
    expect(read({ count: 0, absent_unproven: null })).toBeUndefined();
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

    // A kind that is PRESENT but unreadable is unknown even when the other
    // kind already adds up to the count.
    for (const unreadable of [null, "0"]) {
      const v = readFlowBody({
        ok: true,
        time_to_close: {
          count: 4,
          closed_by: { triage: unreadable, absent: 4 },
        },
      })!;
      expect(v.timeToClose.byTriage).toBeUndefined();
      expect(v.timeToClose.byAbsent).toBe(4);
    }
  });

  it("picks the most recent pass's unknown share whatever the list order", () => {
    expect(readFlowBody(FULL_FLOW)!.latestUnknown?.passId).toBe("p-new");
    expect(
      readFlowBody({
        ...FULL_FLOW,
        unknown_share: [...FULL_FLOW.unknown_share].reverse(),
      })!.latestUnknown?.passId
    ).toBe("p-new");
    expect(
      readFlowBody({ ok: true, unknown_share: [] })!.latestUnknown
    ).toBeNull();
  });

  it("reads the verdict series as UNKNOWN when any pass or count cannot be read", () => {
    const good = {
      pass_id: "p1",
      started_at: "2026-10-23T20:00:00Z",
      histogram: { BUSY: 1 },
    };
    for (const bad of [
      "garbage",
      { ...good, pass_id: null },
      { ...good, histogram: "x" },
      { ...good, histogram: { BUSY: "33" } },
      { ...good, histogram: { BUSY: Number.NaN } },
    ]) {
      expect(
        readFlowBody({ ok: true, verdict_series: [good, bad] })!.series
      ).toBeNull();
    }
    expect(
      readFlowBody({ ok: true, verdict_series: [good] })!.series
    ).toHaveLength(1);
  });

  it("reads an absent or unreadable reason list as an unreadable row", () => {
    const row = FULL_FLOW.unchanged[0]!;
    for (const reason_codes of [undefined, "x", ["a", 1]]) {
      expect(
        readFlowBody({ ok: true, unchanged: [{ ...row, reason_codes }] })!
          .unchanged
      ).toBeNull();
    }
    expect(
      readFlowBody({ ok: true, unchanged: [{ ...row, reason_codes: [] }] })!
        .unchanged![0]!.reason_codes
    ).toEqual([]);
  });

  it("sorts the verdict series oldest first", () => {
    expect(readFlowBody(FULL_FLOW)!.series!.map((p) => p.passId)).toEqual([
      "p-old",
      "p-filtered",
      "p-new",
    ]);
  });

  it("reads the unchanged list as UNKNOWN when any row cannot be read", () => {
    // Dropping the bad row would shrink the list toward the empty all-clear.
    for (const bad of [{ key: "k" }, null, "garbage"]) {
      const v = readFlowBody({
        ok: true,
        unchanged: [bad, FULL_FLOW.unchanged[0]],
      })!;
      expect(v.unchanged).toBeNull();
    }
    expect(
      readFlowBody({ ok: true, unchanged: [FULL_FLOW.unchanged[0]] })!.unchanged
    ).toHaveLength(1);
  });

  it("is never green when an unreadable row was the only stuck session", () => {
    const h = deriveFlowHealth({
      view: readFlowBody({
        ...FULL_FLOW,
        full_passes_by_runner: RUNNERS_ALL_COVERED,
        unchanged: [{ ...FULL_FLOW.unchanged[0], terminal_id: null }],
      })!,
      loaded: true,
      failed: false,
      failure: null,
      windowId: "7d",
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Session flow is partly unknown");
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

  it("is unknown when any entry is unreadable, even beside readable ones", () => {
    // The unreadable entry may be the newest pass; reporting the older one
    // as "latest" would be a stale number under a present-tense label.
    const v = readFlowBody({
      ok: true,
      unknown_share: [entry, { ...entry, pass_id: "p2", rows: "40" }],
    })!;
    expect(v.latestUnknown).toBeUndefined();
  });

  it("is unknown when an entry's start time cannot be parsed", () => {
    for (const order of [0, 1]) {
      const list = [entry, { ...entry, pass_id: "p2", started_at: "soon" }];
      const v = readFlowBody({
        ok: true,
        unknown_share: order ? list.reverse() : list,
      })!;
      expect(v.latestUnknown).toBeUndefined();
    }
    expect(
      readFlowBody({
        ok: true,
        verdict_series: [
          { pass_id: "p1", started_at: "soon", histogram: { BUSY: 1 } },
        ],
      })!.series
    ).toBeNull();
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

describe("lastInterventionWords", () => {
  const proven: FlowUnchangedSession = {
    key: "s",
    claude_session_id: "s",
    terminal_id: "t",
    session_name: null,
    verdict: "STOPPED",
    reason_codes: [],
    consecutive_full_passes: 3,
    first_seen_at: "2026-10-23T08:00:00Z",
    last_seen_at: "2026-10-23T20:00:00Z",
  };
  const judged = {
    intervention_id: "i",
    stop_class: "B",
    verb: "leave",
    mode: "shadow",
    executed: null,
    outcome: null,
    observed_at: "2026-10-23T19:00:00Z",
  };
  const at = (iso: string) => `at ${iso}`;

  it("names the judgment, and its outcome only when one was observed", () => {
    expect(
      lastInterventionWords({ ...proven, last_intervention: judged }, at)
    ).toBe(
      "Last /next-move: class B, leave (shadow), at 2026-10-23T19:00:00Z."
    );
    expect(
      lastInterventionWords(
        { ...proven, last_intervention: { ...judged, outcome: "did_work" } },
        at
      )
    ).toContain("outcome did_work");
  });

  it("never lets a live judgment read as carried out unless it was", () => {
    const live = { ...judged, mode: "live", verb: "nudge" };
    const words = (executed: boolean | null) =>
      lastInterventionWords(
        { ...proven, last_intervention: { ...live, executed } },
        at
      );
    expect(words(true)).toContain("nudge (live),");
    expect(words(false)).toContain("nudge (live, not executed),");
    expect(words(null)).toContain("nudge (live, execution not recorded),");
  });

  it("says a proven session has no judgment recorded, not that none happened", () => {
    expect(
      lastInterventionWords({ ...proven, last_intervention: null }, at)
    ).toBe("No /next-move judgment is recorded for this session.");
  });

  it("reads the field through the parser: null stays an answer, junk is none", () => {
    const body = (last: unknown) => ({
      ...FULL_FLOW,
      unchanged: [{ ...FULL_FLOW.unchanged[0], last_intervention: last }],
    });
    const parsed = (last: unknown) =>
      readFlowBody(body(last))?.unchanged?.[0]?.last_intervention;
    expect(parsed(judged)).toEqual(judged);
    expect(parsed(null)).toBeNull();
    expect(parsed(undefined)).toBeUndefined();
    expect(parsed({ stop_class: "A" })).toBeUndefined();
    expect(parsed("A")).toBeUndefined();
  });

  it("claims nothing for a coord without the field or an unproven session", () => {
    expect(lastInterventionWords(proven, at)).toBeNull();
    expect(
      lastInterventionWords(
        { ...proven, claude_session_id: null, last_intervention: null },
        at
      )
    ).toBeNull();
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
      "census –",
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
    // Every runner is covered, so ONLY the truncation can hold green back.
    const covered = readFlowBody({
      ...FULL_FLOW,
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      unchanged: [],
    })!;
    expect(
      deriveFlowHealth({
        view: covered,
        loaded: true,
        failed: false,
        failure: null,
        windowId: "7d",
      }).level
    ).toBe("green");
    for (const [truncated, headline] of [
      [true, "Session flow over a truncated read"],
      [undefined, "Whether this read was capped is unknown"],
    ] as const) {
      const capped = { ...covered, truncated };
      const h = deriveFlowHealth({
        view: capped,
        loaded: true,
        failed: false,
        failure: null,
        windowId: "7d",
      });
      expect(h.level).toBe("amber");
      expect(h.headline).toBe(headline);
      // The list's empty sentence reads the same verdict, so it cannot
      // state an all-clear the strip withholds.
      expect(
        unchangedCoverage(capped, "the last 7 days").everyRunnerCovered
      ).toBe(false);
    }
    expect(
      unchangedCoverage(
        { ...covered, passesConsidered: undefined },
        "the last 7 days"
      ).everyRunnerCovered
    ).toBe(false);
  });

  /** The strip for an empty unchanged list over a given flow body. */
  const stripOver = (body: Record<string, unknown>) =>
    deriveFlowHealth({
      view: readFlowBody({ ...FULL_FLOW, unchanged: [], ...body })!,
      loaded: true,
      failed: false,
      failure: null,
      windowId: "7d",
    });

  it("is not green for two runners with 2 full passes each (a tenant total of 4)", () => {
    const h = stripOver({
      full_passes_considered: 4,
      full_passes_by_runner: RUNNERS_TWO_SHORT,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Unchanged sessions cannot be confirmed");
    expect(h.detail).toBe(
      "2 of 2 runners ran fewer than 3 full passes — their sessions cannot be judged unchanged"
    );
  });

  it("is green only when every runner ran the applied number of full passes", () => {
    const h = stripOver({ full_passes_by_runner: RUNNERS_ALL_COVERED });
    expect(h.level).toBe("green");
    expect(h.headline).toBe("No session is stuck unchanged");
  });

  it("is never green over an empty unchanged list coord cut", () => {
    const h = stripOver({
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      unchanged_truncated: true,
    });
    expect(h.level).toBe("amber");
    expect(h.detail).toBe(
      "coord cut the unchanged list — unchanged cannot be confirmed"
    );
  });

  it("is never green when coord did not say whether it cut the list", () => {
    const h = stripOver({
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      unchanged_truncated: undefined,
    });
    expect(h.level).toBe("amber");
    expect(h.detail).toBe(
      "coord did not say whether it cut the unchanged list — unchanged cannot be confirmed"
    );
  });

  it("says at least when coord did not say whether it cut the list", () => {
    const body = { ...FULL_FLOW } as Record<string, unknown>;
    delete body.unchanged_truncated;
    const h = deriveFlowHealth({
      view: readFlowBody(body) as FlowView,
      loaded: true,
      failed: false,
      failure: null,
      windowId: "7d",
    });
    expect(h.headline).toMatch(/^At least 2 sessions/);
    expect(h.badges.map((b) => b.label)).toContain("unchanged 2+");
  });

  it("says at least, and marks the badge, when the unchanged list was cut", () => {
    const v = readFlowBody({
      ...FULL_FLOW,
      unchanged_truncated: true,
    }) as FlowView;
    const h = deriveFlowHealth({
      view: v,
      loaded: true,
      failed: false,
      failure: null,
      windowId: "7d",
    });
    expect(h.headline).toBe(
      "At least 2 sessions have not moved across consecutive full passes"
    );
    expect(h.badges.map((b) => b.label)).toContain("unchanged 2+");
  });

  it("counts census apart from full, and credits absence only to census", () => {
    const v = readFlowBody({
      ...FULL_FLOW,
      census_passes_considered: 1,
    }) as FlowView;
    const h = deriveFlowHealth({
      view: v,
      loaded: true,
      failed: false,
      failure: null,
      windowId: "7d",
    });
    const labels = h.badges.map((b) => b.label);
    expect(labels).toContain("full 2");
    expect(labels).toContain("census 1");
    expect(h.badges.find((b) => b.key === "census")?.title).toContain(
      "only these count absence and unchanged"
    );
    expect(h.badges.find((b) => b.key === "full")?.title).not.toContain(
      "absence"
    );
  });

  it("is never green on a total when per-runner counts are absent", () => {
    for (const total of [0, 3, 100]) {
      const h = stripOver({
        full_passes_considered: total,
        full_passes_by_runner: undefined,
      });
      expect(h.level, String(total)).toBe("amber");
      expect(h.detail).toBe(
        "per-runner full-pass counts not served — unchanged cannot be confirmed"
      );
    }
  });

  it("is not green on an empty or unreadable per-runner list", () => {
    expect(stripOver({ full_passes_by_runner: [] }).detail).toBe(
      "no runner reported a pass in the last 7 days — unchanged cannot be confirmed"
    );
    for (const bad of [
      "x",
      [RUNNERS_ALL_COVERED[0], { runner_port: 9877 }],
      [RUNNERS_ALL_COVERED[0], null],
    ]) {
      const h = stripOver({ full_passes_by_runner: bad });
      expect(h.level).toBe("amber");
      expect(h.detail).toMatch(/could not be read/);
    }
  });

  it("uses the threshold coord applied, else the one the page sent", () => {
    const strict = readFlowBody({
      ...FULL_FLOW,
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      params: { unchanged_min_passes: 4, nudge_window_passes: 3 },
    })!;
    expect(strict.unchangedMinPasses).toBe(4);
    expect(unchangedCoverage(strict, "the last 7 days")).toEqual({
      everyRunnerCovered: false,
      sentence:
        "1 of 2 runners ran fewer than 4 full passes — their sessions cannot be judged unchanged",
    });
    for (const params of [undefined, {}, { unchanged_min_passes: 0 }, "x"]) {
      expect(readFlowBody({ ...FULL_FLOW, params })!.unchangedMinPasses).toBe(
        UNCHANGED_MIN_PASSES
      );
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
        view: {
          ...readFlowBody({
            ...FULL_FLOW,
            full_passes_by_runner: RUNNERS_ALL_COVERED,
          })!,
          unchanged: [],
        },
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

describe("insetSegment", () => {
  it("never insets the top segment, so the bar's total stays true", () => {
    expect(insetSegment(10, 20, true)).toEqual({ y: 10, height: 20 });
  });

  it("gives a lower segment's top edge to the gap", () => {
    expect(insetSegment(10, 20, false)).toEqual({
      y: 10 + SEGMENT_GAP_PX,
      height: 20 - SEGMENT_GAP_PX,
    });
  });

  it("keeps a thin lower segment at least 1px tall, never inflating one", () => {
    expect(insetSegment(10, 2, false)).toEqual({ y: 11, height: 1 });
    expect(insetSegment(10, 1.5, false)).toEqual({ y: 10.5, height: 1 });
    expect(insetSegment(10, 0.6, false)).toEqual({ y: 10, height: 0.6 });
    expect(insetSegment(10, 0, false)).toEqual({ y: 10, height: 0 });
  });
});

describe("sessionHref", () => {
  it("links only a proven Claude session id", () => {
    const [proven, unproven] = readFlowBody(FULL_FLOW)!.unchanged!;
    expect(sessionHref(proven!)).toBe(`/sessions/${proven!.claude_session_id}`);
    expect(sessionHref(unproven!)).toBeNull();
  });
});
