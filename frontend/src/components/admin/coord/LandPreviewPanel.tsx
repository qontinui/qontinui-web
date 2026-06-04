"use client";

/**
 * LandPreviewPanel — pre-land impact preview for a proposed/queued PR.
 *
 * Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 §1.
 *
 * Renders the full `PredictedLandEffect` for a (repo, pr): cascade extent +
 * dependent refs + per-conflict chips (paths / auto-resolvable / affected
 * agents), expected CI workflows with confidence bands rendered HONESTLY
 * (a wide band reads as visibly uncertain), expected deploys, the
 * main-merge-overlap warning, the inferred-prior note when applied, and the
 * risk verdict (risky + reasons) prominently.
 *
 * Everything is read defensively (optional chaining + fallbacks) because the
 * predicted-effect field set may grow — the plan calls for inspecting field
 * names at runtime rather than assuming them.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  History,
  Layers,
  Rocket,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import type {
  ConfidenceInterval,
  PredictedLandEffect,
} from "./LandCard";

export interface RiskVerdict {
  risky?: boolean | null;
  reasons?: string[] | null;
}

export interface LandPreviewResponse {
  action?: string | null;
  repo?: string | null;
  pr_number?: number | null;
  branch?: string | null;
  from_sha?: string | null;
  to_sha?: string | null;
  predicted?: PredictedLandEffect | null;
  risk?: RiskVerdict | null;
}

// ---- Confidence-interval helpers (testable) -------------------------------

/**
 * Normalize a confidence field — coord may send a bare number (a point
 * estimate) OR a `{ point, lower, upper }` interval. Returns a uniform
 * shape so the renderer doesn't branch on the wire form.
 */
export function normalizeConfidence(
  c?: ConfidenceInterval | number | null
): { point: number | null; lower: number | null; upper: number | null } {
  if (c === null || c === undefined) {
    return { point: null, lower: null, upper: null };
  }
  if (typeof c === "number") {
    return { point: c, lower: null, upper: null };
  }
  return {
    point: c.point ?? null,
    lower: c.lower ?? null,
    upper: c.upper ?? null,
  };
}

/**
 * The visual width [0,1] of a confidence interval = upper - lower, clamped.
 * Used to render a band whose width is the uncertainty. Returns null when the
 * interval has no bounds (a bare point estimate carries no width).
 *
 * Exported + unit-tested so "wide band = visibly uncertain" can't regress.
 */
export function confidenceBandWidth(
  c?: ConfidenceInterval | number | null
): number | null {
  const { lower, upper } = normalizeConfidence(c);
  if (lower === null || upper === null) return null;
  return Math.max(0, Math.min(1, upper - lower));
}

