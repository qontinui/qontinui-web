/**
 * The live sub-space probe as every view of it reads it (plan
 * `2026-10-23-console-presentation-spaces` Phase 5): ONE rule for when it
 * holds no reading — a failed read with nothing held, or a degraded answer
 * (HTTP 200, no probe made) — under which every live-probed row is UNKNOWN
 * with the reason, never the stand-in cell's "error", and every count over
 * them is no count at all.
 */

import { describe, expect, it } from "vitest";
import {
  probeDegradedReason,
  probeReadOf,
  probeUnansweredReason,
  probeUnread,
  type ProbeQuery,
} from "./probe-read";
import { manifest, probeAnswered } from "./resolve";
import type { SubspaceProbe, SubspacesProbeResponse } from "./types";

const NOW = Date.parse("2026-10-23T12:00:00Z");

/** The manifest rows this page probes live when no catalog is read. */
const SNAPSHOT_IDS = manifest.subspaces
  .filter((s) => s.query_kind === "snapshot")
  .map((s) => s.id);

/** Every snapshot row answering `implemented`. */
const ANSWER: SubspacesProbeResponse = {
  subspaces: SNAPSHOT_IDS.map((id) => ({ id, status: "implemented" })),
  probed: SNAPSHOT_IDS.length,
  restricted: false,
};

/** The backend's degraded matrix: one stand-in `error` cell per declared id. */
const DEGRADED: SubspacesProbeResponse = {
  subspaces: SNAPSHOT_IDS.map((id) => ({
    id,
    status: "error",
    error: "coord_unavailable",
  })),
  probed: 0,
  restricted: false,
  degraded: true,
};

const DEGRADED_REASON =
  "coord's live probe could not be made: coord could not be reached";

function query(over: Partial<ProbeQuery> = {}): ProbeQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    online: true,
    ...over,
  };
}

const OFFLINE_REASON =
  "coord's live probe has not answered: this browser is offline";
const HELD_REASON =
  "coord's live probe has not answered, and no read of it is in flight";

const http502 = new Error(
  "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
);

describe("probeUnread — the one rule for when the probe holds no reading", () => {
  it("is a failed read with nothing held: the HTTP status, dated by the failed attempt", () => {
    const read = probeReadOf(
      query({ isError: true, error: http502, errorUpdatedAt: NOW }),
      undefined
    );
    expect(probeUnread(read)).toEqual({
      reason: "coord's live probe could not be read (HTTP 502)",
      asOf: NOW,
    });
  });

  it("is a degraded answer: its cause, dated by when it came back", () => {
    const read = probeReadOf(
      query({ data: DEGRADED, dataUpdatedAt: NOW - 5_000 }),
      undefined
    );
    expect(probeUnread(read)).toEqual({
      reason: DEGRADED_REASON,
      asOf: NOW - 5_000,
    });
  });

  it("is null for a real answer, and for a failed refresh over one — that answer is a reading", () => {
    expect(
      probeUnread(probeReadOf(query({ data: ANSWER, dataUpdatedAt: NOW })))
    ).toBeNull();
    const refreshFailed = probeReadOf(
      query({
        data: ANSWER,
        dataUpdatedAt: NOW - 120_000,
        isError: true,
        error: http502,
        errorUpdatedAt: NOW,
      }),
      undefined
    );
    expect(probeUnread(refreshFailed)).toBeNull();
    expect(refreshFailed.refreshFailed).toBe(true);
    expect(refreshFailed.asOf).toBe(NOW - 120_000);
  });

  it("is null while the first read is in flight — that is probing, not silence", () => {
    expect(
      probeUnread(probeReadOf(query({ isLoading: true }), undefined))
    ).toBeNull();
    // A read already in flight when the browser went offline is still one.
    expect(
      probeUnread(
        probeReadOf(query({ isLoading: true, online: false }), undefined)
      )
    ).toBeNull();
  });

  it("is a read react-query holds while this browser is offline: named, with no attempt to date it", () => {
    // Pending and not fetching: no answer, no failure, no read in flight.
    const read = probeReadOf(query({ online: false }), undefined);
    expect(read.unanswered).toBe(OFFLINE_REASON);
    expect(read.failed).toBe(false);
    expect(probeUnread(read)).toEqual({ reason: OFFLINE_REASON, asOf: null });
  });

  it("names no cause it cannot see when a read is held with the browser online", () => {
    // A retry paused while this tab is hidden, or a cancelled first read.
    expect(probeUnread(probeReadOf(query(), undefined))).toEqual({
      reason: HELD_REASON,
      asOf: null,
    });
  });

  it("leaves a failure, a degraded answer and an answer to their own rules, offline or not", () => {
    const failed = probeReadOf(
      query({
        isError: true,
        error: http502,
        errorUpdatedAt: NOW,
        online: false,
      })
    );
    expect(failed.unanswered).toBeNull();
    expect(probeUnread(failed)?.reason).toBe(
      "coord's live probe could not be read (HTTP 502)"
    );
    const degraded = probeReadOf(
      query({ data: DEGRADED, dataUpdatedAt: NOW, online: false })
    );
    expect(degraded.unanswered).toBeNull();
    expect(probeUnread(degraded)?.reason).toBe(DEGRADED_REASON);
    // An answer held from before the browser went offline is a reading.
    const held = probeReadOf(
      query({ data: ANSWER, dataUpdatedAt: NOW, online: false })
    );
    expect(held.unanswered).toBeNull();
    expect(probeUnread(held)).toBeNull();
  });
});

