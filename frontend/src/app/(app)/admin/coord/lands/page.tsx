"use client";

/**
 * /admin/coord/lands — Push/Land effect-signatures operator dashboard.
 *
 * Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 —
 * pre-land impact preview surface. Three sections:
 *
 *   1. Preview panel: repo + PR inputs → pre-land PredictedLandEffect
 *      (cascade extent, conflicts, expected CI/deploys, main-merge overlap,
 *      inferred prior) + the risk verdict, prominently.
 *   2. Recent lands: declared lands newest-first with their composed
 *      verification verdict + per-dimension row + coverage.
 *   3. Calibration: per-dimension predictor precision/recall (nulls →
 *      "no data yet", never a fabricated 0/100%).
 *
 * Coord base URL + operator auth are reused exactly as the sibling coord
 * pages (git-ops / plans): `httpClient.get` hits the web backend at
 * `/api/v1/operations/*`, which forwards the operator's Cognito bearer to
 * coord (`settings.COORD_URL`) via the new lands proxy block in
 * `operations.py`. The frontend never talks to coord directly.
 *
 * The lands list + calibration auto-refresh on a 30s poll. The preview is
 * an explicit operator action (it targets a specific PR), so it does not
 * poll — re-run via the Preview button.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Anchor, RefreshCw, Search } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import {
  LandCard,
  type LandRow,
} from "@/components/admin/coord/LandCard";
import {
  LandPreviewPanel,
  type LandPreviewResponse,
} from "@/components/admin/coord/LandPreviewPanel";
import {
  LandPrecisionPanel,
  type PrecisionResponse,
} from "@/components/admin/coord/LandPrecisionPanel";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

interface LandsResponse {
  lands?: LandRow[] | null;
}

/**
 * Pull the HTTP status out of an `httpClient` error. `httpClient.get` throws
 * `Error("GET <url> failed: <status> - <body>")`; we parse the status so the
 * preview can render 404/422/coord-down as distinct inline messages.
 */
