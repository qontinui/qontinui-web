/**
 * Minimal, feature-scoped types for the coord release-verdict envelope as it is
 * proxied by the web backend at:
 *
 *   GET /api/v1/digital-twin/subspace/release/raw
 *     → coord GET /coord/twin/release/verdict
 *
 * We deliberately do NOT reuse the generic `DriftVerdict` type: its `components`
 * field is a loose `Record<string, unknown>`, whereas the release subspace has a
 * concrete `{ surfaces: [...] }` shape. The per-surface "is prod current?" signal
 * the strip renders lives in `verdict.surfaces[i].components` (surface-level),
 * NOT the top-level envelope drift_class.
 *
 * Fields are typed loosely (optional / nullable) on purpose — the strip must
 * degrade gracefully if coord adds/omits a field, and never throw on a shape it
 * doesn't recognise.
 */

/** Per-surface drift state — the key the strip badge is keyed on. */
export type SurfaceDriftClass =
  | "in_sync"
  | "in_flight"
  | "pending"
  | "stale"
  | "failed_deploy"
  | "rolled_back"
  | "unknown"
  // tolerate any future class coord emits without a TS break.
  | (string & {});

/** The surface-level state we actually read (verdict.surfaces[i].components). */
export interface ReleaseSurfaceComponents {
  surface?: string | null;
  target?: string | null;
  deployed_sha?: string | null;
  declared_sha?: string | null;
  drift_class?: SurfaceDriftClass | null;
  in_sync?: boolean | null;
  lag_seconds?: number | null;
}

export interface ReleaseSurface {
  components?: ReleaseSurfaceComponents | null;
  // envelope-level fields exist (drift_class / d3_outcome / coverage /
  // credibility) but the strip intentionally ignores them — the per-surface
  // `components` block is the source of truth.
}

export interface ReleaseVerdict {
  surfaces?: ReleaseSurface[] | null;
}

export interface ReleaseVerdictResponse {
  subspace?: string | null;
  tool?: string | null;
  verdict?: ReleaseVerdict | null;
  // Present only on the degraded envelope the admin-dev proxy returns when
  // coord is unreachable (200 with empty surfaces). The strip already renders
  // "deploy status unavailable" on empty surfaces, so this is informational.
  coord_error?: string | null;
}
