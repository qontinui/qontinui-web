/**
 * `/operations/releases` — the runner-publishing (GitHub Releases) surface of
 * coord's Ξ_Release sub-space, for the `/admin/coord/releases` dashboard.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7 batch 6), moved here from `services/runner-releases-service.ts`.
 * The handler is `get_releases` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which forwards the
 * operator's bearer to coord's `GET /coord/twin/release/history`. The
 * frontend never talks to coord directly.
 *
 * Types mirror the coord history contract verbatim (snake_case) — they are the
 * on-the-wire shape. Keep them in sync with coord's emitter.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

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
   * its inline error banner on the thrown client error today, but the
   * field is typed so a future stale-while-revalidate proxy can set it.
   */
  coord_error?: string;
}

/**
 * `GET /releases` — runner release observations, newest-first. Rejects on a
 * non-2xx with `GET <url> failed: <status> - <body>`.
 *
 * `query.repo` selects the observed surface (default coord's
 * `qontinui/qontinui-runner`); `query.limit` caps the history window (1–500).
 * `options` is the per-request retry budget; a polling caller passes
 * `COORD_DASHBOARD_POLL_OPTIONS` so a 5xx costs one request. With neither
 * filter the URL carries no `?` at all.
 */
export async function fetchReleaseHistory(
  query: { repo?: string; limit?: number } = {},
  options: HttpOptions = {}
): Promise<ReleaseHistoryResponse> {
  const qs = new URLSearchParams();
  if (query.repo) qs.set("repo", query.repo);
  if (query.limit) qs.set("limit", String(query.limit));
  let url = `${OPERATIONS_BASE}/releases`;
  if (qs.toString()) url += `?${qs.toString()}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ReleaseHistoryResponse>(res, `GET ${url}`);
}
