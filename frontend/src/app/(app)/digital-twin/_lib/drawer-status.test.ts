import { describe, expect, it } from "vitest";

import {
  OWN_READ_POINTER,
  drawerStatusAsOf,
  presentDrawerStatus,
  type DrawerStatusRow,
} from "./drawer-status";
import type { ProbeAttempt } from "./probe-read";
import { STATUS_STYLES, presentStatus } from "./status-presentation";
import type { CellStatus, VerdictMetrics } from "./types";

const HTTP_502 = new Error(
  "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
);
const READ_AT = Date.parse("2026-10-23T11:55:00Z");
const FAILED_AT = Date.parse("2026-10-23T12:00:00Z");

/** A probe whose answer is current. */
const CURRENT: ProbeAttempt = {
  failed: false,
  refreshFailed: false,
  error: null,
  degraded: null,
  unanswered: null,
  asOf: READ_AT,
  failedAt: null,
};

/** A probe whose last refresh failed over the answer the rows still show. */
const HELD: ProbeAttempt = {
  ...CURRENT,
  refreshFailed: true,
  error: HTTP_502,
  failedAt: FAILED_AT,
};

const METRICS: VerdictMetrics = {
  coverage: 1,
  credibility: 0.9,
  posterior: null,
  staleness_seconds: 30,
  provenance: "alembic_graph",
  drift_class: "none",
};

function live(
  cellStatus: CellStatus,
  extra: Partial<DrawerStatusRow> = {}
): DrawerStatusRow {
  return { cellStatus, liveProbed: true, ...extra };
}

const POINTER = "The Summary above is this drawer's own read of it.";
/** The pointer in either case: it starts a sentence, or continues one. */
const ANY_POINTER = /the summary above is this drawer's own read of it/i;

describe("presentDrawerStatus — an UNKNOWN row beside the drawer's own read", () => {
  const reason = "coord's live probe could not be read (HTTP 502)";
  const unknownRow = live("unknown", { unknownReason: reason });

  it("stops saying there is no reading once the drawer's own latest read has answered", () => {
    const style = presentDrawerStatus(unknownRow, {
      probe: CURRENT,
      ownReadAnswered: true,
    });
    // The page still has no status for the row: the cell's UNKNOWN stands.
    expect(style.label).toBe("UNKNOWN");
    expect(style.dot).toBe(STATUS_STYLES.unknown.dot);
    expect(style.meaning).toBe(
      `Coord's live probe could not be read (HTTP 502), so this page has no status for this observer; ${OWN_READ_POINTER}`
    );
    expect(style.meaning).not.toMatch(/no current reading/);
  });

  it("keeps the row's own meaning when the drawer's latest read did not answer", () => {
    // No read made, one in flight, one that failed — with or without an
    // earlier answer kept: nothing current has read the observer.
    const style = presentDrawerStatus(unknownRow, {
      probe: CURRENT,
      ownReadAnswered: false,
    });
    expect(style).toEqual(presentStatus(unknownRow));
    expect(style.meaning).toMatch(
      /so there is no current reading of this observer/
    );
  });

  it("is never a 'last answer': a failed refresh over no reading leaves no reading", () => {
    const style = presentDrawerStatus(unknownRow, {
      probe: HELD,
      ownReadAnswered: false,
    });
    expect(style).toEqual(presentStatus(unknownRow));
    expect(style.label).not.toMatch(/Last answer/);
  });
});

