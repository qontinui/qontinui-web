/**
 * Admin dev-overview service — superuser "gates & rollout" dashboard.
 *
 * Thin client over the web backend proxy at
 * `GET /api/v1/admin-dev/overview`, which forwards the operator's Cognito
 * bearer to coord's `GET /coord/dev-overview`. The frontend never talks to
 * coord directly.
 *
 * Types mirror the coord JSON contract verbatim (snake_case). Keep them in
 * sync with the coord emitter — they are the on-the-wire shape.
 */

import { httpClient } from "./service-factory";

const API = "/api/v1/admin-dev";

// ---- Progress / ETA ------------------------------------------------------

export type ProgressBasis =
  | "time_elapsed"
  | "sql_count"
  | "metric_threshold"
  | "plan_ready"
  | "binary"
  | "indeterminate";

export type EtaConfidence = "exact" | "estimate" | "none";

export interface GateProgress {
  basis: ProgressBasis;
  current: number | null;
  target: number | null;
  unit: string | null;
  fraction: number | null;
  eta: string | null;
  eta_confidence: EtaConfidence;
}

// ---- Gate row ------------------------------------------------------------

export interface GateOverviewRow {
  gate_id: string;
  claim_kind: string | null;
  resource_key: string | null;
  plan_id: string | null;
  plan_slug: string | null;
  phase_name: string | null;
  predicate: Record<string, unknown>;
  verdict: string;
  verdict_reason: string | null;
  registered_by: string | null;
  tenant_id: string;
  created_at: string;
  evaluated_at: string | null;
  cleared_at: string | null;
  muted: boolean;
  snoozed_until: string | null;
  clearance_audience: string;
  continuation_spawn: Record<string, unknown> | null;
  continuation_dispatched_at: string | null;
  continuation_consumed_at: string | null;
  continuation_consumed_by: string | null;
  continuation_consumed_outcome: string | null;
  continuation_cancelled_at: string | null;
  continuation_cancelled_by: string | null;
  continuation_cancel_reason: string | null;
  title: string;
  measures: string;
  progress: GateProgress;
  age_secs: number;
  stale: boolean;
}

// ---- Rollouts ------------------------------------------------------------

export type FeatureTier = "off" | "shadow" | "live";

export type FeatureSource = "env" | "tenant_db" | "repo_db" | "default";

export interface FeatureRollout {
  name: string;
  tier: FeatureTier;
  source: FeatureSource;
  threshold: number | null;
}

export interface AutoMergeRollout {
  live: string[];
  shadow: string[];
  dry_run: string[];
}

export interface RolloutOverview {
  auto_merge: AutoMergeRollout;
  features: FeatureRollout[];
}

// ---- Counts --------------------------------------------------------------

/**
 * Tenant-wide counts computed across ALL gates (not just the returned page),
 * so the summary stays accurate no matter the `limit`/filter. The `gates`
 * array is a capped, OPEN-first page; these are the true totals.
 */
export interface GateCounts {
  total: number;
  open: number;
  cleared: number;
  cleared_today: number;
  failed: number;
  stale: number;
  muted: number;
  snoozed: number;
  /** Reaper-archived gates (archived_at IS NOT NULL), retained for audit. */
  archived: number;
}

export type GateVerdict = "open" | "cleared" | "failed";

// ---- Top-level envelope --------------------------------------------------

export interface DevOverview {
  generated_at: string;
  gates: GateOverviewRow[];
  counts: GateCounts;
  rollouts: RolloutOverview;
  /**
   * Present (set by the web proxy) when coord was unreachable/degraded and
   * the envelope is empty as a result — the page surfaces it as a banner
   * rather than showing a misleading "0 gates". Absent on a healthy fetch.
   */
  coord_error?: string;
}

class AdminDevService {
  /**
   * Fetch the gates + rollout overview from coord (via the web proxy).
   * Throws on a non-2xx response (`httpClient.get` rejects with an Error
   * whose message embeds the status — parse with the page-side helpers).
   *
   * `opts.refresh` passes `?refresh=1` to bypass the backend's ~30s TTL
   * cache (the manual Refresh button passes it; auto-poll does not, so the
   * poll benefits from the cache). `opts.verdict` filters server-side;
   * `opts.limit` caps the page (coord orders OPEN-first either way).
   * `opts.includeArchived` includes reaper-archived gates in the page
   * (default: live gates only).
   */
  async getOverview(opts?: {
    refresh?: boolean;
    verdict?: GateVerdict;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<DevOverview> {
    const p = new URLSearchParams();
    if (opts?.refresh) p.set("refresh", "1");
    if (opts?.verdict) p.set("verdict", opts.verdict);
    if (opts?.limit) p.set("limit", String(opts.limit));
    if (opts?.includeArchived) p.set("include_archived", "1");
    const qs = p.toString();
    return httpClient.get<DevOverview>(
      `${API}/overview${qs ? `?${qs}` : ""}`,
    );
  }
}

export const adminDevService = new AdminDevService();
