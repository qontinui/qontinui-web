import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LIFECYCLE_STAGES,
  TWIN_PLANTS,
  coverageOf,
  inLifecycleOrder,
  rowsForStage,
  stageSummary,
  twinSummary,
} from "./lifecycle";
import { manifest, resolveSubspaces } from "./resolve";
import type { LifecycleStage, ResolvedSubspace, TwinPlant } from "./types";

const STAGE_IDS: LifecycleStage[] = LIFECYCLE_STAGES.map((s) => s.id);
const TWIN_IDS: TwinPlant[] = TWIN_PLANTS.map((t) => t.id);

/** `src/app` — this file lives in `frontend/src/app/(app)/digital-twin/_lib`. */
const APP_DIR = join(__dirname, "..", "..", "..");

/** The backend module whose `_PROBEABLE_SUBSPACES` the page's probe fans out over. */
const PROBE_MODULE = join(
  APP_DIR,
  "..",
  "..",
  "..",
  "backend",
  "app",
  "api",
  "v1",
  "endpoints",
  "digital_twin.py"
);

/**
 * The ids the backend live-probes, parsed from the `_PROBEABLE_SUBSPACES`
 * literal in `backend/app/api/v1/endpoints/digital_twin.py` — read, not
 * copied, so the manifest is pinned to the tuple itself. (The tuple in turn is
 * a hand copy of coord `twin_routes.rs` `subspace_tool`, which no test in this
 * repo can read.) The backend test pins the same equality from its side by
 * reading the manifest, because each side's CI runs only on its own paths.
 *
 * Fails closed: a tuple it cannot find, a line it cannot parse, or an empty
 * list throws rather than comparing the manifest against nothing.
 */
function backendProbeableSubspaces(): string[] {
  const source = readFileSync(PROBE_MODULE, "utf-8");
  const literal =
    /^_PROBEABLE_SUBSPACES: tuple\[str, \.\.\.\] = \(\r?\n([\s\S]*?)^\)/m.exec(
      source
    );
  if (!literal) {
    throw new Error(`no _PROBEABLE_SUBSPACES tuple in ${PROBE_MODULE}`);
  }
  const ids: string[] = [];
  for (const line of literal[1].split(/\r?\n/)) {
    const item = line.replace(/#.*$/, "").trim();
    if (item === "") continue;
    const id = /^"([a-z0-9_]+)",?$/.exec(item)?.[1];
    if (!id) {
      throw new Error(`unparseable _PROBEABLE_SUBSPACES entry: ${line.trim()}`);
    }
    ids.push(id);
  }
  if (ids.length === 0) throw new Error("_PROBEABLE_SUBSPACES parsed empty");
  return ids;
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

  it("marks a row snapshot only when the backend probes it, and probes only snapshot rows", () => {
    // A `snapshot` row outside the tuple resolves to `error` forever; a probed
    // id with no snapshot row is a probe nothing renders.
    const snapshotIds = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => s.id)
      .sort();
    const probed = backendProbeableSubspaces();
    expect(new Set(probed).size, "duplicate probe id").toBe(probed.length);
    expect(snapshotIds).toEqual([...probed].sort());
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
      restricted: 0,
      live: 2, // implemented + partial answer; blind does not
      pending: 0,
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
      restricted: 0,
      live: 0,
      pending: 0,
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

  it("keeps a restricted probe out of the live denominator — an access decision, not silence", () => {
    // Once qontinui-coord#3128 lands, coord refuses SystemTenant sub-spaces per cell to a
    // non-system tenant; those cells must not read as "probed, not answering".
    const counts = coverageOf([
      row("refused_a", ["release"], "snapshot", "implemented", "restricted"),
      row("refused_b", ["release"], "snapshot", "implemented", "restricted"),
      row("answered", ["release"], "snapshot", "implemented", "implemented"),
    ]);
    expect(counts).toMatchObject({
      probed: 1,
      restricted: 2,
      live: 1,
      pending: 0,
      total: 3,
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
