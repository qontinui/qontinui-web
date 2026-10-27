/**
 * The Twin map's aspects and their fidelity figures (plan
 * `2026-10-23-console-presentation-spaces` Phase 5). The figures that matter
 * most here are the ones that CANNOT be computed: each must be a labelled
 * UNKNOWN naming why, and never a zero standing in for one.
 */

import { describe, expect, it } from "vitest";
import { isCaptionKey } from "@/components/presentation";
import { manifest, resolveSubspaces } from "./resolve";
import { RunnerRelayError } from "./runner-relay";
import {
  NOT_PROBED_REASON,
  NO_RUNNER_REASON,
  RESTRICTED_REASON,
  SELF_CHECK_INTERNAL_REASON,
  TWIN_ASPECTS,
  appTwinFidelity,
  aspectRows,
  partName,
  plantFidelity,
  probeFedAspects,
  probeFedContent,
  twinAspect,
  type FidelityFigure,
  type FidelityKey,
  type RelayRead,
  type ReportRead,
} from "./twin-aspects";
import {
  probeDegradedReason,
  probeReadOf,
  type ProbeQuery,
  type ProbeRead,
} from "./probe-read";
import {
  MANIFEST_SNAPSHOT_IDS,
  catalogDeclaring as declaring,
  outboundEnvelope,
} from "./test-catalog";
import type {
  RawVerdictResponse,
  ResolvedSubspace,
  SubspaceProbe,
  SubspacesProbeResponse,
  TwinCatalogEntry,
  TwinCatalogResponse,
} from "./types";
import type { AppListResponse, SpecGraphResponse } from "./ui-bridge-types";

const NOW = Date.parse("2026-10-23T12:00:00Z");

/** coord's catalog declaring exactly `ids` probeable — so only they are live-probed. */
function catalogDeclaring(ids: readonly string[]): TwinCatalogResponse {
  const entries = ids.map(
    (id) =>
      ({
        id,
        subspace: id,
        symbol: id,
        twin: "environment",
        stages: ["verify"],
        description: id,
        query_tool: `coord_query_${id}`,
        kind: "snapshot",
        declared_status: "live",
        params: [],
        snapshot: true,
        access: "tenant",
        door: `/coord/twin/${id}/verdict`,
        door_shape: "verdict_wrapper",
        observed: null,
      }) satisfies TwinCatalogEntry
  );
  return { entries, total: entries.length };
}

/** The resolved rows when coord declares, and the probe answers, exactly `probes`. */
function rowsFor(probes: SubspaceProbe[]): ResolvedSubspace[] {
  return resolveSubspaces(
    probes,
    false,
    catalogDeclaring(probes.map((p) => p.id))
  );
}

function probe(
  id: string,
  status: SubspaceProbe["status"],
  coverage: number | null,
  staleness: number | null = null
): SubspaceProbe {
  return {
    id,
    status,
    metrics: {
      coverage,
      credibility: 0.9,
      posterior: 0.9,
      staleness_seconds: staleness,
      provenance: "test",
      drift_class: "none",
    },
  };
}

/** Environment probes: two answering, one blind. */
const ENV_PROBES: SubspaceProbe[] = [
  probe("schema", "implemented", 1, 30),
  probe("release", "partial", 0.6, 600),
  probe("deps", "blind", 0),
];

/** A probe answer over rows coord's catalog declares (`rowsFor`). */
function probeRead(over: Partial<ProbeRead> = {}): ProbeRead {
  return {
    rows: rowsFor(ENV_PROBES),
    failed: false,
    refreshFailed: false,
    error: null,
    degraded: null,
    unanswered: null,
    restricted: false,
    declared: true,
    asOf: NOW - 5_000,
    failedAt: null,
    ...over,
  };
}

function reportRead(over: Partial<ReportRead> = {}): ReportRead {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    ...over,
  };
}

function reportOf(verdict: Record<string, unknown>): RawVerdictResponse {
  return {
    subspace: "twin_fidelity",
    tool: "coord_query_twin_fidelity",
    verdict,
  };
}

function figures(
  aspectId: "environment" | "process" | "intent",
  probeState: ProbeRead,
  report: ReportRead = reportRead()
): Record<FidelityKey, FidelityFigure> {
  const rows = aspectRows(twinAspect(aspectId), probeState.rows);
  const out = {} as Record<FidelityKey, FidelityFigure>;
  for (const f of plantFidelity(rows, probeState, report, NOW)) out[f.key] = f;
  return out;
}

/** No figure may render a count of zero where it does not know. */
function expectNoZeroFor(f: FidelityFigure): void {
  expect(f.state).toBe("unknown");
  if (f.state !== "unknown") return;
  expect(f.reason.trim()).not.toBe("");
  expect(JSON.stringify(f)).not.toMatch(/"value"/);
}

