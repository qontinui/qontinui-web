import { describe, expect, it } from "vitest";

import {
  DRAWER_READ_SOURCE,
  LIVE_ENVELOPE_HEADING,
  RETAINED_ENVELOPE_HEADING,
  RETAINED_LEAD,
  drawerRawReading,
  drawerSummary,
  ownReadAnswered,
  ownReadOf,
  readingOf,
  type OwnRead,
  type OwnReadQuery,
} from "./drawer-reading";
import { manifest } from "./resolve";
import { FIDELITY_SOURCE } from "./twin-aspects";
import type {
  DoorShape,
  RawVerdictResponse,
  ResolvedSubspace,
  VerdictMetrics,
} from "./types";

const READ_AT = Date.parse("2026-10-23T11:57:00Z");
const PROBE_AT = Date.parse("2026-10-23T11:55:00Z");
const HTTP_502 = new Error(
  "GET /api/v1/digital-twin/subspace/schema/raw failed: 502 - upstream"
);

const BODY: RawVerdictResponse = {
  subspace: "schema",
  tool: "coord_query_migration_state",
  verdict: {
    coverage: 1,
    credibility: 0.95,
    staleness_seconds: 30,
    provenance: "alembic_graph",
    drift_class: "none",
  },
};

function query(fields: Partial<OwnReadQuery>): OwnReadQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    ...fields,
  };
}

describe("ownReadOf — the drawer's read, by what its latest attempt did", () => {
  const CASES: [string, OwnReadQuery, OwnRead["kind"]][] = [
    ["nothing held, nothing failed, nothing in flight", query({}), "unmade"],
    ["no answer, one in flight", query({ isLoading: true }), "in-flight"],
    [
      "an answer (a refetch may be on its way)",
      query({ data: BODY, dataUpdatedAt: READ_AT }),
      "answered",
    ],
    [
      "an earlier answer kept by react-query after the latest read FAILED",
      query({
        data: BODY,
        dataUpdatedAt: READ_AT,
        isError: true,
        error: HTTP_502,
      }),
      "retained",
    ],
    [
      "a failed read with nothing kept",
      query({ isError: true, error: HTTP_502 }),
      "failed",
    ],
  ];

  for (const [name, q, kind] of CASES) {
    it(`reads ${name} as ${kind}`, () => {
      expect(ownReadOf(true, q, true, "verdict_wrapper").kind).toBe(kind);
    });
  }

  it("counts only an answer the latest read made as answered — never the data react-query keeps", () => {
    const answered = ownReadOf(
      true,
      query({ data: BODY }),
      true,
      "verdict_wrapper"
    );
    const retained = ownReadOf(
      true,
      query({ data: BODY, isError: true, error: HTTP_502 }),
      true,
      "verdict_wrapper"
    );
    expect(ownReadAnswered(answered)).toBe(true);
    expect(ownReadAnswered(retained)).toBe(false);
    // An answer that carried no reading is no reading either.
    const empty = ownReadOf(
      true,
      query({ data: { subspace: "schema", tool: "t" } as RawVerdictResponse }),
      true,
      "verdict_wrapper"
    );
    expect(empty.kind).toBe("answered");
    expect(ownReadAnswered(empty)).toBe(false);
  });

  it("dates an answer by when it was read, and an undated one by nothing", () => {
    const own = ownReadOf(
      true,
      query({ data: BODY, dataUpdatedAt: READ_AT }),
      true,
      "verdict_wrapper"
    );
    expect(own).toMatchObject({ kind: "answered", readAt: READ_AT });
    expect(
      ownReadOf(true, query({ data: BODY }), true, "verdict_wrapper")
    ).toMatchObject({
      readAt: null,
    });
  });

  it("names the browser offline only when it is, and has no read where the row has none", () => {
    expect(ownReadOf(true, query({}), false, "verdict_wrapper")).toEqual({
      kind: "unmade",
      online: false,
    });
    expect(
      ownReadOf(false, query({ data: BODY }), true, "verdict_wrapper")
    ).toEqual({
      kind: "none",
    });
  });
});

function row(
  id: string,
  doorShape: DoorShape,
  extra: Partial<ResolvedSubspace> = {}
): ResolvedSubspace {
  const entry = manifest.subspaces.find((s) => s.id === id);
  if (!entry) throw new Error(`no manifest row ${id}`);
  return {
    ...entry,
    liveProbed: true,
    doorShape,
    cellStatus: "implemented",
    ...extra,
  };
}

