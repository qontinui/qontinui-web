import { describe, expect, it } from "vitest";

import {
  allProbesRestricted,
  declaredProbes,
  manifest,
  resolveSubspaces,
  summarize,
  unlistedDeclaredProbes,
} from "./resolve";
import type {
  CellStatus,
  SubspaceProbe,
  TwinCatalogEntry,
  TwinCatalogResponse,
} from "./types";

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
      "served",
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
    // SystemTenant sub-spaces are refused and every other snapshot row
    // answers. A refused row is never "not responding": the graded
    // denominator excludes it.
    const snapshotIds = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot")
      .map((s) => s.id);
    const probes: SubspaceProbe[] = snapshotIds.map((id) => ({
      id,
      status: SYSTEM_TENANT_SUBSPACES.has(id) ? "restricted" : "implemented",
    }));
    const answering = snapshotIds.length - SYSTEM_TENANT_SUBSPACES.size;
    const s = summarize(resolveSubspaces(probes, false));
    expect(s.responding).toBe(answering);
    expect(s.graded).toBe(answering);
    expect(s.snapshotTotal).toBe(snapshotIds.length);
    expect(s.restricted).toBe(SYSTEM_TENANT_SUBSPACES.size);
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

/** One served-catalog row (coord `twin_probe_door.rs` `served_entry` shape). */
function catalogEntry(
  subspace: string,
  overrides: Partial<TwinCatalogEntry> = {}
): TwinCatalogEntry {
  return {
    id: subspace,
    subspace,
    symbol: `Ξ_${subspace}`,
    twin: "process",
    stages: ["operate"],
    description: subspace,
    query_tool: `coord_query_${subspace}`,
    kind: "snapshot",
    declared_status: "live",
    params: [],
    snapshot: true,
    access: "system_tenant",
    door: `/coord/twin/${subspace}/verdict`,
    door_shape: "verdict_wrapper",
    observed: null,
    ...overrides,
  };
}

/**
 * A stubbed catalog declaring `release` and `worktree` (report-shaped) on the
 * twin door, `workers` (a manifest `snapshot` row) and the admin `outbound`
 * envelope door; `delivery` has a door but is neither a snapshot nor an
 * envelope. `schema` — a manifest snapshot row — is NOT declared.
 */
function stubCatalog(): TwinCatalogResponse {
  const entries = [
    catalogEntry("release"),
    catalogEntry("worktree", { door_shape: "report", access: "tenant" }),
    catalogEntry("workers", { access: "coord_internal" }),
    catalogEntry("outbound", {
      snapshot: false,
      door: "/admin/coord/outbound-budget",
      door_shape: "envelope",
      access: null,
    }),
    catalogEntry("delivery", {
      kind: "parameterized",
      snapshot: false,
      access: "tenant",
    }),
  ];
  return { entries, total: entries.length };
}