function pct(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

// ---- Confidence band sub-component ----------------------------------------

function ConfidenceBand({
  conf,
}: {
  conf?: ConfidenceInterval | number | null;
}) {
  const { point, lower, upper } = normalizeConfidence(conf);
  const width = confidenceBandWidth(conf);

  if (point === null && lower === null && upper === null) {
    return (
      <span className="text-xs text-muted-foreground italic">
        no estimate
      </span>
    );
  }

  // Bare point estimate (no bounds): show the point only.
  if (width === null) {
    return (
      <span className="text-xs tabular-nums" data-testid="land-confidence-point">
        {pct(point)}
      </span>
    );
  }

  const lo = lower ?? 0;
  const wide = width > 0.4;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="land-confidence-band"
      title={`${pct(lower)}–${pct(upper)}${
        point !== null ? ` (point ${pct(point)})` : ""
      }`}
    >
      <span className="relative h-2 w-24 rounded bg-muted overflow-hidden">
        <span
          className={
            "absolute inset-y-0 rounded " +
            (wide ? "bg-warning/70" : "bg-success/70")
          }
          style={{
            left: `${lo * 100}%`,
            width: `${width * 100}%`,
          }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {pct(lower)}–{pct(upper)}
      </span>
      {wide && (
        <Badge variant="warning" className="text-[10px] px-1 py-0">
          uncertain
        </Badge>
      )}
    </span>
  );
}

// ---- Conflict chip --------------------------------------------------------

function ConflictChip({
  conflict,
}: {
  conflict: {
    paths?: string[] | null;
    auto_resolvable?: boolean | null;
    affected_agents?: string[] | null;
  };
}) {
  const paths = conflict.paths ?? [];
  const agents = conflict.affected_agents ?? [];
  return (
    <div
      className="rounded border border-border p-2 space-y-1 text-xs"
      data-testid="land-conflict-chip"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {conflict.auto_resolvable ? (
          <Badge variant="success" className="text-[10px]">
            auto-resolvable
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[10px]">
            manual resolve
          </Badge>
        )}
        {paths.length > 0 ? (
          <span className="font-mono text-muted-foreground truncate">
            {paths.join(", ")}
          </span>
        ) : (
          <span className="text-muted-foreground italic">
            unspecified paths
          </span>
        )}
      </div>
      {agents.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-muted-foreground">affects:</span>
          {agents.map((a) => (
            <Badge key={a} variant="outline" className="text-[10px]">
              {a}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main panel -----------------------------------------------------------

export function LandPreviewPanel({
  preview,
}: {
  preview: LandPreviewResponse;
}) {
  const predicted = preview.predicted ?? {};
  const cascade = predicted.cascade ?? {};
  const dependentRefs = cascade.dependent_refs_to_restack ?? [];
  const conflicts = cascade.expected_conflicts ?? [];
  const workflows = predicted.ci?.workflows ?? [];
  const deploys = predicted.deploy?.services ?? [];
  const prior = predicted.inferred_prior ?? null;
  const risk = preview.risk ?? {};
  const riskReasons = risk.reasons ?? [];

  return (
    <div className="space-y-3" data-testid="coord-land-preview">
      {/* Risk verdict — prominent at top */}
      <Card
        className={
          risk.risky ? "border-destructive" : "border-success/60"
        }
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-2">
            {risk.risky ? (
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">
                  {risk.risky ? "Risky land" : "Land looks clean"}
                </span>
                <Badge
                  variant={risk.risky ? "destructive" : "success"}
                  data-testid="land-risk-badge"
                >
                  {risk.risky ? "risky" : "ok"}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {preview.repo}
                  {typeof preview.pr_number === "number" &&
                    ` #${preview.pr_number}`}
                </span>
              </div>
              {riskReasons.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground space-y-0.5">
                  {riskReasons.map((r, i) => (
                    <li key={i} data-testid="land-risk-reason">
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main-merge overlap warning */}
      {predicted.main_merge_overlap && (
        <div
          className="flex items-center gap-2 rounded border border-warning/60 bg-warning/10 px-3 py-2 text-sm"
          data-testid="land-main-merge-overlap"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          Overlaps an in-flight main merge — landing now may be reaped or
          serialized behind it.
        </div>
      )}

      {/* Cascade */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Cascade
            {typeof cascade.cascade_depth === "number" && (
              <Badge variant="outline" className="ml-1">
                depth {cascade.cascade_depth}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {dependentRefs.length} dependent ref
              {dependentRefs.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              completes cleanly:
            </span>
            <ConfidenceBand conf={cascade.will_complete_cleanly} />
          </div>

          {dependentRefs.length > 0 ? (
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="land-dependent-refs"
            >
              {dependentRefs.map((ref) => (
                <Badge
                  key={ref}
                  variant="outline"
                  className="font-mono text-[11px] inline-flex items-center gap-1"
                >
                  <GitBranch className="h-3 w-3" />
                  {ref}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No dependent refs — this land triggers no restack cascade.
            </p>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Predicted conflicts
              </p>
              {conflicts.map((c, i) => (
                <ConflictChip key={i} conflict={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CI workflows */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4" />
            Expected CI workflows
            <Badge variant="outline" className="text-xs">
              {workflows.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No CI workflows predicted to trigger.
            </p>
          ) : (
            <div className="space-y-2" data-testid="land-ci-workflows">
              {workflows.map((w, i) => {
                const name = w.name ?? w.workflow ?? `workflow ${i + 1}`;
                return (
                  <div
                    key={`${name}-${i}`}
                    className="flex items-center gap-2 flex-wrap"
                    data-testid="land-ci-workflow-row"
                  >
                    <span className="font-mono text-sm min-w-0 truncate flex-1">
                      {name}
                    </span>
                    <Badge
                      variant={
                        w.expected_pass === false ? "destructive" : "success"
                      }
                      className="text-[10px]"
                    >
                      {w.expected_pass === false
                        ? "expected fail"
                        : "expected pass"}
                    </Badge>
                    <ConfidenceBand conf={w.confidence} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deploys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Expected deploys
            <Badge variant="outline" className="text-xs">
              {deploys.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deploys.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No deploys predicted to fire.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5" data-testid="land-deploys">
              {deploys.map((d, i) => (
                <Badge
                  key={i}
                  variant="info"
                  className="inline-flex items-center gap-1"
                >
                  <Rocket className="h-3 w-3" />
                  {d.service ?? d.name ?? "service"}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inferred prior note */}
      {prior && prior.applied && (
        <div
          className="flex items-start gap-2 rounded border border-info/50 bg-info/10 px-3 py-2 text-xs text-muted-foreground"
          data-testid="land-inferred-prior"
        >
          <History className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <span>
            Adjusted by a historical prior
            {typeof prior.adverse_freq === "number" &&
              ` — adverse outcome in ${pct(prior.adverse_freq)} of`}
            {typeof prior.samples === "number" &&
              ` ${prior.samples} prior land${
                prior.samples === 1 ? "" : "s"
              }`}
            {prior.provenance ? ` (${prior.provenance})` : ""}
            .
          </span>
        </div>
      )}
    </div>
  );
}