const METRICS: VerdictMetrics = {
  coverage: 0.6,
  credibility: 0.9,
  posterior: null,
  staleness_seconds: 45,
  provenance: "outbound_budget_observations",
  drift_class: "none",
};

const PROBE = { refreshFailed: false, error: null, asOf: PROBE_AT };
const PROBE_HELD = {
  refreshFailed: true,
  error: new Error("GET /api/v1/digital-twin/subspaces failed: 502 - x"),
  asOf: PROBE_AT,
};

describe("drawerSummary — a row the drawer reads itself", () => {
  const schema = row("schema", "verdict_wrapper");

  it("shows a current answer as Live, dated by its read, its staleness as of then", () => {
    const own = ownReadOf(
      true,
      query({ data: BODY, dataUpdatedAt: READ_AT }),
      true,
      "verdict_wrapper"
    );
    const summary = drawerSummary({
      row: schema,
      probe: PROBE,
      own,
      presenting: false,
    });
    expect(summary?.lines).toEqual([]);
    expect(summary?.reading).toMatchObject({
      retained: false,
      source: DRAWER_READ_SOURCE,
      asOf: READ_AT,
    });
    expect(summary?.reading?.prose).toContain(
      "its data was 30s stale when read, from alembic_graph."
    );
    expect(summary?.reading?.prose).not.toMatch(/data is/);
    expect(summary?.reading?.envelope?.heading).toBe(LIVE_ENVELOPE_HEADING);
    expect(summary?.reading?.envelope?.facts).toContainEqual({
      label: "Freshness when read",
      value: "30s stale",
    });
  });

  it("leads a kept answer with the failure, introduces it as the last read, and never heads it Live", () => {
    const own = ownReadOf(
      true,
      query({
        data: BODY,
        dataUpdatedAt: READ_AT,
        isError: true,
        error: HTTP_502,
      }),
      true,
      "verdict_wrapper"
    );
    for (const presenting of [false, true]) {
      const summary = drawerSummary({
        row: schema,
        probe: PROBE,
        own,
        presenting,
      });
      expect(summary?.lines.map((l) => l.kind)).toEqual([
        "read-error",
        "read-retained",
      ]);
      expect(summary?.lines[1]?.text).toBe(RETAINED_LEAD);
      expect(summary?.reading).toMatchObject({
        retained: true,
        asOf: READ_AT,
      });
      expect(summary?.reading?.envelope?.heading).toBe(
        RETAINED_ENVELOPE_HEADING
      );
    }
    // The upstream text is the operator's alone.
    expect(
      drawerSummary({ row: schema, probe: PROBE, own, presenting: true })
        ?.lines[0]?.text
    ).toBe("Could not read the live verdict (HTTP 502).");
  });

  it("says a report door's failure is its report's, and points at the raw report in operator mode only", () => {
    const worktree = row("worktree", "report", { cellStatus: "served" });
    const report: RawVerdictResponse = {
      subspace: "worktree",
      tool: "coord_list_worktrees",
      verdict: { worktrees: 3 },
    };
    const failed = ownReadOf(
      true,
      query({ isError: true, error: HTTP_502 }),
      true,
      "report"
    );
    expect(
      drawerSummary({
        row: worktree,
        probe: PROBE,
        own: failed,
        presenting: true,
      })?.lines[0]?.text
    ).toBe("Could not read the live report (HTTP 502).");
    const answered = ownReadOf(true, query({ data: report }), true, "report");
    const prose = (presenting: boolean) =>
      drawerSummary({ row: worktree, probe: PROBE, own: answered, presenting })
        ?.reading?.prose;
    expect(prose(false)).toContain("The raw data below is the report.");
    expect(prose(true)).not.toMatch(/raw data below/);
    expect(
      drawerSummary({
        row: worktree,
        probe: PROBE,
        own: answered,
        presenting: false,
      })?.reading?.envelope
    ).toBeNull();
  });

  it("says an answer that carried no verdict did, and shows no reading", () => {
    const own = ownReadOf(
      true,
      query({ data: { subspace: "schema", tool: "t" } as RawVerdictResponse }),
      true,
      "verdict_wrapper"
    );
    const summary = drawerSummary({
      row: schema,
      probe: PROBE,
      own,
      presenting: false,
    });
    expect(summary).toEqual({
      lines: [
        {
          kind: "read-empty",
          text: "This drawer's own read of the observer answered with no verdict.",
        },
      ],
      reading: null,
    });
  });
});