describe("the aspects", () => {
  it("partition the manifest into the three coupled twins", () => {
    const plants = TWIN_ASPECTS.filter((a) => a.id !== "ui-bridge");
    for (const s of manifest.subspaces) {
      const owners = plants.filter((a) => a.includes(s));
      expect(
        owners.map((a) => a.id),
        s.id
      ).toEqual([s.twin]);
    }
  });

  it("cut the UI Bridge app twin across them, from the UI Bridge layer", () => {
    const rows = aspectRows(twinAspect("ui-bridge"), manifest.subspaces);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.layer, r.id).toBe("ui-bridge");
  });

  it("caption every aspect from the registry", () => {
    for (const aspect of TWIN_ASPECTS) {
      expect(isCaptionKey(aspect.captionKey), aspect.id).toBe(true);
    }
  });

  it("name parts in words", () => {
    expect(partName("merge_train")).toBe("merge train");
    expect(() => twinAspect("nope" as never)).toThrow();
  });
});

describe("plantFidelity — from the live probe", () => {
  it("counts live probes answering, averages their coverage and names the oldest reading", () => {
    const f = figures("environment", probeRead());
    expect(f.observed).toMatchObject({ state: "known", value: "2 of 3" });
    expect(f.observed.state === "known" && f.observed.detail).toMatch(
      /3 of 29 parts probed live/
    );
    expect(f.coverage).toMatchObject({ state: "known", value: "80%" });
    expect(f.staleness).toMatchObject({
      state: "known",
      value: "10m stale when read",
    });
    for (const key of ["observed", "coverage", "staleness"] as const) {
      expect(f[key].source, key).toBe("coord's live twin probe");
      expect(f[key].state === "known" && f[key].asOf, key).toBe(NOW - 5_000);
    }
  });

  it("says read live when no answering probe reports a staleness", () => {
    const rows = rowsFor([probe("schema", "implemented", 1, null)]);
    const f = figures("environment", probeRead({ rows }));
    expect(f.staleness).toMatchObject({ state: "known", value: "read live" });
  });

  /**
   * coord's admin outbound door, from a backend that served no age for it:
   * one that predates carrying its worst bucket's.
   */
  const OUTBOUND: SubspaceProbe = {
    id: "outbound",
    status: "implemented",
    door_shape: "envelope",
    metrics: outboundEnvelope({ drift: "nominal", ageSeconds: null }),
  };

  /** The same door with its worst bucket's age served: 15 minutes when read. */
  const OUTBOUND_DATED: SubspaceProbe = {
    ...OUTBOUND,
    metrics: outboundEnvelope({ drift: "nominal", ageSeconds: 900 }),
  };

  it("takes the envelope door's worst-bucket age into the oldest, and says whose it is", () => {
    const rows = rowsFor([
      probe("workers", "implemented", 1, 600),
      probe("webhook_pulse", "implemented", 1, null),
      OUTBOUND_DATED,
    ]);
    const f = figures("process", probeRead({ rows }));
    expect(f.staleness).toEqual({
      key: "staleness",
      state: "known",
      value: "15m stale when read",
      detail:
        "the oldest of 3 answering readings; outbound's reading is dated by the bucket its drift class comes from",
      source: "coord's live twin probe",
      asOf: NOW - 5_000,
    });
  });

  it("names each reading one bucket dates, in the plural too", () => {
    const rows = rowsFor([
      probe("workers", "implemented", 1, 600),
      { ...OUTBOUND_DATED, id: "webhook_pulse" },
      OUTBOUND_DATED,
    ]);
    const f = figures("process", probeRead({ rows }));
    expect(f.staleness).toMatchObject({
      state: "known",
      value: "15m stale when read",
      detail:
        "the oldest of 3 answering readings; the readings of webhook pulse and outbound are each dated by the bucket its drift class comes from",
    });
  });

  it("names no bucket when no envelope door's age is among the readings", () => {
    const rows = rowsFor([
      probe("workers", "implemented", 1, 600),
      probe("webhook_pulse", "implemented", 1, 30),
    ]);
    const f = figures("process", probeRead({ rows }));
    expect(f.staleness).toMatchObject({
      state: "known",
      value: "10m stale when read",
      detail: "the oldest of 2 answering readings",
    });
  });

  it("says the oldest reading is UNKNOWN when the envelope door's came with no age served, never read live", () => {
    const rows = rowsFor([
      probe("workers", "implemented", 1, null),
      probe("webhook_pulse", "implemented", 1, null),
      OUTBOUND,
    ]);
    const f = figures("process", probeRead({ rows }));
    expect(f.staleness).toEqual({
      key: "staleness",
      state: "unknown",
      reason:
        "no age was served for outbound's reading; the other 2 answering probes read live",
      source: "coord's live twin probe",
      asOf: NOW - 5_000,
    });
  });

  it("keeps what the other readings say beside the reading of unknown age", () => {
    const reason = (probes: SubspaceProbe[]) => {
      const f = figures("process", probeRead({ rows: rowsFor(probes) }));
      expect(f.staleness.state).toBe("unknown");
      return f.staleness.state === "unknown" ? f.staleness.reason : null;
    };
    expect(
      reason([
        probe("workers", "implemented", 1, 600),
        probe("webhook_pulse", "partial", 0.5, 30),
        OUTBOUND,
      ])
    ).toBe(
      "no age was served for outbound's reading; the oldest of the other 2 answering readings was 10m stale when read"
    );
    expect(reason([probe("workers", "implemented", 1, 600), OUTBOUND])).toBe(
      "no age was served for outbound's reading; the other answering reading was 10m stale when read"
    );
    expect(reason([probe("workers", "implemented", 1, null), OUTBOUND])).toBe(
      "no age was served for outbound's reading; the other answering probe read live"
    );
    expect(reason([OUTBOUND])).toBe("no age was served for outbound's reading");
  });

  it("renders a failed probe as UNKNOWN with its reason — never as 0 answering", () => {
    const failed = probeRead({
      rows: resolveSubspaces(undefined, false),
      failed: true,
      error: new Error(
        "GET /api/v1/digital-twin/subspaces failed: 502 - bad gateway"
      ),
      failedAt: NOW - 1_000,
    });
    const f = figures("environment", failed);
    for (const key of ["observed", "coverage", "staleness"] as const) {
      expectNoZeroFor(f[key]);
      expect(f[key].state === "unknown" && f[key].reason, key).toBe(
        "coord's live probe could not be read (HTTP 502)"
      );
      expect(f[key].state === "unknown" && f[key].asOf, key).toBe(NOW - 1_000);
    }
  });

  it("renders a degraded answer as UNKNOWN with its cause — its stand-in cells are not 0 answering", () => {
    // The backend's degraded matrix: one `error` cell per id coord last
    // declared, no probe made.
    const cells: SubspaceProbe[] = ENV_PROBES.map((p) => ({
      id: p.id,
      status: "error",
      error: "coord_unavailable",
    }));
    const degraded = probeRead({
      rows: rowsFor(cells),
      degraded: probeDegradedReason({ degraded: true, subspaces: cells }),
    });
    // Read as an answer, these cells WOULD be "0 of 3" — the zero this guards.
    expect(
      figures("environment", probeRead({ rows: rowsFor(cells) })).observed
    ).toMatchObject({ state: "known", value: "0 of 3" });
    const f = figures("environment", degraded);
    for (const key of ["observed", "coverage", "staleness"] as const) {
      expectNoZeroFor(f[key]);
      expect(f[key].state === "unknown" && f[key].reason, key).toBe(
        "coord's live probe could not be made: coord could not be reached"
      );
      // When the degraded answer came back — the attempt that failed.
      expect(f[key].state === "unknown" && f[key].asOf, key).toBe(NOW - 5_000);
    }
  });

  it("renders a read react-query holds offline as UNKNOWN, named, with no attempt to date it", () => {
    const held = probeReadOf(
      {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        online: false,
      },
      undefined
    );
    const f = figures("environment", held);
    for (const key of ["observed", "coverage", "staleness"] as const) {
      expectNoZeroFor(f[key]);
      expect(f[key].state === "unknown" && f[key].reason, key).toBe(
        "coord's live probe has not answered: this browser is offline"
      );
      expect(f[key].state === "unknown" && f[key].asOf, key).toBeNull();
    }
  });

  it("renders every probe refused as the restriction, named", () => {
    const f = figures("environment", probeRead({ restricted: true }));
    expectNoZeroFor(f.observed);
    expect(f.observed.state === "unknown" && f.observed.reason).toBe(
      RESTRICTED_REASON
    );
  });

  it("is still reading while a probe is in flight", () => {
    const f = figures(
      "environment",
      probeRead({ rows: resolveSubspaces(undefined, true) })
    );
    expect(f.observed.state).toBe("loading");
    expect(f.coverage.state).toBe("loading");
  });

  it("is UNKNOWN for a twin nothing probes live — not zero of its parts", () => {
    const f = figures("intent", probeRead());
    expectNoZeroFor(f.observed);
    expect(f.observed.state === "unknown" && f.observed.reason).toMatch(
      /nothing in this twin is probed live/
    );
  });

  it("is UNKNOWN when probes answer but none is graded", () => {
    const rows = rowsFor([
      { id: "worktree", status: "served", door_shape: "report" },
    ]);
    const f = figures("process", probeRead({ rows }));
    expect(f.observed.state === "unknown" && f.observed.reason).toMatch(
      /reports rather than verdicts/
    );
  });
});

