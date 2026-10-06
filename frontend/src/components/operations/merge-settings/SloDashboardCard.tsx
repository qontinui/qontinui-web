"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { MergeEnabledControl } from "./MergeEnabledControl";
import { MergeEnabledBadge, pinChoice } from "./pinChoice";
import { fmtRate, fmtSecs, ratingColor, ratingColorInverse } from "./format";
import type { RepoSlo, SloResponse } from "./types";

function SloRepoCard({
  slo,
  tenantPaused,
  onChanged,
}: {
  slo: RepoSlo;
  tenantPaused: boolean;
  onChanged: () => void;
}) {
  const w = slo.windows.last_7d;
  const w30 = slo.windows.last_30d;
  return (
    <Card data-testid={`slo-repo-card-${slo.repo}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{slo.repo}</span>
          <MergeEnabledBadge
            enabled={slo.merge_enabled}
            pin={pinChoice(slo.merge_enabled_override)}
            tenantPaused={tenantPaused}
            testId={`slo-merge-enabled-badge-${slo.repo}`}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground">Auto-merge success</p>
            <p className={ratingColor(w.auto_merge_success_rate, 0.95, 0.85)}>
              {fmtRate(w.auto_merge_success_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Operator override</p>
            <p
              className={ratingColorInverse(
                w.operator_override_rate,
                0.05,
                0.1
              )}
            >
              {fmtRate(w.operator_override_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Escalation</p>
            <p className={ratingColorInverse(w.escalation_rate, 0.1, 0.25)}>
              {fmtRate(w.escalation_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Verify lag p95</p>
            <p className="text-foreground">
              {fmtSecs(w.post_merge_verification_lag_p95_seconds)}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground pt-1 border-t border-border/40">
          {w.total_decisions} decision(s) in 7d / {w30.total_decisions} in 30d.
        </p>
        <CoordAdminOnly>
          <MergeEnabledControl
            repo={slo.repo}
            resolved={slo.merge_enabled}
            pin={pinChoice(slo.merge_enabled_override)}
            tenantPaused={tenantPaused}
            onChanged={onChanged}
          />
        </CoordAdminOnly>
      </CardContent>
    </Card>
  );
}

export function SloDashboardCard({
  data,
  tenantPaused,
  onChanged,
}: {
  data: SloResponse | null;
  tenantPaused: boolean;
  onChanged: () => void;
}) {
  if (data === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            SLO Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="slo-dashboard-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            SLO Dashboard
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {data.repos.length} repo(s)
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Per-(tenant, repo) merge metrics, 7-day windows. Thresholds from plan
          §8: ≥95% auto-merge success / ≤5% operator override. Each card&apos;s
          badge is the repo&apos;s resolved merge posture, marked{" "}
          <em>pinned</em> or <em>inherited</em>.
        </p>
      </CardHeader>
      <CardContent>
        {data.repos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repos onboarded yet. Connect a repo via the Onboarding wizard.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.repos.map((r) => (
              <SloRepoCard
                key={r.repo}
                slo={r}
                tenantPaused={tenantPaused}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
        {data.kill_switch_history_last_30d.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <p className="text-xs font-medium mb-2">
              Kill switch history (last 30d)
            </p>
            <ul className="space-y-1 text-xs">
              {data.kill_switch_history_last_30d.slice(0, 5).map((h, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-mono text-foreground">
                    {new Date(h.fired_at).toISOString().slice(0, 19)}Z
                  </span>{" "}
                  — scope=<code>{h.scope}</code>
                  {h.reason && ` — ${h.reason}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