describe("probeUnansweredReason — a probe react-query is holding", () => {
  it("is null for an answer, a failure, or a read in flight", () => {
    expect(probeUnansweredReason(query({ data: ANSWER }))).toBeNull();
    expect(probeUnansweredReason(query({ isError: true }))).toBeNull();
    expect(probeUnansweredReason(query({ isLoading: true }))).toBeNull();
  });

  it("names the browser being offline only when react-query holds it so", () => {
    expect(probeUnansweredReason(query({ online: false }))).toBe(
      OFFLINE_REASON
    );
    expect(probeUnansweredReason(query({ online: true }))).toBe(HELD_REASON);
  });
});

describe("probeReadOf — rows under no reading", () => {
  const live = <T extends { liveProbed: boolean }>(rows: readonly T[]) =>
    rows.filter((r) => r.liveProbed);

  it("resolves every live-probed row of a degraded answer UNKNOWN with the reason — never its stand-in error", () => {
    const { rows } = probeReadOf(
      query({ data: DEGRADED, dataUpdatedAt: NOW }),
      undefined
    );
    const liveRows = live(rows);
    expect(liveRows.length).toBe(SNAPSHOT_IDS.length);
    for (const row of liveRows) {
      expect(row.cellStatus, row.id).toBe("unknown");
      expect(row.unknownReason, row.id).toBe(DEGRADED_REASON);
      // The stand-in's token and metrics are not the observer's.
      expect(row.error, row.id).toBeUndefined();
      expect(row.metrics, row.id).toBeUndefined();
    }
    expect(rows.some((r) => r.cellStatus === "error")).toBe(false);
  });

  it("resolves every live-probed row of a held read UNKNOWN — never the error of a probe that ran", () => {
    const { rows } = probeReadOf(query({ online: false }), undefined);
    const liveRows = live(rows);
    expect(liveRows.length).toBe(SNAPSHOT_IDS.length);
    for (const row of liveRows) {
      expect(row.cellStatus, row.id).toBe("unknown");
      expect(row.unknownReason, row.id).toBe(OFFLINE_REASON);
      // So nothing about the row may describe a probe answer.
      expect(probeAnswered(row), row.id).toBe(false);
    }
    expect(rows.some((r) => r.cellStatus === "error")).toBe(false);
  });

  it("resolves every live-probed row of a failed read UNKNOWN, naming the HTTP status", () => {
    const { rows } = probeReadOf(
      query({ isError: true, error: http502, errorUpdatedAt: NOW }),
      undefined
    );
    for (const row of live(rows)) {
      expect(row.cellStatus, row.id).toBe("unknown");
      expect(row.unknownReason, row.id).toBe(
        "coord's live probe could not be read (HTTP 502)"
      );
    }
  });

  it("leaves what is not probed live as the manifest says — the roadmap and the claims are no reading's", () => {
    const silent = probeReadOf(
      query({ data: DEGRADED, dataUpdatedAt: NOW }),
      undefined
    ).rows;
    const answered = probeReadOf(
      query({ data: ANSWER, dataUpdatedAt: NOW }),
      undefined
    ).rows;
    const notLive = (rows: typeof silent) =>
      rows.filter((r) => !r.liveProbed).map((r) => [r.id, r.cellStatus]);
    expect(notLive(silent)).toEqual(notLive(answered));
    expect(notLive(silent).length).toBeGreaterThan(0);
  });

  it("keeps a real answer's statuses, a held answer's after a failed refresh, and probing while loading", () => {
    const fresh = probeReadOf(query({ data: ANSWER, dataUpdatedAt: NOW }));
    expect(live(fresh.rows).every((r) => r.cellStatus === "implemented")).toBe(
      true
    );
    const held = probeReadOf(
      query({
        data: ANSWER,
        dataUpdatedAt: NOW - 120_000,
        isError: true,
        error: http502,
        errorUpdatedAt: NOW,
      })
    );
    expect(live(held.rows).every((r) => r.cellStatus === "implemented")).toBe(
      true
    );
    const loading = probeReadOf(query({ isLoading: true }));
    expect(live(loading.rows).every((r) => r.cellStatus === "probing")).toBe(
      true
    );
  });

  it("reads every probe refused as the restriction, not as silence", () => {
    const refused: SubspacesProbeResponse = {
      ...ANSWER,
      restricted: true,
      subspaces: SNAPSHOT_IDS.map((id) => ({ id, status: "restricted" })),
    };
    const read = probeReadOf(query({ data: refused, dataUpdatedAt: NOW }));
    expect(read.restricted).toBe(true);
    expect(probeUnread(read)).toBeNull();
  });
});

