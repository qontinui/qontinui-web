"use client";

/**
 * /admin/coord/releases — Runner publishing (GitHub Releases) dashboard.
 *
 * Plan `twin-runner-release-surface` Phase 2 — the operator read surface over
 * coord's release observer: runner installer publishing is the GitHub-Releases
 * surface of the existing Ξ_Release sub-space. This page lists observed
 * releases newest-first with the drift verdict (in sync / in flight / stale /
 * stuck draft / rolled back), the Windows hard-gate asset presence
 * (`-setup.exe` + `latest.json`), CI/build state, published_at, and
 * draft/prerelease flags — so a release silently stuck as a draft (the
 * v1.0.0/v1.0.1 case) is an observable drift instead of a manual discovery.
 *
 * Coord base URL + operator auth are reused exactly as the deploys/lands
 * siblings: `httpClient.get` (via `runnerReleasesService`) hits the web
 * backend at `/api/v1/operations/releases`, which forwards the operator's
 * Cognito bearer to coord. The frontend never talks to coord directly.
 *
 * The list auto-refreshes on a 30s poll (mirrors the deploys page) — a release
 * legitimately sits `in flight` for the ~2h runner build, and the poll shows
 * it settle to `in sync` (or a stuck-draft `failed_deploy`) without a manual
 * refresh.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Package, RefreshCw } from "lucide-react";
import { ReleaseCard } from "@/components/admin/coord/ReleaseCard";
import {
  runnerReleasesService,
  type ReleaseHistoryEntry,
} from "@/services/runner-releases-service";

const POLL_INTERVAL_MS = 30_000;
const REPO_DEBOUNCE_MS = 400;

export default function CoordReleasesPage() {
  const [repoFilter, setRepoFilter] = useState("");
  // The repo actually fetched — debounced off `repoFilter` so typing a repo
  // name doesn't fire a coord round-trip (and reset the poll) per keystroke.
  const [appliedRepo, setAppliedRepo] = useState("");
  // Bumped by the refresh button / Enter to force an immediate reload even when
  // `appliedRepo` is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [releases, setReleases] = useState<ReleaseHistoryEntry[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the filter → applied repo.
  useEffect(() => {
    const id = setTimeout(
      () => setAppliedRepo(repoFilter.trim()),
      REPO_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [repoFilter]);

  // Apply the current filter immediately (refresh button / Enter), bypassing
  // the debounce and forcing a reload via the nonce.
  const refreshNow = useCallback(() => {
    setAppliedRepo(repoFilter.trim());
    setReloadNonce((n) => n + 1);
  }, [repoFilter]);

  // Fetch + poll for the applied repo. A per-run `ignore` guard drops a stale
  // response, so an earlier slow request can never overwrite a newer one.
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const body = await runnerReleasesService.list({
          limit: 100,
          ...(appliedRepo ? { repo: appliedRepo } : {}),
        });
        if (ignore) return;
        setReleases(body.history ?? []);
        setTarget(body.target ?? null);
        setError(body.coord_error ?? null);
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [appliedRepo, reloadNonce]);

  // Newest-first by observed_at (coord already sorts; guarded here so the
  // contract is explicit and stable regardless of coord ordering).
  const sorted = useMemo(() => {
    return [...releases].sort((a, b) =>
      (b.observed_at ?? "").localeCompare(a.observed_at ?? "")
    );
  }, [releases]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-releases-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Runner releases
            <Badge variant="outline" className="ml-1">
              {sorted.length}
            </Badge>
            {target && (
              <span className="text-xs font-normal text-muted-foreground font-mono">
                {target}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by repo (e.g. qontinui/qontinui-runner)"
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") refreshNow();
              }}
              className="w-72"
              data-testid="coord-releases-repo-filter"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={refreshNow}
              data-testid="coord-releases-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && releases.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : sorted.length > 0 ? (
            <div className="space-y-2">
              {sorted.map((entry) => (
                <ReleaseCard
                  key={`${entry.tag ?? entry.version ?? "rel"}-${entry.observed_at ?? ""}`}
                  entry={entry}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No observed releases
              {repoFilter.trim() ? ` for ${repoFilter.trim()}` : ""} yet. Coord
              observes GitHub Releases (webhook + poll) for the runner installer
              surface; a published release with its `-setup.exe` and
              `latest.json` assets appears here once observed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
