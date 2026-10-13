import { describe, expect, it } from "vitest";

import { manifest, resolveSubspaces, summarize } from "./resolve";
import type { CellStatus, SubspaceProbe } from "./types";

/** The snapshot sub-spaces coord refuses to a non-system tenant (per qontinui-coord#3128). */
const SYSTEM_TENANT_SUBSPACES = new Set([
  "release",
  "schema",
  "infra",
  "infra_health",
  "config",
  "health",
  "deps",
  "route_serving",
  "client_telemetry",
]);

/**
 * The parameterized-row tools coord does NOT grant the device session Ask the
 * Twin runs on — the ones outside `device_default_allow_set`
 * (`DEVICE_DEFAULT_TOOLS` ∪ `TWIN_READ_TOOLS`) in qontinui-coord
 * `crates/coord/src/mcp/agent_tool_access.rs`. A row naming one of them cannot
 * be asked through Ask the Twin. Re-check against that file when a row's tool
 * changes.
 */
const TOOLS_NOT_GRANTED_TO_DEVICES = [
  "coord_query_account_usage",
  "coord_query_auth_config",
  "coord_query_delivery",
  "coord_recent_errors",
  "coord_resolve_origin",
  "coord_symbol_lookup",
  "coord_typecheck_file",
];

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

  it("says where every parameterized row can be asked, and only those rows", () => {
    for (const s of manifest.subspaces) {
      if (s.query_kind === "parameterized") {
        expect(
          ["ask-the-twin", "delivery-tab", "not-on-this-page"],
          s.id
        ).toContain(s.ask_via);
      } else {
        expect(s.ask_via, s.id).toBeUndefined();
      }
    }
  });

  it("sends a row to Ask the Twin exactly when coord grants its tool to device sessions", () => {
    for (const s of manifest.subspaces) {
      if (s.query_kind !== "parameterized") continue;
      const granted = !TOOLS_NOT_GRANTED_TO_DEVICES.includes(
        s.coord_query_tool ?? ""
      );
      expect(s.ask_via === "ask-the-twin", s.id).toBe(granted);
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

  it("counts snapshot rows as pending, never as not responding, while the probe loads", () => {
    const loading = summarize(resolveSubspaces(undefined, true));
    expect(loading.snapshotTotal).toBeGreaterThan(0);
    expect(loading.pending).toBe(loading.snapshotTotal);
    expect(loading.responding).toBe(0);
    // Once loaded, a missing probe is an error, not a probe in flight.
    expect(summarize(resolveSubspaces([], false)).pending).toBe(0);
  });

  it("excludes restricted observers from the responding denominator and counts them apart", () => {
    // The split per qontinui-coord#3128 for a non-system tenant: the nine
    // SystemTenant sub-spaces are refused, worktree and memory answer. The
    // gauge must read 2/2 responding · 9 restricted, never 2/11.
    const probes: SubspaceProbe[] = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => ({
        id: s.id,
        status: SYSTEM_TENANT_SUBSPACES.has(s.id)
          ? "restricted"
          : "implemented",
      }));
    const s = summarize(resolveSubspaces(probes, false));
    expect(s.responding).toBe(2);
    expect(s.snapshotTotal).toBe(2);
    expect(s.restricted).toBe(9);
    expect(s.pending).toBe(0);
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