/**
 * A refusal is one sub-space's answer, and a `restricted` row's meaning says
 * so: that sub-space is Qontinui-internal or admin-only, and the others are
 * unaffected. An answer that refused EVERY reading makes that false for each
 * row, and no observer was read in it, so its live rows are UNKNOWN naming
 * the refusal — current or kept after a failed refresh. A refusal of some
 * rows leaves each of them `restricted`, whatever the answer's flag says.
 */
describe("probeReadOf — rows under a refusal", () => {
  const RESTRICTED_SENTENCE =
    "coord does not share the twin's live readings with this workspace";
  const live = <T extends { liveProbed: boolean }>(rows: readonly T[]) =>
    rows.filter((r) => r.liveProbed);
  /** `SNAPSHOT_IDS` answered, the ids in `refused` refused; `flag` the answer's own. */
  const answerRefusing = (
    refused: readonly string[],
    flag: boolean
  ): SubspacesProbeResponse => ({
    subspaces: SNAPSHOT_IDS.map(
      (id): SubspaceProbe => ({
        id,
        status: refused.includes(id) ? "restricted" : "implemented",
      })
    ),
    probed: SNAPSHOT_IDS.length,
    restricted: flag,
  });
  const SOME = SNAPSHOT_IDS.slice(0, 3);

  const CASES: readonly {
    name: string;
    answer: SubspacesProbeResponse;
    /** Every reading refused: the rows are UNKNOWN naming it. */
    all: boolean;
  }[] = [
    {
      name: "every reading refused",
      answer: answerRefusing(SNAPSHOT_IDS, true),
      all: true,
    },
    {
      name: "some readings refused",
      answer: answerRefusing(SOME, false),
      all: false,
    },
    {
      // The backend sets the flag only when every probe answered 403; a
      // flag beside an answered cell is not every reading refused.
      name: "flagged refused, with a reading answered",
      answer: answerRefusing(SNAPSHOT_IDS.slice(1), true),
      all: false,
    },
  ];
  const READS = [
    {
      name: "answered",
      query: (data: SubspacesProbeResponse) =>
        query({ data, dataUpdatedAt: NOW }),
    },
    {
      name: "kept after a failed refresh",
      query: (data: SubspacesProbeResponse) =>
        query({
          data,
          dataUpdatedAt: NOW - 120_000,
          isError: true,
          error: http502,
          errorUpdatedAt: NOW,
        }),
    },
  ] as const;

  for (const c of CASES) {
    for (const r of READS) {
      it(`${c.name} · ${r.name}`, () => {
        const read = probeReadOf(r.query(c.answer));
        expect(read.restricted).toBe(c.all);
        // An answer, not silence, in every case.
        expect(probeUnread(read)).toBeNull();
        const liveRows = live(read.rows);
        expect(liveRows.length).toBe(SNAPSHOT_IDS.length);
        for (const row of liveRows) {
          const own = c.answer.subspaces.find((cell) => cell.id === row.id)!;
          if (c.all) {
            expect(row.cellStatus, row.id).toBe("unknown");
            expect(row.unknownReason, row.id).toBe(RESTRICTED_SENTENCE);
            expect(probeAnswered(row), row.id).toBe(false);
          } else {
            expect(row.cellStatus, row.id).toBe(own.status);
            expect(row.unknownReason, row.id).toBeUndefined();
          }
        }
      });
    }
  }
});

describe("probeDegradedReason — a probe answer that made no probe", () => {
  const cell = (error?: string): SubspaceProbe => ({
    id: "schema",
    status: "error",
    error,
  });

  it("is null for an answer that is not degraded", () => {
    expect(probeDegradedReason(undefined)).toBeNull();
    expect(
      probeDegradedReason({ subspaces: [cell("coord_timeout")] })
    ).toBeNull();
    expect(
      probeDegradedReason({
        degraded: false,
        subspaces: [cell("coord_unavailable")],
      })
    ).toBeNull();
  });

  it("names the cause the backend's token gives", () => {
    expect(
      probeDegradedReason({
        degraded: true,
        subspaces: [cell("coord_unavailable")],
      })
    ).toBe(DEGRADED_REASON);
    expect(
      probeDegradedReason({
        degraded: true,
        subspaces: [cell("catalog_unavailable")],
      })
    ).toBe(
      "coord's live probe could not be made: coord's catalog of live probes could not be read"
    );
  });

  it("names no cause it does not know — an empty answer, or a token it has no words for", () => {
    for (const subspaces of [[], [cell()], [cell("something_new")]]) {
      expect(probeDegradedReason({ degraded: true, subspaces })).toBe(
        "coord's live probe could not be made"
      );
    }
  });
});
