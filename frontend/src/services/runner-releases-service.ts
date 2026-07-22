/**
 * Runner releases service — the runner-publishing (GitHub Releases) surface of
 * coord's Ξ_Release sub-space, for the `/admin/coord/releases` dashboard.
 *
 * Thin client over the web backend proxy at
 * `GET /api/v1/operations/releases[/{tag}]`, which forwards the operator's
 * Cognito bearer to coord's `GET /coord/twin/release/history`. The frontend
 * never talks to coord directly.
 *
 * Types mirror the coord history contract verbatim (snake_case) — they are the
 * on-the-wire shape (Phase 1). Keep them in sync with coord's emitter.
 */

import { httpClient } from "./service-factory";

const API = "/api/v1/operations";

/**
 * Surface-level drift descriptor. `token` is the surface's own class
 * (`in_sync` / `in_flight` / `stale` / `failed_deploy` / `rolled_back`);
 * `canonical` is the §3.3 twin class (`none` / `pending` / `active_negation` /
 * `unknown`); `subclass` is the namespaced `release:*` refinement (null for
 * in_sync / unknown).
 */
export interface ReleaseDriftClass {
  token: string;
  canonical: string;
  subclass: string | null;
}

/**
 * One observed release row. Nullable where coord cannot observe a value (no
 * published release yet, GitHub unreachable → `coverage < 1`). `assets` is the
 * published asset filename list; `has_setup_exe` / `has_latest_json` are the
 * Windows hard-gate presence checks (Φ).
 *
 * The five detail-derived fields (`draft_present`, `prerelease`, `assets`,
 * `has_setup_exe`, `has_latest_json`) are `null` for a DARK observation — coord
 * emits them via `detail.as_ref().map(...)`, and `detail` is `None` when the
 * GitHub read failed or the token is unset (a plain-text `deploy_outcome` that
 * carries no `GithubReleaseDetail`). That is exactly the GitHub-outage row this
 * dashboard exists to surface, so consumers MUST treat them as nullable.
 */
export interface ReleaseHistoryEntry {
  observed_at: string | null;
  version: string | null;
  tag: string | null;
  repo: string;
  in_sync: boolean;
  drift_class: ReleaseDriftClass;
  lag_seconds: number | null;
  ci_state: string | null;
  published_tag: string | null;
  published_at: string | null;
  draft_present: boolean | null;
  prerelease: boolean | null;
  assets: string[] | null;
  has_setup_exe: boolean | null;
  has_latest_json: boolean | null;
  coverage: number;
  credibility: number;
  provenance: string;
  deploy_outcome_raw: string | null;
}

export interface ReleaseHistoryResponse {
  surface: string;
  repo: string;
  target: string;
  count: number;
  history: ReleaseHistoryEntry[];
  /**
   * Present when the web proxy served a coord error (e.g. coord unreachable /
   * `release_history_read_failed`). Absent on a healthy fetch — the page keys
   * its inline error banner on the thrown `httpClient` error today, but the
   * field is typed so a future stale-while-revalidate proxy can set it.
   */
  coord_error?: string;
}

class RunnerReleasesService {
  /**
   * List runner release observations (newest-first) from coord via the web
   * proxy. Throws on a non-2xx response (`httpClient.get` rejects with an
   * Error embedding the status).
   *
   * `opts.repo` selects the observed surface (default coord's
   * `qontinui/qontinui-runner`); `opts.limit` caps the history window (1–500).
   */
  async list(opts?: {
    repo?: string;
    limit?: number;
  }): Promise<ReleaseHistoryResponse> {
    const p = new URLSearchParams();
    if (opts?.repo) p.set("repo", opts.repo);
    if (opts?.limit) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return httpClient.get<ReleaseHistoryResponse>(
      `${API}/releases${qs ? `?${qs}` : ""}`,
    );
  }

  /**
   * Fetch a single release observation by `tag`. Coord has no single-tag
   * route; the web proxy filters the history list server-side and 404s
   * (`release_tag_not_found`) when no entry matches.
   */
  async get(
    tag: string,
    opts?: { repo?: string },
  ): Promise<ReleaseHistoryEntry> {
    const p = new URLSearchParams();
    if (opts?.repo) p.set("repo", opts.repo);
    const qs = p.toString();
    return httpClient.get<ReleaseHistoryEntry>(
      `${API}/releases/${encodeURIComponent(tag)}${qs ? `?${qs}` : ""}`,
    );
  }
}

export const runnerReleasesService = new RunnerReleasesService();
