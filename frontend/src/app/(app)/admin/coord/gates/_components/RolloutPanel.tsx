"use client";

/**
 * RolloutPanel — auto-merge per-repo enablement chips (enabled/disabled)
 * + the feature-enablement tier list (name, tier chip, source, threshold).
 *
 * The auto-merge buckets used to be the `live`/`shadow`/`dry_run` tri-state and
 * had gone stale-by-construction: nothing wrote `rollout_state` after Phase 2-4
 * of plan
 * `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`, so a
 * repo whose merges were switched off still showed under `live` forever. Phase 5
 * dropped the column and repointed coord's `auto_merge` block at the resolved
 * `merge_enabled` axis, which is what the engine and the land seam actually
 * gate on — so these buckets are live again rather than decorative.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitMerge, ToggleLeft } from "lucide-react";
import type {
  FeatureRollout,
  FeatureTier,
  RolloutOverview,
} from "@/services/admin-dev-service";

type ChipTone = "default" | "secondary" | "destructive" | "outline";

function tierTone(tier: FeatureTier): ChipTone {
  if (tier === "live") return "default";
  if (tier === "shadow") return "secondary";
  return "outline"; // off
}

const STATE_LABEL = {
  enabled: "enabled",
  disabled: "disabled",
} as const;

const STATE_TONE: Record<keyof typeof STATE_LABEL, ChipTone> = {
  enabled: "default",
  disabled: "destructive",
};

function RepoStateGroup({
  state,
  repos,
}: {
  state: keyof typeof STATE_LABEL;
  repos: string[];
}) {
  return (
    <div data-testid={`rollout-automerge-${state}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Badge variant={STATE_TONE[state]} className="uppercase tracking-wide">
          {STATE_LABEL[state]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {repos.length} repo{repos.length === 1 ? "" : "s"}
        </span>
      </div>
      {repos.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">none</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {repos.map((repo) => (
            <Badge
              key={repo}
              variant="outline"
              className="font-mono text-[11px]"
            >
              {repo}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function RolloutPanel({ rollouts }: { rollouts: RolloutOverview }) {
  const { auto_merge, features } = rollouts;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      data-testid="rollout-panel"
    >
      {/* ---- Auto-merge per-repo enablement ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4" />
            Auto-merge enablement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* RESOLVED posture, not the raw pin: coord folds the dominant
              tenant-wide `merge_paused` pause into each repo before bucketing,
              so a paused tenant's repos all land under `disabled`. To see
              WHICH lever put a repo there — a per-repo pin or the tenant
              pause — use /admin/coord/merge-settings, which renders the
              resolved value alongside the raw override. */}
          <RepoStateGroup state="enabled" repos={auto_merge.enabled} />
          <RepoStateGroup state="disabled" repos={auto_merge.disabled} />
        </CardContent>
      </Card>

      {/* ---- Feature enablement tiers ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ToggleLeft className="h-4 w-4" />
            Feature enablement
            <Badge variant="outline" className="ml-1">
              {features.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No feature flags reported.
            </p>
          ) : (
            <ul
              className="divide-y divide-border"
              data-testid="rollout-features"
            >
              {features.map((f: FeatureRollout) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="rollout-feature-row"
                >
                  <div className="min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      title={f.name}
                    >
                      {f.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      source: {f.source}
                      {f.threshold != null && <> · threshold: {f.threshold}</>}
                    </div>
                  </div>
                  <Badge
                    variant={tierTone(f.tier)}
                    className="uppercase shrink-0"
                  >
                    {f.tier}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