function statusFromError(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/failed:\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

function previewErrorMessage(e: unknown, repo: string, pr: string): string {
  const status = statusFromError(e);
  if (status === 404) {
    return `PR not found: no open PR #${pr} in ${repo}.`;
  }
  if (status === 422) {
    return `Invalid input — check the repo (owner/name) and PR number.`;
  }
  if (status === 502) {
    return "Coord is not reachable. Try again shortly.";
  }
  if (status === 504) {
    return "Coord timed out building the preview. Try again shortly.";
  }
  return e instanceof Error ? e.message : String(e);
}

export default function CoordLandsPage() {
  // ---- Preview state ----
  const [repoInput, setRepoInput] = useState("");
  const [prInput, setPrInput] = useState("");
  const [preview, setPreview] = useState<LandPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ---- Recent lands state ----
  const [landsRepoFilter, setLandsRepoFilter] = useState("");
  const [lands, setLands] = useState<LandRow[]>([]);
  const [landsLoading, setLandsLoading] = useState(true);
  const [landsError, setLandsError] = useState<string | null>(null);

  // ---- Calibration state ----
  const [precision, setPrecision] = useState<PrecisionResponse | null>(null);
  const [precisionLoading, setPrecisionLoading] = useState(true);
  const [precisionError, setPrecisionError] = useState<string | null>(null);

  // ---- Preview action ----
  const runPreview = useCallback(async () => {
    const repo = repoInput.trim();
    const pr = prInput.trim();
    if (!repo || !pr) {
      setPreviewError("Enter a repo (owner/name) and a PR number.");
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = new URLSearchParams({ repo, pr });
      const body = await httpClient.get<LandPreviewResponse>(
        `${API}/lands/preview?${qs.toString()}`
      );
      setPreview(body);
    } catch (e) {
      setPreview(null);
      setPreviewError(previewErrorMessage(e, repo, pr));
    } finally {
      setPreviewLoading(false);
    }
  }, [repoInput, prInput]);

  // ---- Recent lands fetch (polled) ----
  const fetchLands = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (landsRepoFilter.trim()) qs.set("repo", landsRepoFilter.trim());
      qs.set("limit", "25");
      const body = await httpClient.get<LandsResponse>(
        `${API}/lands?${qs.toString()}`
      );
      setLands(body.lands ?? []);
      setLandsError(null);
    } catch (e) {
      setLandsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLandsLoading(false);
    }
  }, [landsRepoFilter]);

  // ---- Calibration fetch (polled) ----
  const fetchPrecision = useCallback(async () => {
    try {
      const body = await httpClient.get<PrecisionResponse>(
        `${API}/lands/precision`
      );
      setPrecision(body);
      setPrecisionError(null);
    } catch (e) {
      setPrecisionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrecisionLoading(false);
    }
  }, []);

  useEffect(() => {
    setLandsLoading(true);
    fetchLands();
    const id = setInterval(fetchLands, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchLands]);

  useEffect(() => {
    setPrecisionLoading(true);
    fetchPrecision();
    const id = setInterval(fetchPrecision, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchPrecision]);

  // Newest-first (coord may already sort; we guard here so the contract is
  // explicit and the list is stable regardless of coord ordering).
  const sortedLands = useMemo(() => {
    return [...lands].sort((a, b) =>
      (b.signature.created_at ?? "").localeCompare(
        a.signature.created_at ?? ""
      )
    );
  }, [lands]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-lands-page">
      {/* ---- 1. Preview panel ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Anchor className="h-4 w-4" />
            Pre-land impact preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runPreview();
            }}
            data-testid="coord-lands-preview-form"
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Repo (owner/name)
              </label>
              <Input
                placeholder="qontinui/qontinui-coord"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                className="w-64"
                data-testid="coord-lands-preview-repo"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">PR number</label>
              <Input
                placeholder="123"
                inputMode="numeric"
                value={prInput}
                onChange={(e) => setPrInput(e.target.value)}
                className="w-28"
                data-testid="coord-lands-preview-pr"
              />
            </div>
            <Button
              type="submit"
              disabled={previewLoading}
              data-testid="coord-lands-preview-btn"
            >
              <Search className="h-3.5 w-3.5 mr-1" />
              {previewLoading ? "Predicting…" : "Preview"}
            </Button>
          </form>

          {previewError && (
            <p
              className="text-sm text-destructive"
              data-testid="coord-lands-preview-error"
            >
              {previewError}
            </p>
          )}

          {previewLoading && !preview ? (
            <Skeleton className="h-40 w-full" />
          ) : preview ? (
            <LandPreviewPanel preview={preview} />
          ) : (
            !previewError && (
              <p className="text-sm text-muted-foreground italic">
                Enter a repo and PR number to predict the land&apos;s impact
                before approving it.
              </p>
            )
          )}
        </CardContent>
      </Card>

      {/* ---- 2. Recent lands ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Anchor className="h-4 w-4" />
            Recent declared lands
            <Badge variant="outline" className="ml-1">
              {sortedLands.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by repo (owner/name)"
              value={landsRepoFilter}
              onChange={(e) => setLandsRepoFilter(e.target.value)}
              className="w-64"
              data-testid="coord-lands-repo-filter"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchLands}
              data-testid="coord-lands-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {landsError && (
            <p className="text-sm text-destructive">
              Failed to load: {landsError}
            </p>
          )}

          {landsLoading && lands.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : sortedLands.length > 0 ? (
            <div className="space-y-2">
              {sortedLands.map((row) => (
                <LandCard key={row.signature.id} row={row} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No declared lands
              {landsRepoFilter.trim() ? ` for ${landsRepoFilter.trim()}` : ""}{" "}
              yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- 3. Calibration ---- */}
      {precisionError && (
        <p className="text-sm text-destructive">
          Failed to load calibration: {precisionError}
        </p>
      )}
      <LandPrecisionPanel data={precision} loading={precisionLoading} />
    </div>
  );
}
