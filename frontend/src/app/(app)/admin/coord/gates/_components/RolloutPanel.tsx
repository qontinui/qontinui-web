"use client";

/**
 * RolloutPanel — feature-enablement tier list (name, tier chip, source,
 * threshold).
 *
 * The per-repo auto-merge tri-state chips (live/shadow/dry_run) that used to
 * live here were deleted in coord plan
 * `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`
 * Phase 5 — coord no longer writes `rollout_state`, and the real per-repo
 * merge posture (pinned + resolved) lives at /admin/coord/merge-settings.
 * The top-of-page enabled/disabled tally in `SummaryCards` covers the
 * at-a-glance count; this panel does not duplicate the per-repo detail.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleLeft } from "lucide-react";
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

export function RolloutPanel({ rollouts }: { rollouts: RolloutOverview }) {
  const { features } = rollouts;

  return (
    <Card data-testid="rollout-panel">
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
  );
}