describe("presentDrawerStatus — what the probe answered, named as the probe's", () => {
  const FINDINGS: [CellStatus, Partial<DrawerStatusRow>, RegExp][] = [
    [
      "implemented",
      {},
      /^Coord's live probe found this observer answering with full coverage/,
    ],
    [
      "partial",
      { metrics: { ...METRICS, coverage: 0.6 } },
      /^Coord's live probe found this observer answering, but with some dimensions unconfigured \(coverage below 100%\)\.$/,
    ],
    ["blind", {}, /^Coord's live probe found this observer built but disabled/],
    ["served", {}, /^Coord's live probe was answered with coord's own report/],
    [
      "restricted",
      {},
      /^Coord's live probe was refused this sub-space, which is Qontinui-internal/,
    ],
    [
      "error",
      { error: "coord_timeout" },
      /^Coord's live probe could not read this observer \(the read timed out\)/,
    ],
  ];

  for (const [status, extra, finding] of FINDINGS) {
    it(`words a current ${status} answer as the probe's finding, on its own label and dot`, () => {
      const style = presentDrawerStatus(live(status, extra), {
        probe: CURRENT,
        ownReadAnswered: false,
      });
      expect(style.label).toBe(STATUS_STYLES[status].label);
      expect(style.dot).toBe(STATUS_STYLES[status].dot);
      expect(style.meaning).toMatch(finding);
      expect(style.meaning).not.toMatch(/latest read failed|last answer/);
      expect(style.meaning).not.toMatch(ANY_POINTER);
    });
  }

  it("claims no coverage below 100% for a partial answer that carried no coverage to grade", () => {
    // The backend classes an answer with no coverage field as partial.
    for (const metrics of [undefined, { ...METRICS, coverage: null }]) {
      const style = presentDrawerStatus(live("partial", { metrics }), {
        probe: CURRENT,
        ownReadAnswered: false,
      });
      expect(style.meaning).toBe(
        "Coord's live probe found this observer answering, with no coverage in its answer to grade."
      );
    }
  });

  it("never points at a report the drawer may not show", () => {
    for (const probe of [CURRENT, HELD]) {
      for (const ownReadAnswered of [false, true]) {
        const style = presentDrawerStatus(live("served"), {
          probe,
          ownReadAnswered,
        });
        expect(style.meaning).not.toMatch(/open the drawer|report below/i);
      }
    }
    expect(STATUS_STYLES.served.meaning).not.toMatch(/open the drawer/i);
  });

  it("points an error or a refusal at the drawer's own reading when its latest read answered", () => {
    for (const row of [
      live("error", { error: "coord_tool_failed" }),
      live("error"),
      live("restricted"),
    ]) {
      const style = presentDrawerStatus(row, {
        probe: CURRENT,
        ownReadAnswered: true,
      });
      expect(style.meaning.endsWith(` ${POINTER}`), row.cellStatus).toBe(true);
    }
  });

  it("adds no pointer to an answer that is itself a reading", () => {
    for (const status of [
      "implemented",
      "partial",
      "blind",
      "served",
    ] as const) {
      const style = presentDrawerStatus(live(status), {
        probe: CURRENT,
        ownReadAnswered: true,
      });
      expect(style.meaning, status).not.toMatch(ANY_POINTER);
    }
  });

  it("names the cause of an error token in words, and claims no cause it was not given", () => {
    const say = (error?: string) =>
      presentDrawerStatus(live("error", { error }), {
        probe: CURRENT,
        ownReadAnswered: false,
      }).meaning;
    expect(say("coord_unreachable")).toContain("(coord could not be reached)");
    expect(say("coord_tool_failed")).toContain(
      "(coord's observer failed to answer)"
    );
    expect(say("malformed_verdict")).toContain(
      "(coord's answer was malformed)"
    );
    // A token this page does not know: no cause, and no token.
    expect(say("http_418")).toBe(
      "Coord's live probe could not read this observer — an honest error, never a fabricated ok."
    );
    // No token: a 404 door or no cell for the row — never "was probed".
    expect(say()).toMatch(/^Coord's live probe returned no reading/);
    expect(say()).toContain(
      "did not answer, or the probe's answer had no result"
    );
    expect(say()).not.toMatch(/was probed|could not read/);
  });
});

describe("presentDrawerStatus — the last answer, after the probe's refresh failed", () => {
  it("names it the last answer, on the ignorance floor, leading with the failure", () => {
    for (const status of [
      "implemented",
      "partial",
      "blind",
      "served",
      "restricted",
      "error",
    ] as const) {
      const style = presentDrawerStatus(live(status), {
        probe: HELD,
        ownReadAnswered: false,
      });
      expect(style.label, status).toBe(
        `Last answer: ${STATUS_STYLES[status].label}`
      );
      // The dot says what is true now, and the last answer is not now.
      expect(style.dot, status).toBe(STATUS_STYLES.unknown.dot);
      expect(style.meaning, status).toMatch(
        /^Coord's live probe's latest read failed \(HTTP 502\), so this is its last answer, not a current status: it (found|was|could not|returned)/
      );
    }
  });

  it("keeps the pointer for an error or a refusal beside a reading of the drawer's own", () => {
    const style = presentDrawerStatus(live("restricted"), {
      probe: HELD,
      ownReadAnswered: true,
    });
    expect(style.label).toBe("Last answer: Restricted");
    expect(style.meaning.endsWith(` ${POINTER}`)).toBe(true);
  });
});

describe("presentDrawerStatus — rows with nothing read", () => {
  it("reads a row the page does not probe, and a probe in flight, as their cells do", () => {
    const rows: DrawerStatusRow[] = [
      { cellStatus: "interactive", liveProbed: false, ask_via: "delivery-tab" },
      { cellStatus: "planned", liveProbed: false },
      { cellStatus: "not-served", liveProbed: false },
      live("probing"),
    ];
    for (const row of rows) {
      for (const probe of [CURRENT, HELD]) {
        for (const ownReadAnswered of [false, true]) {
          expect(
            presentDrawerStatus(row, { probe, ownReadAnswered }),
            row.cellStatus
          ).toEqual(presentStatus(row));
        }
      }
    }
  });
});

describe("drawerStatusAsOf — when the probe read what the Status says", () => {
  it("dates an answer, current or held, by when it was read", () => {
    expect(drawerStatusAsOf(live("implemented"), CURRENT)).toBe(READ_AT);
    expect(drawerStatusAsOf(live("error"), HELD)).toBe(READ_AT);
  });

  it("dates an UNKNOWN by the attempt that left it so, and an unattempted one by nothing", () => {
    const failed: ProbeAttempt = {
      ...CURRENT,
      failed: true,
      error: HTTP_502,
      asOf: null,
      failedAt: FAILED_AT,
    };
    expect(drawerStatusAsOf(live("unknown"), failed)).toBe(FAILED_AT);
    const degraded: ProbeAttempt = {
      ...CURRENT,
      degraded: "coord's live probe could not be made",
    };
    expect(drawerStatusAsOf(live("unknown"), degraded)).toBe(READ_AT);
    const unanswered: ProbeAttempt = {
      ...CURRENT,
      asOf: null,
      unanswered:
        "coord's live probe has not answered: this browser is offline",
    };
    expect(drawerStatusAsOf(live("unknown"), unanswered)).toBeNull();
  });

  it("dates nothing that has no answer to date", () => {
    expect(drawerStatusAsOf(live("probing"), CURRENT)).toBeUndefined();
    expect(
      drawerStatusAsOf({ cellStatus: "planned", liveProbed: false }, CURRENT)
    ).toBeUndefined();
  });
});
