"use client";

/**
 * RolloutPanel — auto-merge per-repo tri-state chips (live/shadow/dry_run)
 * + the feature-enablement tier list (name, tier chip, source, threshold).
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
  live: "live",
  shadow: "shadow",
  dry_run: "dry-run",
} as const;

const STATE_TONE: Record<keyof typeof STATE_LABEL, ChipTone> = {
  live: "default",
  shadow: "secondary",
  dry_run: "outline",
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
            <Badge key={repo} variant="outline" className="font-mono text-[11px]">
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="rollout-panel">
      {/* ---- Auto-merge per-repo tri-state ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4" />
            Auto-merge rollout
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RepoStateGroup state="live" repos={auto_merge.live} />
          <RepoStateGroup state="shadow" repos={auto_merge.shadow} />
          <RepoStateGroup state="dry_run" repos={auto_merge.dry_run} />
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
            <ul className="divide-y divide-border" data-testid="rollout-features">
              {features.map((f: FeatureRollout) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="rollout-feature-row"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" title={f.name}>
                      {f.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      source: {f.source}
                      {f.threshold != null && (
                        <> · threshold: {f.threshold}</>
                      )}
                    </div>
                  </div>
                  <Badge variant={tierTone(f.tier)} className="uppercase shrink-0">
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
