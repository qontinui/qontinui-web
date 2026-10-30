import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LIFECYCLE_STAGES,
  TWIN_PLANTS,
  coverageOf,
  gradedOf,
  inLifecycleOrder,
  rowsForStage,
  stageSummary,
  twinSummary,
} from "./lifecycle";
import { declaredProbes, manifest, resolveSubspaces } from "./resolve";
import type {
  LifecycleStage,
  ResolvedSubspace,
  SubspacesProbeResponse,
  TwinCatalogResponse,
  TwinPlant,
} from "./types";

const STAGE_IDS: LifecycleStage[] = LIFECYCLE_STAGES.map((s) => s.id);
const TWIN_IDS: TwinPlant[] = TWIN_PLANTS.map((t) => t.id);

/** `src/app` — this file lives in `frontend/src/app/(app)/digital-twin/_lib`. */
const APP_DIR = join(__dirname, "..", "..", "..");

/**
 * The page's Spec CI spec. Its catalog route stub is the stubbed copy of what
 * coord's `GET /coord/twin/catalog` serves; the backend test
 * (`backend/tests/test_digital_twin_subspaces.py`) pins the same stub against
 * the matrix stub, because each side's CI runs only on its own paths.
 */
const SPEC_FILE = join(
  APP_DIR,
  "..",
  "..",
  "specs",
  "pages",
  "digital-twin",
  "state-machine.derived.json"
);

/**
 * The body the spec stubs `urlPattern` with. Fails closed: a missing stub
 * throws rather than joining the manifest to nothing.
 */
function stubBody(urlPattern: string): unknown {
  const spec = JSON.parse(readFileSync(SPEC_FILE, "utf-8")) as {
    metadata: { routeStubs: { urlPattern: string; body: unknown }[] };
  };
  const stub = spec.metadata.routeStubs.find(
    (s) => s.urlPattern === urlPattern
  );
  if (!stub) throw new Error(`no ${urlPattern} route stub in ${SPEC_FILE}`);
  return stub.body;
}

/** The catalog body the spec stubs `/api/v1/digital-twin/catalog` with. */
function stubbedCatalog(): TwinCatalogResponse {
  return stubBody("**/api/v1/digital-twin/catalog") as TwinCatalogResponse;
}

/** Whether `href` resolves to a page under `src/app` or one of its route groups. */
function routeExists(href: string): boolean {
  const groups = readdirSync(APP_DIR).filter((d) => /^\(.+\)$/.test(d));
  return [APP_DIR, ...groups.map((g) => join(APP_DIR, g))].some((root) =>
    existsSync(join(root, ...href.split("/").filter(Boolean), "page.tsx"))
  );
}

describe("lifecycle vocabulary", () => {
  it("orders the eight stages intent → learn", () => {
    expect(STAGE_IDS).toEqual([
      "intent",
      "plan",
      "implement",
      "verify",
      "integrate",
      "release",
      "operate",
      "learn",
    ]);
  });

  it("names the three coupled twins", () => {
    expect(TWIN_IDS).toEqual(["environment", "process", "intent"]);
  });

  it("gives every stage a description and a human touchpoint", () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(stage.description, stage.id).not.toBe("");
      expect(stage.humanTouchpoint, stage.id).not.toBe("");
    }
  });

  it("links stages only to console pages that exist", () => {
    for (const stage of LIFECYCLE_STAGES) {
      for (const link of stage.consoleLinks) {
        expect(routeExists(link.href), `${stage.id} → ${link.href}`).toBe(true);
      }
    }
  });
});