function rowById(rows: ReturnType<typeof resolveSubspaces>, id: string) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no manifest row ${id}`);
  return row;
}

describe("declaredProbes", () => {
  it("declares the snapshot entries and the envelope door, keyed by sub-space", () => {
    const declared = declaredProbes(stubCatalog());
    expect([...(declared?.keys() ?? [])].sort()).toEqual([
      "outbound",
      "release",
      "workers",
      "worktree",
    ]);
  });

  it("is UNKNOWN (null) without a declaration, never an empty declaration", () => {
    expect(declaredProbes(undefined)).toBeNull();
    expect(
      declaredProbes({ entries: [], total: 0, coord_error: "coord down" })
    ).toBeNull();
    // A coord predating the declaration serves no `snapshot` flag at all.
    const legacy = {
      entries: [{ id: "release", description: "x", query_tool: "t" }],
      total: 1,
    } as unknown as TwinCatalogResponse;
    expect(declaredProbes(legacy)).toBeNull();
  });
});

describe("resolveSubspaces joined to coord's catalog", () => {
  const probes: SubspaceProbe[] = [
    { id: "release", status: "implemented", door_shape: "verdict_wrapper" },
    { id: "worktree", status: "served", door_shape: "report" },
    { id: "workers", status: "partial", door_shape: "verdict_wrapper" },
    {
      id: "outbound",
      status: "partial",
      door_shape: "envelope",
      metrics: {
        coverage: 0.6,
        credibility: 0.9,
        posterior: null,
        staleness_seconds: null,
        provenance: "outbound_budget_observations",
        drift_class: "none",
      },
    },
  ];

  it("live-probes exactly the rows coord declares", () => {
    const rows = resolveSubspaces(probes, false, stubCatalog());
    const live = rows.filter((r) => r.liveProbed).map((r) => r.id);
    expect(live.sort()).toEqual(["outbound", "release", "workers", "worktree"]);
  });

  it("renders a manifest snapshot row coord does not declare as not served by coord", () => {
    const schema = rowById(
      resolveSubspaces(probes, false, stubCatalog()),
      "schema"
    );
    expect(schema.query_kind).toBe("snapshot");
    expect(schema.liveProbed).toBe(false);
    expect(schema.cellStatus).toBe("not-served");
  });

  it("reads the envelope door's cell like any other verdict", () => {
    const outbound = rowById(
      resolveSubspaces(probes, false, stubCatalog()),
      "outbound"
    );
    expect(outbound.cellStatus).toBe("partial");
    expect(outbound.doorShape).toBe("envelope");
    expect(outbound.metrics?.coverage).toBe(0.6);
  });

  it("keeps a report door's cell served — neither healthy nor partial", () => {
    const worktree = rowById(
      resolveSubspaces(probes, false, stubCatalog()),
      "worktree"
    );
    expect(worktree.cellStatus).toBe("served");
    expect(worktree.doorShape).toBe("report");
  });

  it("keeps a declared row the probe has not answered probing, then error", () => {
    expect(
      rowById(resolveSubspaces(undefined, true, stubCatalog()), "workers")
        .cellStatus
    ).toBe("probing");
    expect(
      rowById(resolveSubspaces([], false, stubCatalog()), "workers").cellStatus
    ).toBe("error");
  });

  it("maps a per-cell 403 to the restricted status, never error", () => {
    const refused: SubspaceProbe[] = [
      ...probes.filter((p) => p.id !== "release"),
      { id: "release", status: "restricted" },
    ];
    const release = rowById(
      resolveSubspaces(refused, false, stubCatalog()),
      "release"
    );
    expect(release.cellStatus).toBe("restricted");
  });

  it("counts a served report as live-probed but not responding", () => {
    const summary = summarize(resolveSubspaces(probes, false, stubCatalog()));
    expect(summary.snapshotTotal).toBe(4);
    // release + workers + outbound answer a verdict; worktree is a report.
    expect(summary.responding).toBe(3);
    // ...so the live gauge's denominator leaves the report out.
    expect(summary.served).toBe(1);
    expect(summary.graded).toBe(3);
  });

  it("resolves every declared row UNKNOWN, with why, while the probe holds no reading", () => {
    // The backend's degraded matrix: a stand-in error per declared id.
    const standIns: SubspaceProbe[] = probes.map((p) => ({
      id: p.id,
      status: "error",
      error: "coord_unavailable",
    }));
    const reason =
      "coord's live probe could not be made: coord could not be reached";
    // Read as an answer, each stand-in is an observer error — the lie.
    expect(
      rowById(resolveSubspaces(standIns, false, stubCatalog()), "workers")
        .cellStatus
    ).toBe("error");
    const rows = resolveSubspaces(standIns, false, stubCatalog(), reason);
    for (const id of ["outbound", "release", "workers", "worktree"]) {
      const row = rowById(rows, id);
      expect(row.cellStatus, id).toBe("unknown");
      expect(row.unknownReason, id).toBe(reason);
      expect(row.error, id).toBeUndefined();
    }
    // Whatever the cells say: a real-looking answer is no reading either.
    expect(
      rowById(resolveSubspaces(probes, false, stubCatalog(), reason), "release")
        .cellStatus
    ).toBe("unknown");
    // What is not probed live is the manifest's, reading or not.
    expect(rowById(rows, "schema").cellStatus).toBe("not-served");
    expect(rowById(rows, "schema").unknownReason).toBeUndefined();
  });

  it("falls back to the manifest's snapshot rows, and any probed row, without a catalog", () => {
    const rows = resolveSubspaces(
      [{ id: "metrics", status: "implemented" }],
      false
    );
    expect(rowById(rows, "schema").liveProbed).toBe(true);
    // A probe came back for a row the manifest calls parameterized: the
    // backend probed it because coord declared it, so it is live here too.
    expect(rowById(rows, "metrics").liveProbed).toBe(true);
    expect(rowById(rows, "metrics").cellStatus).toBe("implemented");
  });
});

describe("unlistedDeclaredProbes", () => {
  it("names the probes coord declares that the manifest has no row for", () => {
    const catalog = stubCatalog();
    catalog.entries.push(
      catalogEntry("zz_new_probe"),
      catalogEntry("aa_other")
    );
    expect(unlistedDeclaredProbes(catalog)).toEqual([
      "aa_other",
      "zz_new_probe",
    ]);
    // Every declared probe the manifest lists is not "unlisted".
    expect(unlistedDeclaredProbes(stubCatalog())).toEqual([]);
    expect(unlistedDeclaredProbes(undefined)).toEqual([]);
  });
});

describe("allProbesRestricted", () => {
  it("is true only when every probe was refused", () => {
    expect(
      allProbesRestricted({
        subspaces: [
          { id: "release", status: "restricted" },
          { id: "memory", status: "restricted" },
        ],
        probed: 2,
        restricted: true,
      })
    ).toBe(true);
    // A backend that flagged a matrix with one refused cell is not trusted to
    // hide the cells that answered.
    expect(
      allProbesRestricted({
        subspaces: [
          { id: "release", status: "restricted" },
          { id: "memory", status: "implemented" },
        ],
        probed: 2,
        restricted: true,
      })
    ).toBe(false);
    expect(
      allProbesRestricted({
        subspaces: [{ id: "release", status: "restricted" }],
        probed: 1,
        restricted: false,
      })
    ).toBe(false);
    expect(allProbesRestricted(undefined)).toBe(false);
  });
});
