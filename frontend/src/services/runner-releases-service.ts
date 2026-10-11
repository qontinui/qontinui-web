/**
 * Runner releases service — the runner-publishing (GitHub Releases) surface of
 * coord's Ξ_Release sub-space, for the `/admin/coord/releases` dashboard.
 *
 * Thin class over the typed `/operations` client
 * (`lib/api/operations/runnerReleases.ts`), which owns the URLs and the wire
 * types; the web backend proxy forwards the operator's Cognito bearer to
 * coord's `GET /coord/twin/release/history`. The frontend never talks to coord
 * directly.
 */

import type { HttpOptions } from "./http-client";
import {
  fetchReleaseEntry,
  fetchReleaseHistory,
  type ReleaseDriftClass,
  type ReleaseHistoryEntry,
  type ReleaseHistoryResponse,
} from "@/lib/api/operations/runnerReleases";

export type { ReleaseDriftClass, ReleaseHistoryEntry, ReleaseHistoryResponse };

class RunnerReleasesService {
  /**
   * List runner release observations (newest-first) from coord via the web
   * proxy. Throws on a non-2xx response (the rejection embeds the status).
   *
   * `opts.repo` selects the observed surface (default coord's
   * `qontinui/qontinui-runner`); `opts.limit` caps the history window (1–500).
   * `httpOptions` is the per-request `httpClient` options; a polling caller
   * passes `COORD_DASHBOARD_POLL_OPTIONS` so a 5xx costs one request.
   */
  async list(
    opts?: {
      repo?: string;
      limit?: number;
    },
    httpOptions?: HttpOptions
  ): Promise<ReleaseHistoryResponse> {
    return fetchReleaseHistory(opts, httpOptions);
  }

  /**
   * Fetch a single release observation by `tag`. Coord has no single-tag
   * route; the web proxy filters the history list server-side and 404s
   * (`release_tag_not_found`) when no entry matches.
   */
  async get(
    tag: string,
    opts?: { repo?: string }
  ): Promise<ReleaseHistoryEntry> {
    return fetchReleaseEntry(tag, opts);
  }
}

export const runnerReleasesService = new RunnerReleasesService();