describe("manifest twin + lifecycle fields", () => {
  it("has unique ids", () => {
    const ids = manifest.subspaces.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every row a valid twin", () => {
    for (const s of manifest.subspaces) {
      expect(TWIN_IDS, s.id).toContain(s.twin);
    }
  });

  it("gives every row at least one valid stage, no duplicates, in lifecycle order", () => {
    for (const s of manifest.subspaces) {
      expect(s.stages.length, s.id).toBeGreaterThan(0);
      for (const stage of s.stages) expect(STAGE_IDS, s.id).toContain(stage);
      expect(new Set(s.stages).size, s.id).toBe(s.stages.length);
      expect(s.stages, s.id).toEqual(inLifecycleOrder(s.stages));
    }
  });

  it("observes every stage with at least one row", () => {
    for (const stage of STAGE_IDS) {
      expect(
        rowsForStage(manifest.subspaces, stage).length,
        stage
      ).toBeGreaterThan(0);
    }
  });

  it("names a plan only on a row that is still being built", () => {
    for (const s of manifest.subspaces) {
      if (s.plan) {
        expect(["planned", "not-yet", "partial"], s.id).toContain(
          s.research_status
        );
      }
    }
  });

  it("joins every snapshot row to a probe coord's catalog declares, and back", () => {
    // The manifest's snapshot rows are the probes the page expects; the
    // stubbed catalog's declared probes are what coord serves. A snapshot row
    // coord does not declare renders "not served by coord"; a declared probe
    // with no manifest row is a live cell nothing renders.
    const declared = declaredProbes(stubbedCatalog());
    if (!declared) throw new Error("the stubbed catalog declares nothing");
    const snapshotIds = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => s.id)
      .sort();
    expect(snapshotIds).toEqual([...declared.keys()].sort());
    // The matrix stub Spec CI renders probes exactly what the catalog stub
    // declares (the backend test pins the same pair from its side).
    const matrix = stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse;
    expect(matrix.subspaces.map((s) => s.id).sort()).toEqual(
      [...declared.keys()].sort()
    );
    // Every declared probe is live-probed once the catalog is joined.
    const rows = resolveSubspaces([], false, stubbedCatalog());
    for (const id of declared.keys()) {
      expect(rows.find((r) => r.id === id)?.liveProbed, id).toBe(true);
    }
  });

  it("renders a snapshot row coord stops declaring as not served by coord", () => {
    const catalog = stubbedCatalog();
    const dropped = "memory";
    const without: TwinCatalogResponse = {
      ...catalog,
      entries: catalog.entries.filter((e) => e.subspace !== dropped),
    };
    const row = resolveSubspaces([], false, without).find(
      (r) => r.id === dropped
    )!;
    expect(row.cellStatus).toBe("not-served");
    expect(row.liveProbed).toBe(false);
  });

  it("keeps every description to one line of at most 160 characters", () => {
    for (const s of manifest.subspaces) {
      expect(s.description.length, s.id).toBeLessThanOrEqual(160);
      expect(s.description, s.id).not.toContain("\n");
    }
  });
});

/** A minimal resolved row for the summary fixtures. */
function row(
  id: string,
  stages: LifecycleStage[],
  query_kind: ResolvedSubspace["query_kind"],
  research_status: ResolvedSubspace["research_status"],
  cellStatus: ResolvedSubspace["cellStatus"],
  twin: TwinPlant = "process"
): ResolvedSubspace {
  return {
    id,
    symbol: `Ξ_${id}`,
    tier: 1,
    layer: "coord",
    twin,
    stages,
    description: id,
    research_status,
    research_doc: "theory/process-twin.md",
    query_kind,
    coord_query_tool: query_kind === "none" ? null : `coord_query_${id}`,
    observer_module: null,
    cellStatus,
    liveProbed: query_kind === "snapshot",
  };
}

const FIXTURE: ResolvedSubspace[] = [
  row("probe_ok", ["verify"], "snapshot", "implemented", "implemented"),
  row("probe_partial", ["verify", "release"], "snapshot", "partial", "partial"),
  row("probe_blind", ["verify"], "snapshot", "partial", "blind"),
  row("ask_it", ["verify"], "parameterized", "implemented", "interactive"),
  row("claimed", ["verify", "learn"], "none", "partial", "unprobed"),
  row("roadmap", ["verify"], "none", "planned", "planned", "environment"),
  row("absent", ["learn"], "none", "not-yet", "not-built", "intent"),
];

