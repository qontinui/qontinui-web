"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { UNKNOWN_AMBER } from "@/components/console";
import { MergeEnabledControl } from "./MergeEnabledControl";
import { MergeEnabledBadge, pinChoice } from "./pinChoice";
import { fmtRate, fmtSecs, ratingColor, ratingColorInverse } from "./format";
import type { RepoSlo, SloResponse } from "@/lib/api/operations/prMerge";
import {
  STRUCTURALLY_ZERO_LABEL,
  STRUCTURALLY_ZERO_TITLE,
  describeOperatorTouchSlo,
  structurallyZeroSet,
  type TouchWindowView,
} from "../operatorTouchSlo";

/**
 * A per-repo metric coord says has no live writer — its value is 0 by
 * construction, so it is rendered muted, labelled, and never threshold-coloured
 * (a green "0.0%" override rate reads as a measured success).
 */
function StructurallyZeroValue({
  metric,
  value,
}: {
  metric: string;
  value: number | null;
}) {
  return (
    <p
      className="text-muted-foreground"
      title={STRUCTURALLY_ZERO_TITLE}
      data-testid={`slo-structurally-zero-${metric}`}
    >
      {fmtRate(value)} (7d){" "}
      <Badge variant="outline" className="ml-1 text-[10px] font-normal border-dashed">
        {STRUCTURALLY_ZERO_LABEL}
      </Badge>
    </p>
  );
}

function SloRepoCard({
  slo,
  tenantPaused,
  onChanged,
  structurallyZero,
}: {
  slo: RepoSlo;
  tenantPaused: boolean;
  onChanged: () => void;
  structurallyZero: ReadonlySet<string>;
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
            {structurallyZero.has("operator_override_rate") ? (
              <StructurallyZeroValue
                metric="operator_override_rate"
                value={w.operator_override_rate}
              />
            ) : (
              <p
                className={ratingColorInverse(
                  w.operator_override_rate,
                  0.05,
                  0.1
                )}
              >
                {fmtRate(w.operator_override_rate)} (7d)
              </p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Escalation</p>
            {structurallyZero.has("escalation_rate") ? (
              <StructurallyZeroValue
                metric="escalation_rate"
                value={w.escalation_rate}
              />
            ) : (
              <p className={ratingColorInverse(w.escalation_rate, 0.1, 0.25)}>
                {fmtRate(w.escalation_rate)} (7d)
              </p>
            )}
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

/** One window's phrase, styled by whether it is a measurement at all. */
function TouchWindowText({
  label,
  view,
  testId,
}: {
  label: string;
  view: TouchWindowView;
  testId: string;
}) {
  return (
    <span
      className="min-w-0 truncate"
      title={view.title}
      data-testid={testId}
      data-touch-state={view.state}
    >
      <span className="text-muted-foreground">{label} </span>
      <span
        className={
          view.state === "measured"
            ? "text-foreground"
            : view.state === "unknown"
              ? `rounded border px-1 ${UNKNOWN_AMBER}`
              : "text-muted-foreground italic"
        }
      >
        {view.text}
      </span>
    </span>
  );
}

/**
 * The tenant-level operator-touch line — the SLO Dashboard's one LIVE measure
 * of interruptions. Touches carry no repo, so it is one line above the repo
 * cards, never a tile duplicated into each of them. Not-yet-measured and
 * unknown are said in words; neither is ever a zero.
 */
function OperatorTouchSloStrip({ data }: { data: SloResponse }) {
  const view = describeOperatorTouchSlo(data.operator_touch);
  return (
    <div
      className="mb-3 flex items-center gap-3 flex-wrap rounded-md border border-border bg-card/30 px-3 py-2 text-xs"
      data-testid="slo-operator-touch-strip"
    >
      <span className="font-medium shrink-0">
        Operator touches{" "}
        <span className="font-normal text-muted-foreground">
          (tenant-wide, live)
        </span>
      </span>
      <TouchWindowText
        label="7d"
        view={view.last7d}
        testId="slo-operator-touch-7d"
      />
      <TouchWindowText
        label="30d"
        view={view.last30d}
        testId="slo-operator-touch-30d"
      />
      <Link
        href="/admin/coord/operator-touches"
        className="ml-auto shrink-0 text-primary hover:underline"
        data-testid="slo-operator-touch-link"
      >
        Where they come from →
      </Link>
    </div>
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
  const structurallyZero = structurallyZeroSet(data?.structurally_zero);
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
          <em>pinned</em> or <em>inherited</em>. A tile marked{" "}
          <em>{STRUCTURALLY_ZERO_LABEL}</em> has no live source and reads 0 by
          construction; the operator-touch line is the live interruption rate.
        </p>
      </CardHeader>
      <CardContent>
        <OperatorTouchSloStrip data={data} />
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
                structurallyZero={structurallyZero}
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
