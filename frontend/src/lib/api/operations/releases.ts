/**
 * `/operations/releases` — the runner-publishing (GitHub Releases) surface of
 * coord's Xi_Release sub-space, for the `/admin/coord/releases` dashboard.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5, Phase 7). The web backend proxies `GET /releases[/{tag}]`
 * (`backend/app/api/v1/endpoints/operations/__init__.py`), forwarding the
 * operator's Cognito bearer to coord's `GET /coord/twin/release/history`; the
 * frontend never talks to coord directly.
 *
 * Types mirror the coord history contract verbatim (snake_case) — they are the
 * on-the-wire shape (Phase 1). Keep them in sync with coord's emitter.
 *
 * Every function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE`
 * with its URL inline, states its retry policy, and returns the PARSED body
 * through `readJson`. A non-2xx rejects with
 * `<METHOD> <url> failed: <status> - <body>`.
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
   * its inline error banner on the thrown `httpClient` error today, but the
   * field is typed so a future stale-while-revalidate proxy can set it.
   */
  coord_error?: string;
}

/**
 * `GET /releases` — runner release observations, newest first.
 *
 * `query.repo` selects the observed surface (default coord's
 * `qontinui/qontinui-runner`); `query.limit` caps the history window (1-500).
 * `options` is the per-request `httpClient` options; a polling caller passes
 * `COORD_DASHBOARD_POLL_OPTIONS` so a 5xx costs one request.
 */
export async function fetchReleaseHistory(
  query?: { repo?: string; limit?: number },
  options?: HttpOptions
): Promise<ReleaseHistoryResponse> {
  const p = new URLSearchParams();
  if (query?.repo) p.set("repo", query.repo);
  if (query?.limit) p.set("limit", String(query.limit));
  const qs = p.toString();
  const url = `${OPERATIONS_BASE}/releases${qs ? `?${qs}` : ""}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ReleaseHistoryResponse>(res, `GET ${url}`);
}

/**
 * `GET /releases/{tag}` — a single release observation. Coord has no
 * single-tag route; the web proxy filters the history list server-side and
 * 404s (`release_tag_not_found`) when no entry matches.
 */
export async function fetchRelease(
  tag: string,
  query?: { repo?: string }
): Promise<ReleaseHistoryEntry> {
  const p = new URLSearchParams();
  if (query?.repo) p.set("repo", query.repo);
  const qs = p.toString();
  const url = `${OPERATIONS_BASE}/releases/${encodeURIComponent(tag)}${
    qs ? `?${qs}` : ""
  }`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ReleaseHistoryEntry>(res, `GET ${url}`);
}
