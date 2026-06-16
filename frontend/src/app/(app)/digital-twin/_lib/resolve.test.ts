import { describe, expect, it } from "vitest";

import { manifest, resolveSubspaces, summarize } from "./resolve";
import type { SubspaceProbe } from "./types";

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

  it("every row has a valid tier, query_kind and research_status", () => {
    for (const s of manifest.subspaces) {
      expect([1, 2, 3]).toContain(s.tier);
      expect(["snapshot", "parameterized", "none"]).toContain(s.query_kind);
      expect(["implemented", "partial", "planned", "not-yet"]).toContain(
        s.research_status,
      );
    }
  });
});

describe("resolveSubspaces", () => {
  const snapshotId = manifest.subspaces.find((s) => s.query_kind === "snapshot")!.id;
  const parameterizedId = manifest.subspaces.find(
    (s) => s.query_kind === "parameterized" && s.research_status !== "planned",
  )!.id;
  const noneNotBuiltId = manifest.subspaces.find(
    (s) => s.query_kind === "none" && s.research_status === "not-yet",
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
    const row = resolveSubspaces([probe], false).find((r) => r.id === snapshotId)!;
    expect(row.cellStatus).toBe("partial");
    expect(row.metrics?.provenance).toBe("live_aws");
  });

  it("treats no_snapshot_tool on a snapshot row as an error (manifest/coord drift)", () => {
    const probe: SubspaceProbe = { id: snapshotId, status: "no_snapshot_tool" };
    const row = resolveSubspaces([probe], false).find((r) => r.id === snapshotId)!;
    expect(row.cellStatus).toBe("error");
  });

  it("shows 'interactive' for a built parameterized row (no live probe)", () => {
    const row = resolveSubspaces([], false).find((r) => r.id === parameterizedId)!;
    expect(row.cellStatus).toBe("interactive");
  });

  it("shows 'not-built' for an unbuilt 'none' row", () => {
    const row = resolveSubspaces([], false).find((r) => r.id === noneNotBuiltId)!;
    expect(row.cellStatus).toBe("not-built");
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
});
