/**
 * A served-catalog fixture for the view tests: one coord catalog entry per
 * named manifest row, in coord `twin_probe_door.rs` `served_entry` shape, with
 * the door coord declares for it — the admin `envelope` door for `outbound`,
 * a `report` door for `worktree`, and a `verdict_wrapper` twin door for every
 * other row. Test-only; nothing in the page imports it.
 */

import { manifest } from "./resolve";
import type { DoorShape, TwinCatalogEntry, TwinCatalogResponse } from "./types";

const OUTBOUND_DOOR = "/admin/coord/outbound-budget";

function doorShapeOf(id: string): DoorShape {
  if (id === "outbound") return "envelope";
  if (id === "worktree") return "report";
  return "verdict_wrapper";
}

/** A catalog declaring exactly `ids` (each must be a manifest row). */
export function catalogDeclaring(ids: readonly string[]): TwinCatalogResponse {
  const entries = ids.map((id): TwinCatalogEntry => {
    const row = manifest.subspaces.find((s) => s.id === id);
    if (!row) throw new Error(`no manifest row ${id}`);
    const envelope = id === "outbound";
    return {
      id,
      subspace: id,
      symbol: row.symbol,
      twin: row.twin,
      stages: row.stages,
      description: row.description,
      query_tool: row.coord_query_tool ?? `coord_query_${id}`,
      kind: "snapshot",
      declared_status: "live",
      params: [],
      snapshot: !envelope,
      access: envelope ? null : "system_tenant",
      door: envelope ? OUTBOUND_DOOR : `/coord/twin/${id}/verdict`,
      door_shape: doorShapeOf(id),
      observed: null,
    };
  });
  return { entries, total: entries.length };
}

/** The ids of every manifest `snapshot` row. */
export const MANIFEST_SNAPSHOT_IDS: readonly string[] = manifest.subspaces
  .filter((s) => s.query_kind === "snapshot")
  .map((s) => s.id);