/** An answer whose cells are `ids`, each `status`; every one refused is `restricted`. */
function answerOf(
  ids: readonly string[],
  status: "implemented" | "restricted" = "implemented"
): SubspacesProbeResponse {
  return {
    subspaces: ids.map((id) =>
      status === "restricted" ? { id, status } : probe(id, status, 1)
    ),
    probed: ids.length,
    restricted: status === "restricted",
  };
}

/** The probe query `probeReadOf` reads, answered at `NOW - 5s` unless told otherwise. */
function probeQuery(over: Partial<ProbeQuery> = {}): ProbeQuery {
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

const ANSWERED_AT = NOW - 5_000;
const REFRESH_FAILED_AT = NOW - 1_000;
const HTTP_502 = new Error(
  "GET /api/v1/digital-twin/subspaces failed: 502 - bad gateway"
);
/** The query holding `data`, answered; or kept after its refresh failed. */
const answeredQuery = (data: SubspacesProbeResponse) =>
  probeQuery({ data, dataUpdatedAt: ANSWERED_AT });
const heldQuery = (data: SubspacesProbeResponse) =>
  probeQuery({
    data,
    dataUpdatedAt: ANSWERED_AT,
    isError: true,
    error: HTTP_502,
    errorUpdatedAt: REFRESH_FAILED_AT,
  });

/**
 * A twin with no live-probed part, in every state of the probe, under coord's
 * catalog and with it unread (the manifest's `snapshot` rows standing in).
 * The intent twin has none either way here: the manifest marks none of its
 * rows `snapshot`, and no answer below has a cell for one. Its three probe
 * figures say nothing in it is probed live in every state — before a refusal
 * of every reading, and before the probe's silence, neither of which is why
 * they are UNKNOWN — dated by the probe's last answer, if it has one. The
 * process twin, which has live-probed parts, says what the probe holds, so
 * the order is visible against it.
 */
describe("plantFidelity — a twin with no live-probed part, in every state of the probe", () => {
  const PROCESS_IDS = MANIFEST_SNAPSHOT_IDS.filter(
    (id) => manifest.subspaces.find((s) => s.id === id)?.twin === "process"
  );
  const ANSWER = answerOf(MANIFEST_SNAPSHOT_IDS);
  const REFUSED = answerOf(MANIFEST_SNAPSHOT_IDS, "restricted");
  const DEGRADED: SubspacesProbeResponse = {
    degraded: true,
    probed: 0,
    restricted: false,
    subspaces: MANIFEST_SNAPSHOT_IDS.map((id) => ({
      id,
      status: "error",
      error: "coord_unavailable",
    })),
  };
  const DEGRADED_REASON =
    "coord's live probe could not be made: coord could not be reached";

  /** What the process twin's three probe figures say in a state. */
  type ProcessSays =
    | { readonly state: "known" }
    | { readonly state: "loading" }
    | {
        readonly state: "unknown";
        readonly reason: string;
        readonly asOf: number | null;
      };

  const STATES: readonly {
    name: string;
    query: ProbeQuery;
    process: ProcessSays;
  }[] = [
    {
      name: "answered",
      query: answeredQuery(ANSWER),
      process: { state: "known" },
    },
    {
      name: "answered, every reading refused",
      query: answeredQuery(REFUSED),
      process: {
        state: "unknown",
        reason: RESTRICTED_REASON,
        asOf: ANSWERED_AT,
      },
    },
    {
      name: "held after a failed refresh",
      query: heldQuery(ANSWER),
      process: { state: "known" },
    },
    {
      name: "held after a failed refresh, every reading refused",
      query: heldQuery(REFUSED),
      process: {
        state: "unknown",
        reason: RESTRICTED_REASON,
        asOf: ANSWERED_AT,
      },
    },
    {
      name: "failed with nothing held",
      query: probeQuery({
        isError: true,
        error: HTTP_502,
        errorUpdatedAt: REFRESH_FAILED_AT,
      }),
      process: {
        state: "unknown",
        reason: "coord's live probe could not be read (HTTP 502)",
        asOf: REFRESH_FAILED_AT,
      },
    },
    {
      name: "degraded",
      query: answeredQuery(DEGRADED),
      process: {
        state: "unknown",
        reason: DEGRADED_REASON,
        asOf: ANSWERED_AT,
      },
    },
    {
      name: "degraded, held after a failed refresh",
      query: heldQuery(DEGRADED),
      process: {
        state: "unknown",
        reason: DEGRADED_REASON,
        asOf: ANSWERED_AT,
      },
    },
    {
      name: "unanswered, offline",
      query: probeQuery({ online: false }),
      process: {
        state: "unknown",
        reason: "coord's live probe has not answered: this browser is offline",
        asOf: null,
      },
    },
    {
      name: "unanswered, online, none in flight",
      query: probeQuery(),
      process: {
        state: "unknown",
        reason:
          "coord's live probe has not answered, and no read of it is in flight",
        asOf: null,
      },
    },
    {
      name: "in flight",
      query: probeQuery({ isLoading: true }),
      process: { state: "loading" },
    },
  ];

  const CATALOGS: readonly {
    name: string;
    catalog: TwinCatalogResponse | undefined;
  }[] = [
    { name: "coord's catalog", catalog: declaring(MANIFEST_SNAPSHOT_IDS) },
    { name: "no catalog read", catalog: undefined },
  ];

  const probeFigures = (
    id: "process" | "intent",
    read: ProbeRead
  ): FidelityFigure[] =>
    plantFidelity(
      aspectRows(twinAspect(id), read.rows),
      read,
      reportRead(),
      NOW
    ).filter((f) => f.key !== "honesty");

  for (const { name: catalogName, catalog } of CATALOGS) {
    for (const s of STATES) {
      it(`${s.name} · ${catalogName}`, () => {
        const read = probeReadOf(s.query, catalog);
        expect(PROCESS_IDS.length).toBeGreaterThan(0);

        for (const f of probeFigures("intent", read)) {
          expect(f, f.key).toEqual({
            key: f.key,
            state: "unknown",
            reason: NOT_PROBED_REASON,
            source: "coord's live twin probe",
            asOf: read.asOf,
          });
        }

        const process = probeFigures("process", read);
        if (s.process.state === "unknown") {
          for (const f of process) {
            expect(f, f.key).toEqual({
              key: f.key,
              state: "unknown",
              reason: s.process.reason,
              source: "coord's live twin probe",
              asOf: s.process.asOf,
            });
          }
        } else {
          expect(process[0]!.state).toBe(s.process.state);
        }
      });
    }
  }
});

/**
 * The twins whose probe figures the live probe's answer decides — what the
 * Twin map's held-probe notice may call that answer. Under coord's catalog
 * they are the twins with a part it declares; coord declared no intent row
 * on 2026-10-27, so the intent twin's figures said nothing in it is probed
 * live, which the catalog says and no answer does. With the catalog unread,
 * the manifest's `snapshot` rows and the answer's own cells say which parts
 * are live-probed, so the answer decides every twin's figures.
 *
 * Each case is read answered and kept after a failed refresh, through
 * `probeReadOf` as the page reads it.
 */
describe("probeFedAspects — the twins whose figures the probe's answer decides", () => {
  // A catalog from a coord that declares the flag on every entry and sets it
  // on none: nothing is live-probed.
  const NOTHING_PROBEABLE: TwinCatalogResponse = {
    entries: declaring(["schema"]).entries.map((entry) => ({
      ...entry,
      snapshot: false,
    })),
    total: 1,
  };
  const FIGURES = "the Observed, Coverage and Staleness figures of";
  const PARTS = "and the statuses of the live-probed parts below";
  const ALL_THREE = `${FIGURES} the environment twin, the process twin and the intent twin, ${PARTS}`;

  const CASES: readonly {
    name: string;
    catalog: TwinCatalogResponse | undefined;
    answer: SubspacesProbeResponse;
    fed: readonly string[];
    content: string | null;
  }[] = [
    {
      name: "a catalog declaring no intent row",
      catalog: declaring(["schema", "workers"]),
      answer: answerOf(["schema", "workers"]),
      fed: ["environment", "process"],
      content: `${FIGURES} the environment twin and the process twin, ${PARTS}`,
    },
    {
      name: "a catalog declaring an intent row",
      catalog: declaring(["schema", "workers", "metrics"]),
      answer: answerOf(["schema", "workers", "metrics"]),
      fed: ["environment", "process", "intent"],
      content: ALL_THREE,
    },
    {
      name: "a catalog declaring one twin's rows",
      catalog: declaring(["workers"]),
      answer: answerOf(["workers"]),
      fed: ["process"],
      content: `${FIGURES} the process twin, ${PARTS}`,
    },
    {
      // A UI Bridge layer row is the environment twin's: the app twin's own
      // figures are the runner's, so it is never named.
      name: "a catalog declaring a UI Bridge layer row",
      catalog: declaring(["dom"]),
      answer: answerOf(["dom"]),
      fed: ["environment"],
      content: `${FIGURES} the environment twin, ${PARTS}`,
    },
    {
      name: "a catalog declaring nothing probeable",
      catalog: NOTHING_PROBEABLE,
      answer: answerOf(["schema"]),
      fed: [],
      content: null,
    },
    {
      name: "no catalog read, and a probe answer for an intent row",
      catalog: undefined,
      answer: answerOf(["metrics"]),
      fed: ["environment", "process", "intent"],
      content: ALL_THREE,
    },
    {
      // The answer's lack of an intent cell is what leaves the intent twin
      // with no live-probed part: its figures are that answer's too.
      name: "no catalog read, and no probe answer for an intent row",
      catalog: undefined,
      answer: answerOf(["schema", "workers"]),
      fed: ["environment", "process", "intent"],
      content: ALL_THREE,
    },
    {
      // The refusal is the answer the declared twins' figures show; the
      // intent twin's say nothing in it is probed live, which the catalog
      // says, whatever coord refuses.
      name: "every reading refused, under a catalog declaring no intent row",
      catalog: declaring(["schema", "workers"]),
      answer: answerOf(["schema", "workers"], "restricted"),
      fed: ["environment", "process"],
      content: `${FIGURES} the environment twin and the process twin, ${PARTS}`,
    },
    {
      name: "every reading refused, with no catalog read",
      catalog: undefined,
      answer: answerOf(["schema", "workers"], "restricted"),
      fed: ["environment", "process", "intent"],
      content: ALL_THREE,
    },
    {
      name: "every reading refused, under a catalog declaring nothing probeable",
      catalog: NOTHING_PROBEABLE,
      answer: answerOf(["schema"], "restricted"),
      fed: [],
      content: null,
    },
  ];

  const READS = [
    { name: "answered", query: answeredQuery },
    { name: "held after a failed refresh", query: heldQuery },
  ] as const;

  for (const c of CASES) {
    for (const r of READS) {
      it(`names the twins it decides: ${c.name} · ${r.name}`, () => {
        const read = probeReadOf(r.query(c.answer), c.catalog);
        expect(read.declared).toBe(c.catalog !== undefined);
        expect(
          probeFedAspects(read.rows, read.declared).map((aspect) => aspect.id)
        ).toEqual(c.fed);
        expect(probeFedContent(read.rows, read.declared)).toBe(c.content);
      });
    }
  }

  /**
   * The notice and the figures cannot disagree: a twin it leaves out says
   * nothing in it is probed live, and coord's catalog — not the answer — is
   * what says so. Every other twin's figures are that answer's, so it is
   * named.
   */
  it("leaves out exactly the twins coord's catalog says nothing in is probed live", () => {
    for (const c of CASES) {
      for (const r of READS) {
        const read = probeReadOf(r.query(c.answer), c.catalog);
        const fed = new Set(
          probeFedAspects(read.rows, read.declared).map((aspect) => aspect.id)
        );
        for (const id of ["environment", "process", "intent"] as const) {
          const probeFigures = plantFidelity(
            aspectRows(twinAspect(id), read.rows),
            read,
            reportRead(),
            NOW
          ).filter((f) => f.key !== "honesty");
          const notProbed = probeFigures.every(
            (f) => f.state === "unknown" && f.reason === NOT_PROBED_REASON
          );
          expect(fed.has(id), `${c.name} · ${r.name}: ${id}`).toBe(
            !(notProbed && read.declared)
          );
        }
      }
    }
  });
});

describe("plantFidelity — honesty, from coord's twin self-check", () => {
  const withParts = reportRead({
    data: reportOf({
      observed: true,
      computed_at: "2026-10-23T11:50:00Z",
      total: 3,
      honesty_violations: 1,
      subspaces: [
        {
          subspace: "schema",
          observed: true,
          coverage: 1,
          honest: false,
          honesty_evaluated: true,
        },
        {
          subspace: "release",
          observed: true,
          coverage: 1,
          honest: true,
          honesty_evaluated: true,
        },
        {
          subspace: "deps",
          observed: false,
          coverage: 0,
          honest: true,
          honesty_evaluated: false,
        },
        {
          subspace: "memory",
          observed: true,
          coverage: 1,
          honest: true,
          honesty_evaluated: true,
        },
      ],
    }),
  });

  it("counts the violations among the twin's parts the self-check judged", () => {
    const f = figures("environment", probeRead(), withParts);
    expect(f.honesty).toMatchObject({
      state: "known",
      value: "1 violation",
      source: "coord's twin self-check",
      asOf: "2026-10-23T11:50:00Z",
    });
    expect(f.honesty.state === "known" && f.honesty.detail).toBe(
      "over 2 parts the self-check judged; 1 more it could not judge"
    );
  });

  it("states a measured zero as no violations, with what it covers", () => {
    const f = figures("process", probeRead(), withParts);
    expect(f.honesty).toMatchObject({ state: "known", value: "no violations" });
    expect(f.honesty.state === "known" && f.honesty.detail).toBe(
      "over 1 part the self-check judged"
    );
  });

  it("is UNKNOWN, with the reason, for a report this workspace may not read", () => {
    const forbidden = reportRead({
      isError: true,
      error: new Error(
        "GET /api/v1/digital-twin/subspace/twin_fidelity/raw failed: 403 - no"
      ),
      errorUpdatedAt: NOW - 2_000,
    });
    const f = figures("environment", probeRead(), forbidden);
    expectNoZeroFor(f.honesty);
    expect(f.honesty.state === "unknown" && f.honesty.reason).toBe(
      SELF_CHECK_INTERNAL_REASON
    );
    expect(f.honesty.state === "unknown" && f.honesty.asOf).toBe(NOW - 2_000);
  });

  it("is UNKNOWN when coord serves no report, or no per-part breakdown, or nothing of this twin", () => {
    const missing = reportRead({
      isError: true,
      error: new Error("GET /x failed: 404 - none"),
    });
    expect(figures("environment", probeRead(), missing).honesty.state).toBe(
      "unknown"
    );

    const flat = reportRead({
      data: reportOf({ observed: true, total: 3, honesty_violations: 0 }),
    });
    const noParts = figures("environment", probeRead(), flat).honesty;
    expectNoZeroFor(noParts);
    expect(noParts.state === "unknown" && noParts.reason).toMatch(
      /no per-part breakdown/
    );

    const intent = figures("intent", probeRead(), withParts).honesty;
    expectNoZeroFor(intent);
    expect(intent.state === "unknown" && intent.reason).toMatch(
      /does not measure this twin/
    );
  });
});

function relay<T>(over: Partial<RelayRead<T>> = {}): RelayRead<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    ...over,
  };
}