describe("drawerSummary — an envelope door, read by the probe", () => {
  it("shows the probe's current answer as Live, dated by the probe", () => {
    const outbound = row("outbound", "envelope", { metrics: METRICS });
    const summary = drawerSummary({
      row: outbound,
      probe: PROBE,
      own: { kind: "none" },
      presenting: false,
    });
    expect(summary?.lines).toEqual([]);
    expect(summary?.reading).toMatchObject({
      retained: false,
      source: FIDELITY_SOURCE.probe,
      asOf: PROBE_AT,
    });
    expect(summary?.reading?.envelope?.heading).toBe(LIVE_ENVELOPE_HEADING);
  });

  it("names a held answer the probe's last, after its failure, never Live", () => {
    const outbound = row("outbound", "envelope", { metrics: METRICS });
    const summary = drawerSummary({
      row: outbound,
      probe: PROBE_HELD,
      own: { kind: "none" },
      presenting: true,
    });
    expect(summary?.lines.map((l) => l.text)).toEqual([
      "Coord's live probe's latest read failed (HTTP 502).",
      RETAINED_LEAD,
    ]);
    expect(summary?.reading?.envelope?.heading).toBe(RETAINED_ENVELOPE_HEADING);
    expect(summary?.reading?.asOf).toBe(PROBE_AT);
  });

  it("says when the answer carried no envelope, current or last", () => {
    const refused = row("outbound", "envelope", { cellStatus: "restricted" });
    const say = (probe: typeof PROBE) =>
      drawerSummary({
        row: refused,
        probe,
        own: { kind: "none" },
        presenting: false,
      })?.lines.map((l) => l.text);
    expect(say(PROBE)).toEqual(["The probe returned no credibility envelope."]);
    expect(say(PROBE_HELD)).toEqual([
      "Coord's live probe's latest read failed (HTTP 502).",
      "Its last answer carried no credibility envelope.",
    ]);
  });

  it("has no Summary with no probe answer to describe", () => {
    for (const cellStatus of ["unknown", "probing"] as const) {
      expect(
        drawerSummary({
          row: row("outbound", "envelope", { cellStatus }),
          probe: PROBE_HELD,
          own: { kind: "none" },
          presenting: false,
        }),
        cellStatus
      ).toBeNull();
    }
  });
});

describe("readingOf — a verdict or a report, by the door, else by the body", () => {
  const REPORT: RawVerdictResponse = {
    subspace: "worktree",
    tool: "coord_list_worktrees",
    verdict: { worktrees: 3 },
  };

  it("takes a declared door's word for what it answers with", () => {
    expect(readingOf(BODY, "verdict_wrapper")?.kind).toBe("verdict");
    expect(readingOf(REPORT, "report")?.kind).toBe("report");
    // A verdict door's answer that is no verdict carries no reading.
    expect(readingOf(REPORT, "verdict_wrapper")).toBeNull();
  });

  it("reads the body's own shape when the door's is unknown, so a report is never summarized as a verdict", () => {
    for (const shape of [null, undefined]) {
      expect(readingOf(BODY, shape)?.kind).toBe("verdict");
      expect(readingOf(REPORT, shape)?.kind).toBe("report");
    }
  });

  it("finds no reading in a body that carries none", () => {
    expect(
      readingOf(
        { subspace: "schema", tool: "t" } as RawVerdictResponse,
        "verdict_wrapper"
      )
    ).toBeNull();
    expect(
      readingOf(
        {
          subspace: "schema",
          tool: "t",
          verdict: null,
        } as unknown as RawVerdictResponse,
        null
      )
    ).toBeNull();
  });
});

describe("drawerRawReading — the JSON the operator may open", () => {
  it("is the answer the drawer read, and says when it is the last one kept", () => {
    expect(
      drawerRawReading(
        ownReadOf(true, query({ data: BODY }), true, "verdict_wrapper")
      )
    ).toEqual({
      json: BODY.verdict,
      kind: "verdict",
      tool: "coord_query_migration_state",
      retained: false,
    });
    expect(
      drawerRawReading(
        ownReadOf(
          true,
          query({ data: BODY, isError: true, error: HTTP_502 }),
          true,
          "verdict_wrapper"
        )
      )
    ).toEqual({
      json: BODY.verdict,
      kind: "verdict",
      tool: "coord_query_migration_state",
      retained: true,
    });
    expect(
      drawerRawReading(
        ownReadOf(true, query({ isLoading: true }), true, "verdict_wrapper")
      )
    ).toBeNull();
  });
});