describe("rowsForStage", () => {
  it("keeps the rows that observe the stage, in manifest order", () => {
    expect(rowsForStage(FIXTURE, "verify").map((r) => r.id)).toEqual([
      "probe_ok",
      "probe_partial",
      "probe_blind",
      "ask_it",
      "claimed",
      "roadmap",
    ]);
    expect(rowsForStage(FIXTURE, "learn").map((r) => r.id)).toEqual([
      "claimed",
      "absent",
    ]);
  });

  it("preserves manifest order over the real manifest", () => {
    const order = manifest.subspaces.map((s) => s.id);
    for (const stage of STAGE_IDS) {
      const ids = rowsForStage(manifest.subspaces, stage).map((s) => s.id);
      const positions = ids.map((id) => order.indexOf(id));
      expect(positions, stage).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("stageSummary", () => {
  it("separates live probes from manifest claims and the roadmap", () => {
    const verify = stageSummary(FIXTURE).verify;
    expect(verify).toEqual({
      probed: 3,
      live: 2, // implemented + partial answer; blind does not
      pending: 0,
      served: 0,
      restricted: 0,
      unknown: 0,
      manifestBuilt: 2, // the parameterized and the none row — claims
      interactive: 1,
      planned: 1,
      notBuilt: 0,
      total: 6,
    });
  });

  it("counts a stage no row observes as all zeros", () => {
    expect(stageSummary(FIXTURE).intent).toEqual({
      probed: 0,
      live: 0,
      pending: 0,
      served: 0,
      restricted: 0,
      unknown: 0,
      manifestBuilt: 0,
      interactive: 0,
      planned: 0,
      notBuilt: 0,
      total: 0,
    });
  });

  it("counts a probe still in flight as pending — neither answering nor silent", () => {
    const counts = coverageOf([
      row("in_flight", ["verify"], "snapshot", "implemented", "probing"),
      row("answered", ["verify"], "snapshot", "implemented", "implemented"),
      row("silent", ["verify"], "snapshot", "partial", "error"),
    ]);
    expect(counts).toMatchObject({ probed: 3, live: 1, pending: 1 });
  });

  it("counts a served report and a refused probe apart from the silent ones", () => {
    const counts = coverageOf([
      row("report", ["operate"], "snapshot", "implemented", "served"),
      row("internal", ["operate"], "snapshot", "implemented", "restricted"),
      row("answered", ["operate"], "snapshot", "implemented", "implemented"),
      row("silent", ["operate"], "snapshot", "partial", "error"),
    ]);
    expect(counts).toMatchObject({
      probed: 4,
      live: 1,
      served: 1,
      restricted: 1,
      pending: 0,
    });
    // Only the report-free, unrefused probes can answer with a verdict.
    expect(gradedOf(counts)).toBe(2);
  });

  it("counts a row with no reading as unknown — neither answering nor silent", () => {
    // The probe failed or answered degraded: no row was read.
    const counts = coverageOf([
      row("unread_a", ["verify"], "snapshot", "implemented", "unknown"),
      row("unread_b", ["verify"], "snapshot", "partial", "unknown"),
      row("claimed", ["verify"], "none", "partial", "unprobed"),
    ]);
    expect(counts).toMatchObject({
      probed: 2,
      unknown: 2,
      live: 0,
      pending: 0,
      served: 0,
      restricted: 0,
      manifestBuilt: 1,
    });
  });

  it("puts every real row of every stage in exactly one bucket", () => {
    const summary = stageSummary(resolveSubspaces([], false));
    for (const stage of STAGE_IDS) {
      const c = summary[stage];
      expect(
        c.probed + c.restricted + c.manifestBuilt + c.planned + c.notBuilt,
        stage
      ).toBe(c.total);
      // No probe answered: nothing is live, whatever the manifest claims —
      // and nothing is pending either, because the probe is not in flight.
      expect(c.live, stage).toBe(0);
      expect(c.pending, stage).toBe(0);
    }
  });

  it("counts every probed row of every stage as pending while the probe loads", () => {
    const summary = stageSummary(resolveSubspaces(undefined, true));
    for (const stage of STAGE_IDS) {
      expect(summary[stage].pending, stage).toBe(summary[stage].probed);
      expect(summary[stage].live, stage).toBe(0);
    }
  });
});

describe("twinSummary", () => {
  it("groups the coverage by twin", () => {
    const summary = twinSummary(FIXTURE);
    expect(summary.process.total).toBe(5);
    expect(summary.process.live).toBe(2);
    expect(summary.environment).toEqual(
      coverageOf(FIXTURE.filter((r) => r.id === "roadmap"))
    );
    expect(summary.intent.notBuilt).toBe(1);
  });
});
