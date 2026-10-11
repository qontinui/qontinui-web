import { describe, expect, it } from "vitest";

import { manifest, resolveSubspaces, summarize } from "./resolve";
import type { CellStatus, SubspaceProbe } from "./types";

describe("subspaces manifest integrity", () => {
  it("has unique ids", () => {
    const ids = manifest.subspaces.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every snapshot row names a coord query tool", () => {
    for (const s of manifest.subspaces) {
      if (s.query_kind === "snapshot") {
        expect(s.coord_query_tool, `${s.id} is snapshot`).toBeTruthy();
      }
    }
  });

  it("every parameterized row names the coord tool that answers it", () => {
    for (const s of manifest.subspaces) {
      if (s.query_kind === "parameterized") {
        expect(s.coord_query_tool, `${s.id} is parameterized`).toBeTruthy();
      }
    }
  });

  it("every row has a valid tier, layer, query_kind and research_status", () => {
    for (const s of manifest.subspaces) {
      expect([1, 2, 3]).toContain(s.tier);
      expect(["coord", "ui-bridge", "runner"]).toContain(s.layer);
      expect(["snapshot", "parameterized", "none"]).toContain(s.query_kind);
      expect(["implemented", "partial", "planned", "not-yet"]).toContain(
        s.research_status
      );
    }
  });
});

describe("resolveSubspaces", () => {
  const snapshotId = manifest.subspaces.find(
    (s) => s.query_kind === "snapshot"
  )!.id;
  const parameterizedId = manifest.subspaces.find(
    (s) =>
      s.query_kind === "parameterized" &&
      (s.research_status === "implemented" || s.research_status === "partial")
  )!.id;
  const noneBuiltId = manifest.subspaces.find(
    (s) => s.query_kind === "none" && s.research_status === "implemented"
  )!.id;
  const nonePlannedId = manifest.subspaces.find(
    (s) => s.query_kind === "none" && s.research_status === "planned"
  )!.id;
  const noneNotBuiltId = manifest.subspaces.find(
    (s) => s.query_kind === "none" && s.research_status === "not-yet"
  )!.id;

  it("shows 'probing' for snapshot rows while loading with no probe yet", () => {
    const rows = resolveSubspaces(undefined, true);
    const row = rows.find((r) => r.id === snapshotId)!;
    expect(row.cellStatus).toBe("probing");
  });

  it("shows 'error' for a snapshot row with no probe once loaded", () => {
    const rows = resolveSubspaces([], false);
    const row = rows.find((r) => r.id === snapshotId)!;
    expect(row.cellStatus).toBe("error");
  });

  it("maps a probe's status onto the snapshot cell and carries metrics", () => {
    const probe: SubspaceProbe = {
      id: snapshotId,
      status: "partial",
      metrics: {
        coverage: 0.4,
        credibility: 0.9,
        posterior: null,
        staleness_seconds: null,
        provenance: "live_aws",
        drift_class: "ok",
      },
    };
    const row = resolveSubspaces([probe], false).find(
      (r) => r.id === snapshotId
    )!;
    expect(row.cellStatus).toBe("partial");
    expect(row.metrics?.provenance).toBe("live_aws");
  });

  it("treats no_snapshot_tool on a snapshot row as an error (manifest/coord drift)", () => {
    const probe: SubspaceProbe = { id: snapshotId, status: "no_snapshot_tool" };
    const row = resolveSubspaces([probe], false).find(
      (r) => r.id === snapshotId
    )!;
    expect(row.cellStatus).toBe("error");
  });

  it("shows 'interactive' for a built parameterized row (no live probe)", () => {
    const row = resolveSubspaces([], false).find(
      (r) => r.id === parameterizedId
    )!;
    expect(row.cellStatus).toBe("interactive");
  });

  it("shows 'unprobed' — never 'Live' — for a built 'none' row", () => {
    const row = resolveSubspaces([], false).find((r) => r.id === noneBuiltId)!;
    expect(row.cellStatus).toBe("unprobed");
  });

  it("shows 'planned' for a planned 'none' row", () => {
    const row = resolveSubspaces([], false).find(
      (r) => r.id === nonePlannedId
    )!;
    expect(row.cellStatus).toBe("planned");
  });

  it("shows 'not-built' for an unbuilt 'none' row", () => {
    const row = resolveSubspaces([], false).find(
      (r) => r.id === noneNotBuiltId
    )!;
    expect(row.cellStatus).toBe("not-built");
  });

  it("never renders a row it does not probe with the live vocabulary", () => {
    // Even with every snapshot probe answering, a static claim stays a claim.
    const probes: SubspaceProbe[] = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => ({ id: s.id, status: "implemented" }));
    const probeStatuses: CellStatus[] = [
      "implemented",
      "partial",
      "blind",
      "error",
      "probing",
      "restricted",
    ];
    for (const row of resolveSubspaces(probes, false)) {
      if (row.query_kind !== "snapshot") {
        expect(probeStatuses, row.id).not.toContain(row.cellStatus);
      }
    }
  });
});

describe("summarize", () => {
  it("counts responding = implemented + partial among snapshot rows", () => {
    // Two snapshot ids: one implemented, one partial → both responding; a third
    // blind → not responding.
    const snapshots = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => s.id);
    const [a, b, c] = snapshots;
    const probes: SubspaceProbe[] = [
      { id: a!, status: "implemented" },
      { id: b!, status: "partial" },
      { id: c!, status: "blind" },
    ];
    const rows = resolveSubspaces(probes, false);
    const s = summarize(rows);
    expect(s.responding).toBe(2);
    expect(s.snapshotTotal).toBe(snapshots.length);
    expect(s.total).toBe(manifest.subspaces.length);
    // built = implemented|partial research_status across the whole taxonomy.
    expect(s.built).toBeGreaterThan(0);
    expect(s.built).toBeLessThanOrEqual(s.total);
  });

  it("counts built from the manifest claim alone, independent of the probe", () => {
    const claimed = manifest.subspaces.filter(
      (s) =>
        s.research_status === "implemented" || s.research_status === "partial"
    ).length;
    expect(summarize(resolveSubspaces([], false)).built).toBe(claimed);
    expect(summarize(resolveSubspaces(undefined, true)).built).toBe(claimed);
  });
});
