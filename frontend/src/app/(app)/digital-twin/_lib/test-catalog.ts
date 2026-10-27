/**
 * A served-catalog fixture for the view tests: one coord catalog entry per
 * named manifest row, in coord `twin_probe_door.rs` `served_entry` shape, with
 * the door coord declares for it — the admin `envelope` door for `outbound`,
 * a `report` door for `worktree`, and a `verdict_wrapper` twin door for every
 * other row. Also the body coord's admin outbound door really answers
 * (`outboundEnvelope`). Every outbound probe answer that a digital-twin test
 * builds by hand with an envelope uses it.
 *
 * One exception: the page tests that read the derived spec's route stub
 * (`specs/pages/digital-twin/state-machine.derived.json`) still get its older
 * outbound cell. That cell is a `partial` at 60%, which coord's door cannot
 * send. The spec is re-derived from a snapshot, never hand-edited (style
 * guide §6.3). Test-only; nothing in the page imports it.
 */

import { manifest } from "./resolve";
import type {
  DoorShape,
  TwinCatalogEntry,
  TwinCatalogResponse,
  VerdictMetrics,
} from "./types";

/** The drift classes coord's outbound observer writes on a bucket. */
export type OutboundDriftClass =
  | "exhausted"
  | "cooling_down"
  | "burning"
  | "nominal"
  | "unknown";

/**
 * The worst bucket coord's admin outbound door observed — the first, worst-
 * first, and the one the answer's drift class comes from — as the backend
 * serves it: its class, and its age in seconds when read, or `null` for a
 * backend that predates carrying that age (`digital_twin.py`
 * `_class_bucket_age`). The two halves deploy separately, so both occur.
 */
export interface WorstBucket {
  readonly drift: OutboundDriftClass;
  readonly ageSeconds: number | null;
}

/**
 * The metrics the backend copies out of coord's admin outbound door: the
 * door's real body, never an invented one (qontinui-coord
 * `outbound_budget_read.rs` `OutboundBudgetResponse`, read through
 * `digital_twin.py` `_envelope_metrics`).
 *
 * - `coverage` is exactly 1 when coord observed any bucket, else 0. It is
 *   never in between, so the door never answers `partial`.
 * - `drift_class` is the worst bucket's class, or `unknown` with no bucket.
 * - `credibility` and `provenance` are the door's constants.
 * - It has NO `posterior`: the door reports none, so the backend passes it
 *   through as null.
 * - It has no answer-level age. Each bucket carries its own, and the backend
 *   serves the worst bucket's as `staleness_seconds`: `null` with no bucket,
 *   or from a backend that predates it.
 *
 * `worst` is the worst bucket, or `null` when coord observed none.
 */
export function outboundEnvelope(worst: WorstBucket | null): VerdictMetrics {
  return {
    coverage: worst === null ? 0 : 1,
    credibility: 0.95,
    posterior: null,
    staleness_seconds: worst?.ageSeconds ?? null,
    provenance: "persisted_oplog",
    drift_class: worst?.drift ?? "unknown",
  };
}

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
