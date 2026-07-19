"use client";

/**
 * ReleaseCard — render a single observed runner release (the GitHub-Releases
 * surface of coord's Ξ_Release sub-space) with its drift verdict and, on
 * demand, the drill-down: build/CI state, published assets, the Windows
 * hard-gate presence badges (`-setup.exe` + `latest.json`), published_at, and
 * draft/prerelease flags.
 *
 * Plan `twin-runner-release-surface` Phase 2 — the "recent releases" history
 * element on `/admin/coord/releases`. Mirrors `DeployCard` / `LandCard` (its
 * deploy/land siblings) and reuses the same D3 color ladder so the drift-state
 * color language cannot drift between the three surfaces.
 *
 * Wire shape mirrors coord's `/coord/twin/release/history` entry (snake_case
 * serde) via `ReleaseHistoryEntry`. Rendered defensively (optional chaining +
 * fallbacks) because coord may grow the observed field set.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FileJson,
  Package,
  Tag,
} from "lucide-react";
import type { ReleaseHistoryEntry } from "@/services/runner-releases-service";

// ---- Drift-state → tone + label ------------------------------------------
//
// The runner surface's canonical drift class (`none` / `pending` /
// `active_negation` / `unknown`) plus its namespaced `release:*` sub-class map
// to one calm-green / amber / loud-red / muted-grey ladder — matching the
// DeployStatusStrip tone language. Exported + unit-tested so this contract
// can't silently drift from coord's taxonomy.

export type ReleaseBadgeTone =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/** The surface's operational state, normalized from the drift descriptor. */
export type ReleaseState =
  | "in_sync"
  | "in_flight"
  | "stale"
  | "failed_deploy"
  | "rolled_back"
  | "unknown";

/**
 * Resolve the operational state from an entry. `in_sync` short-circuits;
 * otherwise the `release:*` sub-class (preferred, stripped of its prefix) or
 * the surface `token` names the state, with the canonical class as a last
 * fallback. Tolerant of either the namespaced or bare form.
 */
export function releaseState(entry: ReleaseHistoryEntry): ReleaseState {
  if (entry.in_sync) return "in_sync";
  const raw = (entry.drift_class?.subclass ?? entry.drift_class?.token ?? "")
    .toString()
    .replace(/^release:/, "");
  switch (raw) {
    case "in_sync":
      return "in_sync";
    case "in_flight":
      return "in_flight";
    case "stale":
      return "stale";
    case "failed_deploy":
      return "failed_deploy";
    case "rolled_back":
      return "rolled_back";
  }
  const canonical = entry.drift_class?.canonical;
  if (canonical === "none") return "in_sync";
  if (canonical === "active_negation") return "rolled_back";
  return "unknown";
}

const STATE_META: Record<ReleaseState, { tone: ReleaseBadgeTone; label: string }> =
  {
    in_sync: { tone: "success", label: "in sync" },
    in_flight: { tone: "warning", label: "in flight" },
    // A tag past its build window with nothing published — genuinely stuck.
    stale: { tone: "destructive", label: "stale" },
    // The v1.0.0/v1.0.1 case: draft stuck because the Windows hard-gate failed.
    failed_deploy: { tone: "destructive", label: "stuck draft" },
    rolled_back: { tone: "destructive", label: "rolled back" },
    unknown: { tone: "secondary", label: "unknown" },
  };

export function releaseDriftTone(entry: ReleaseHistoryEntry): ReleaseBadgeTone {
  return STATE_META[releaseState(entry)].tone;
}

export function releaseDriftLabel(entry: ReleaseHistoryEntry): string {
  return STATE_META[releaseState(entry)].label;
}

// ---- Helpers --------------------------------------------------------------

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** `lag_seconds` → "Nm" / "Nh Nm". null/≤0 → "". */
function lagLabel(lagSeconds: number | null | undefined): string {
  if (
    typeof lagSeconds !== "number" ||
    !Number.isFinite(lagSeconds) ||
    lagSeconds <= 0
  ) {
    return "";
  }
  const mins = Math.floor(lagSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return remM ? `${hrs}h ${remM}m` : `${hrs}h`;
}

// ---- Card -----------------------------------------------------------------

export function ReleaseCard({ entry }: { entry: ReleaseHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  const displayTag = entry.tag ?? entry.version ?? entry.published_tag ?? "—";
  const tone = releaseDriftTone(entry);
  const label = releaseDriftLabel(entry);
  const lag = lagLabel(entry.lag_seconds);
  const assets = entry.assets ?? [];

  return (
    <Card data-testid="coord-release-card">
      <CardContent className="p-4 space-y-2.5">
        {/* Header: version/tag + drift badge + flags */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm">{displayTag}</span>
          </span>
          {entry.prerelease && (
            <Badge variant="outline" className="text-[10px] uppercase">
              beta
            </Badge>
          )}
          {entry.draft_present && (
            <Badge variant="warning" className="text-[10px] uppercase">
              draft
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant={tone} data-testid="coord-release-drift-badge">
              {label}
            </Badge>
          </div>
        </div>

        {/* Asset presence + CI state line */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge
            variant={entry.has_setup_exe ? "success" : "outline"}
            className="inline-flex items-center gap-1 text-[10px]"
            data-testid="coord-release-setup-exe-badge"
          >
            <FileDown className="h-3 w-3" />
            {entry.has_setup_exe ? "setup.exe" : "no setup.exe"}
          </Badge>
          <Badge
            variant={entry.has_latest_json ? "success" : "outline"}
            className="inline-flex items-center gap-1 text-[10px]"
            data-testid="coord-release-latest-json-badge"
          >
            <FileJson className="h-3 w-3" />
            {entry.has_latest_json ? "latest.json" : "no latest.json"}
          </Badge>
          {entry.ci_state && (
            <span className="text-muted-foreground font-mono">
              CI {entry.ci_state}
            </span>
          )}
          {lag && (
            <span className="text-amber-700 dark:text-amber-400 tabular-nums">
              {lag} behind
            </span>
          )}
        </div>

        {/* Meta line: published + observed + coverage */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          {entry.published_at && (
            <span>published {formatTime(entry.published_at)}</span>
          )}
          {entry.observed_at && (
            <span>observed {formatTime(entry.observed_at)}</span>
          )}
          {typeof entry.coverage === "number" && (
            <span data-testid="coord-release-coverage">
              coverage {Math.round(entry.coverage * 100)}%
            </span>
          )}
          {typeof entry.credibility === "number" && (
            <span>credibility {Math.round(entry.credibility * 100)}%</span>
          )}
        </div>

        {/* Drill-down: assets list (+ raw deploy outcome when present) */}
        {(assets.length > 0 || entry.deploy_outcome_raw) && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              data-testid="coord-release-expand-btn"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {assets.length} asset{assets.length === 1 ? "" : "s"}
            </Button>
            {expanded && (
              <div
                className="mt-2 rounded border border-border p-2 space-y-1"
                data-testid="coord-release-drilldown"
              >
                {assets.length > 0 ? (
                  <ul className="space-y-0.5">
                    {assets.map((asset) => (
                      <li
                        key={asset}
                        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground"
                      >
                        <Tag className="h-3 w-3 shrink-0" />
                        <span className="truncate">{asset}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No published assets observed.
                  </p>
                )}
                {entry.deploy_outcome_raw && (
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">
                    {entry.deploy_outcome_raw}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
