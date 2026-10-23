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
  NO_RUNNER_REASON,
  RESTRICTED_REASON,
  SELF_CHECK_INTERNAL_REASON,
  TWIN_ASPECTS,
  appTwinFidelity,
  aspectRows,
  partName,
  plantFidelity,
  twinAspect,
  type AppTwinRead,
  type FidelityFigure,
  type FidelityKey,
  type ProbeRead,
  type RelayRead,
  type ReportRead,
} from "./twin-aspects";
import type {
  RawVerdictResponse,
  ResolvedSubspace,
  SubspaceProbe,
  TwinCatalogEntry,
  TwinCatalogResponse,
} from "./types";

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

function probeRead(over: Partial<ProbeRead> = {}): ProbeRead {
  return {
    rows: rowsFor(ENV_PROBES),
    failed: false,
    error: null,
    restricted: false,
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
  return { subspace: "twin_fidelity", tool: "coord_query_twin_fidelity", verdict };
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
      expect(owners.map((a) => a.id), s.id).toEqual([s.twin]);
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
    expect(f.staleness).toMatchObject({ state: "known", value: "10m old" });
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

  it("renders a failed probe as UNKNOWN with its reason — never as 0 answering", () => {
    const failed = probeRead({
      rows: resolveSubspaces(undefined, false),
      failed: true,
      error: new Error("GET /api/v1/digital-twin/subspaces failed: 502 - bad gateway"),
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

  it("renders every probe refused as the restriction, named", () => {
    const f = figures("environment", probeRead({ restricted: true }));
    expectNoZeroFor(f.observed);
    expect(f.observed.state === "unknown" && f.observed.reason).toBe(RESTRICTED_REASON);
  });

  it("is still reading while a probe is in flight", () => {
    const f = figures("environment", probeRead({ rows: resolveSubspaces(undefined, true) }));
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
    expect(f.observed.state === "unknown" && f.observed.reason).toMatch(/reports rather than verdicts/);
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
        { subspace: "schema", observed: true, coverage: 1, honest: false, honesty_evaluated: true },
        { subspace: "release", observed: true, coverage: 1, honest: true, honesty_evaluated: true },
        { subspace: "deps", observed: false, coverage: 0, honest: true, honesty_evaluated: false },
        { subspace: "memory", observed: true, coverage: 1, honest: true, honesty_evaluated: true },
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
      error: new Error("GET /api/v1/digital-twin/subspace/twin_fidelity/raw failed: 403 - no"),
      errorUpdatedAt: NOW - 2_000,
    });
    const f = figures("environment", probeRead(), forbidden);
    expectNoZeroFor(f.honesty);
    expect(f.honesty.state === "unknown" && f.honesty.reason).toBe(SELF_CHECK_INTERNAL_REASON);
    expect(f.honesty.state === "unknown" && f.honesty.asOf).toBe(NOW - 2_000);
  });

  it("is UNKNOWN when coord serves no report, or no per-part breakdown, or nothing of this twin", () => {
    const missing = reportRead({
      isError: true,
      error: new Error("GET /x failed: 404 - none"),
    });
    expect(figures("environment", probeRead(), missing).honesty.state).toBe("unknown");

    const flat = reportRead({ data: reportOf({ observed: true, total: 3, honesty_violations: 0 }) });
    const noParts = figures("environment", probeRead(), flat).honesty;
    expectNoZeroFor(noParts);
    expect(noParts.state === "unknown" && noParts.reason).toMatch(/no per-part breakdown/);

    const intent = figures("intent", probeRead(), withParts).honesty;
    expectNoZeroFor(intent);
    expect(intent.state === "unknown" && intent.reason).toMatch(/does not measure this twin/);
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

function appFigures(read: AppTwinRead): Record<FidelityKey, FidelityFigure> {
  const out = {} as Record<FidelityKey, FidelityFigure>;
  for (const f of appTwinFidelity(read)) out[f.key] = f;
  return out;
}

describe("appTwinFidelity — the UI Bridge app twin", () => {
  it("is UNKNOWN throughout with no runner connected", () => {
    const f = appFigures({ deviceId: null, apps: relay(), graph: relay() });
    for (const key of ["observed", "coverage", "staleness"] as const) {
      expectNoZeroFor(f[key]);
      expect(f[key].state === "unknown" && f[key].reason, key).toBe(NO_RUNNER_REASON);
    }
    expectNoZeroFor(f.honesty);
  });

  it("counts the registered apps and the readable interface pages", () => {
    const f = appFigures({
      deviceId: "device-1",
      apps: relay({ data: { ok: true, apps: [{ app_id: "a" }, { app_id: "b" }] }, dataUpdatedAt: 7 }),
      graph: relay({
        data: {
          ok: true,
          pages: [
            { id: "p1", stateIds: ["s"], transitionIds: [] },
            { id: "p2", stateIds: [], transitionIds: [] },
            { id: "p3", reason: "ir-read-failed", error: "x" },
          ],
        },
        dataUpdatedAt: 8,
      }),
    });
    expect(f.observed).toMatchObject({ state: "known", value: "2 apps", asOf: 7 });
    expect(f.coverage).toMatchObject({ state: "known", value: "2 of 3", asOf: 8 });
    // The models carry no time, and no honesty check covers them.
    expectNoZeroFor(f.staleness);
    expectNoZeroFor(f.honesty);
  });

  it("is UNKNOWN, with the relay's status, when the runner's reads fail", () => {
    const f = appFigures({
      deviceId: "device-1",
      apps: relay({ isError: true, error: new RunnerRelayError("down", 503), errorUpdatedAt: 9 }),
      graph: relay({ data: { ok: true, pages: [], reason: "no-pages-registered" } }),
    });
    expectNoZeroFor(f.observed);
    expect(f.observed.state === "unknown" && f.observed.reason).toBe(
      "the runner's app registry could not be read (HTTP 503)"
    );
    expectNoZeroFor(f.coverage);
    expect(f.coverage.state === "unknown" && f.coverage.reason).toMatch(/no interface pages/);
  });

  it("is reading while the runner's reads are in flight", () => {
    const f = appFigures({
      deviceId: "device-1",
      apps: relay({ isLoading: true }),
      graph: relay({ isLoading: true }),
    });
    expect(f.observed.state).toBe("loading");
    expect(f.coverage.state).toBe("loading");
  });
});