/**
 * The UI Bridge app twin's four figures over EVERY state of the two runner
 * reads behind them — the app registry (Observed) and the model of the
 * runner's own interface (Coverage) — with this browser online and offline,
 * and with no runner connected.
 *
 * Each read is in flight with nothing held; FAILED with nothing held; failed
 * with an earlier answer react-query keeps beside the failure, with an HTTP
 * status and without one (a relay timeout); held by react-query with no
 * answer, no failure and none in flight; or answered — with what it counts,
 * without it, or with no body at all. A read can be in flight, failed or
 * answered whether or not the browser has gone offline since, so every state
 * occurs in both; only the held read's sentence says which.
 *
 * The expectations are written out here, not imported from the module under
 * test. What every cell checks beyond them: a figure is a number only when
 * its own read's LATEST attempt answered with what it counts, so a value kept
 * beside a failure never shows; and neither read decides the other's figure.
 */
describe("appTwinFidelity — every state of the runner's two reads", () => {
  const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const READ_AT = NOW - 600_000;
  const FAILED_AT = NOW - 60_000;
  const DOWN = new RunnerRelayError("runner unreachable", 503);
  const TIMED_OUT = new RunnerRelayError("the relay timed out after 8000ms");

  const TWO_APPS = { ok: true, apps: [{ app_id: "a" }, { app_id: "b" }] };
  /** Three pages, one whose model could not be read: "2 of 3". */
  const THREE_PAGES = {
    ok: true,
    pages: [
      { id: "p1", stateIds: ["s"], transitionIds: [] },
      { id: "p2", stateIds: [], transitionIds: [] },
      { id: "p3", reason: "ir-read-failed", error: "x" },
    ],
  };

  type Expected =
    | { readonly state: "loading" }
    | {
        readonly state: "unknown";
        readonly reason: string;
        readonly asOf: number | null;
      }
    | {
        readonly state: "known";
        readonly value: string;
        readonly detail: string;
        readonly asOf: number | null;
      };

  interface Arm<T> {
    readonly name: string;
    readonly read: RelayRead<T>;
    readonly expect: (online: boolean) => Expected;
  }

  /** The arms both reads share; `what` names the read, `held` its earlier answer. */
  function sharedArms<T>(what: string, held: T): Arm<T>[] {
    const failed = (reason: string): Expected => ({
      state: "unknown",
      reason,
      asOf: FAILED_AT,
    });
    return [
      {
        name: "in flight",
        read: relay<T>({ isLoading: true }),
        expect: () => ({ state: "loading" }),
      },
      {
        name: "failed, nothing held",
        read: relay<T>({
          isError: true,
          error: DOWN,
          errorUpdatedAt: FAILED_AT,
        }),
        expect: () => failed(`${what} could not be read (HTTP 503)`),
      },
      {
        name: "failed, an earlier answer held",
        read: relay<T>({
          data: held,
          dataUpdatedAt: READ_AT,
          isError: true,
          error: DOWN,
          errorUpdatedAt: FAILED_AT,
        }),
        expect: () => failed(`${what} could not be read (HTTP 503)`),
      },
      {
        name: "timed out, an earlier answer held",
        read: relay<T>({
          data: held,
          dataUpdatedAt: READ_AT,
          isError: true,
          error: TIMED_OUT,
          errorUpdatedAt: FAILED_AT,
        }),
        expect: () => failed(`${what} could not be read`),
      },
      {
        name: "held with no answer and none in flight",
        read: relay<T>(),
        expect: (online) => ({
          state: "unknown",
          reason: online
            ? `no read of ${what} has answered, and none is in flight`
            : `no read of ${what} has answered: this browser is offline`,
          asOf: null,
        }),
      },
    ];
  }

  const APPS_ARMS: Arm<AppListResponse>[] = [
    ...sharedArms<AppListResponse>("the runner's app registry", TWO_APPS),
    {
      name: "answered",
      read: relay<AppListResponse>({ data: TWO_APPS, dataUpdatedAt: READ_AT }),
      expect: () => ({
        state: "known",
        value: "2 apps",
        detail: "registered with the runner's UI Bridge",
        asOf: READ_AT,
      }),
    },
    {
      name: "answered without its list",
      read: relay<AppListResponse>({
        data: { ok: true },
        dataUpdatedAt: READ_AT,
      }),
      expect: () => ({
        state: "unknown",
        reason: "the runner answered without listing its apps",
        asOf: READ_AT,
      }),
    },
    {
      name: "answered with no body",
      read: relay<AppListResponse>({
        data: null as unknown as AppListResponse,
        dataUpdatedAt: READ_AT,
      }),
      expect: () => ({
        state: "unknown",
        reason: "the runner answered without listing its apps",
        asOf: READ_AT,
      }),
    },
  ];

  const GRAPH_ARMS: Arm<SpecGraphResponse>[] = [
    ...sharedArms<SpecGraphResponse>(
      "the runner's model of its own interface",
      THREE_PAGES
    ),
    {
      name: "answered",
      read: relay<SpecGraphResponse>({
        data: THREE_PAGES,
        dataUpdatedAt: READ_AT,
      }),
      expect: () => ({
        state: "known",
        value: "2 of 3",
        detail: "pages of the runner's own interface with a readable model",
        asOf: READ_AT,
      }),
    },
    {
      name: "answered with no pages",
      read: relay<SpecGraphResponse>({
        data: { ok: true, pages: [], reason: "no-pages-registered" },
        dataUpdatedAt: READ_AT,
      }),
      expect: () => ({
        state: "unknown",
        reason: "the runner has no interface pages modelled yet",
        asOf: READ_AT,
      }),
    },
    {
      name: "answered with no body",
      read: relay<SpecGraphResponse>({
        data: null as unknown as SpecGraphResponse,
        dataUpdatedAt: READ_AT,
      }),
      expect: () => ({
        state: "unknown",
        reason: "the runner answered without a model of its own interface",
        asOf: READ_AT,
      }),
    },
  ];

  /** The figure an expectation describes, from `source`, under `key`. */
  function figureOf(
    key: FidelityKey,
    source: string,
    e: Expected
  ): FidelityFigure {
    return e.state === "loading"
      ? { key, state: e.state, source }
      : { key, source, ...e };
  }

  /** The two figures no runner read decides. */
  function fixedFigures(runner: boolean): FidelityFigure[] {
    return [
      {
        key: "staleness",
        state: "unknown",
        reason: runner
          ? "the runner's interface models carry no time they were made"
          : NO_RUNNER_REASON,
        source: "the runner's interface models",
        asOf: null,
      },
      {
        key: "honesty",
        state: "unknown",
        reason: "coord's twin self-check does not cover interface models yet",
        source: "coord's twin self-check",
        asOf: null,
      },
    ];
  }

  for (const online of [true, false]) {
    const browser = online ? "online" : "offline";

    it(`is UNKNOWN throughout with no runner connected · ${browser}`, () => {
      const noRunner: Expected = {
        state: "unknown",
        reason: NO_RUNNER_REASON,
        asOf: null,
      };
      expect(
        appTwinFidelity({
          deviceId: null,
          online,
          apps: relay(),
          graph: relay(),
        })
      ).toEqual([
        figureOf("observed", "the runner's app registry", noRunner),
        figureOf("coverage", "the runner's interface models", noRunner),
        ...fixedFigures(false),
      ]);
    });

    for (const apps of APPS_ARMS) {
      for (const graph of GRAPH_ARMS) {
        it(`apps ${apps.name} · graph ${graph.name} · ${browser}`, () => {
          const figures = appTwinFidelity({
            deviceId: DEVICE,
            online,
            apps: apps.read,
            graph: graph.read,
          });
          expect(figures).toEqual([
            figureOf(
              "observed",
              "the runner's app registry",
              apps.expect(online)
            ),
            figureOf(
              "coverage",
              "the runner's interface models",
              graph.expect(online)
            ),
            ...fixedFigures(true),
          ]);
          // No figure states a number it could not read.
          for (const f of figures) {
            if (f.state !== "known") expectNoValue(f);
          }
        });
      }
    }
  }
});

/** An unknown or loading figure carries no value at all, never a zero. */
function expectNoValue(f: FidelityFigure): void {
  expect(JSON.stringify(f)).not.toMatch(/"value"/);
  if (f.state === "unknown") expect(f.reason.trim()).not.toBe("");
}
