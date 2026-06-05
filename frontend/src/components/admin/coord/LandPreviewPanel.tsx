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
  Network,
  Rocket,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import type {
  BadgeVariant,
  ConfidenceInterval,
  PredictedConflict,
  PredictedLandEffect,
  SiblingCascade,
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
 * Normalize a confidence field — coord sends a `{ point, low, high }`
 * interval, but we still accept a bare number (a point estimate) defensively.
 * Returns a uniform shape so the renderer doesn't branch on the wire form.
 */
export function normalizeConfidence(
  c?: ConfidenceInterval | number | null
): { point: number | null; low: number | null; high: number | null } {
  if (c === null || c === undefined) {
    return { point: null, low: null, high: null };
  }
  if (typeof c === "number") {
    return { point: c, low: null, high: null };
  }
  return {
    point: c.point ?? null,
    low: c.low ?? null,
    high: c.high ?? null,
  };
}

/**
 * The visual width [0,1] of a confidence interval = high - low, clamped.
 * Used to render a band whose width is the uncertainty. Returns null when the
 * interval has no bounds (a bare point estimate carries no width).
 *
 * Exported + unit-tested so "wide band = visibly uncertain" can't regress.
 */
export function confidenceBandWidth(
  c?: ConfidenceInterval | number | null
): number | null {
  const { low, high } = normalizeConfidence(c);
  if (low === null || high === null) return null;
  return Math.max(0, Math.min(1, high - low));
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
  const { point, low, high } = normalizeConfidence(conf);
  const width = confidenceBandWidth(conf);

  if (point === null && low === null && high === null) {
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

  const lo = low ?? 0;
  // Wide band (high - low > ~0.3) reads as visibly uncertain.
  const wide = width > 0.3;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="land-confidence-band"
      title={`${pct(low)}–${pct(high)}${
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
        {pct(low)}–{pct(high)}
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
  conflict: PredictedConflict;
}) {
  const paths = conflict.paths ?? [];
  const childRef = conflict.child_ref ?? null;
  const hunkOverlaps = conflict.hunk_overlaps ?? null;
  return (
    <div
      className="rounded border border-border p-2 space-y-1 text-xs"
      data-testid="land-conflict-chip"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {childRef && (
          <Badge
            variant="outline"
            className="font-mono text-[10px] inline-flex items-center gap-1"
            data-testid="land-conflict-child-ref"
          >
            <GitBranch className="h-3 w-3" />
            {childRef}
          </Badge>
        )}
        {conflict.auto_resolvable ? (
          <Badge variant="success" className="text-[10px]">
            auto-resolvable
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[10px]">
            manual resolve
          </Badge>
        )}
        {typeof hunkOverlaps === "number" && (
          <span className="text-muted-foreground">
            {hunkOverlaps} hunk overlap{hunkOverlaps === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {paths.length > 0 ? (
        <div className="font-mono text-muted-foreground truncate">
          {paths.join(", ")}
        </div>
      ) : (
        <div className="text-muted-foreground italic">unspecified paths</div>
      )}
    </div>
  );
}

// ---- Cross-repo sibling cascade sub-card ----------------------------------
//
// One correlated sibling-repo cascade. Mirrors the own-repo cascade card's
// styling: depth + dependent-ref-count badges + per-conflict ConflictChip.
// Everything is read defensively (the `cascade` itself may be null).

/** `correlated_via` → badge variant. proposal→info, work_plan→secondary. */
export function correlatedViaVariant(via?: string | null): BadgeVariant {
  if (via === "proposal") return "info";
  if (via === "work_plan") return "secondary";
  return "outline";
}

function SiblingCascadeCard({ sibling }: { sibling: SiblingCascade }) {
  const cascade = sibling.cascade ?? null;
  const dependentRefs = cascade?.dependent_refs_to_restack ?? [];
  const conflicts = cascade?.expected_conflicts ?? [];
  const depth = cascade?.cascade_depth ?? null;
  return (
    <Card data-testid="land-sibling-cascade-card">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="font-mono text-[11px] inline-flex items-center gap-1"
          >
            <GitBranch className="h-3 w-3" />
            {sibling.repo}
          </Badge>
          {sibling.branch && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-muted-foreground"
            >
              {sibling.branch}
            </Badge>
          )}
          <Badge
            variant={correlatedViaVariant(sibling.correlated_via)}
            className="text-[10px]"
            data-testid="land-sibling-correlated-via"
          >
            {sibling.correlated_via}
          </Badge>
          {typeof depth === "number" && (
            <Badge variant="outline" className="text-[10px]">
              depth {depth}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {dependentRefs.length} dependent ref
            {dependentRefs.length === 1 ? "" : "s"}
          </Badge>
        </div>

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
  const git = predicted.git ?? {};
  const ci = predicted.ci ?? {};
  const ciPending = ci.pending === true;
  const workflows = ci.workflows ?? [];
  const deploy = predicted.deploy ?? {};
  const deployPending = deploy.pending === true;
  const deploys = deploy.services_will_deploy ?? [];
  const prior = predicted.inferred_prior ?? null;
  const risk = preview.risk ?? {};
  const riskReasons = risk.reasons ?? [];
  const siblingCascades = Array.isArray(predicted.sibling_cascades)
    ? predicted.sibling_cascades
    : [];

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
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-muted-foreground">completes cleanly:</span>
            {cascade.will_complete_cleanly === true ? (
              <Badge variant="success" data-testid="land-cascade-clean-badge">
                yes
              </Badge>
            ) : cascade.will_complete_cleanly === false ? (
              <Badge variant="warning" data-testid="land-cascade-clean-badge">
                no
              </Badge>
            ) : (
              <Badge
                variant="outline"
                data-testid="land-cascade-clean-badge"
                className="italic"
              >
                unknown
              </Badge>
            )}
          </div>

          {(git.will_advance_to || typeof git.no_force_required === "boolean") && (
            <div
              className="flex items-center gap-2 text-sm flex-wrap"
              data-testid="land-git-advance"
            >
              <span className="text-muted-foreground">main advances to:</span>
              {git.will_advance_to ? (
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] inline-flex items-center gap-1"
                >
                  <GitBranch className="h-3 w-3" />
                  {git.will_advance_to}
                </Badge>
              ) : (
                <span className="text-muted-foreground italic">unknown</span>
              )}
              {git.no_force_required === false && (
                <Badge variant="warning" className="text-[10px]">
                  force-push required
                </Badge>
              )}
            </div>
          )}

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

      {/* Cross-repo cascades — only when correlated siblings exist */}
      {siblingCascades.length > 0 && (
        <section
          className="space-y-2"
          data-testid="land-sibling-cascades-section"
        >
          <div className="flex items-center gap-2 text-base font-semibold">
            <Network className="h-4 w-4" />
            Cross-repo cascades
            <Badge variant="outline" className="text-xs">
              {siblingCascades.length} repo
              {siblingCascades.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <div className="space-y-2">
            {siblingCascades.map((s, i) => (
              <SiblingCascadeCard key={`${s.repo}-${s.branch}-${i}`} sibling={s} />
            ))}
          </div>
        </section>
      )}

      {/* CI workflows */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4" />
            Expected CI workflows
            {!ciPending && (
              <Badge variant="outline" className="text-xs">
                {workflows.length}
              </Badge>
            )}
            {!ciPending && typeof ci.expected_pass === "boolean" && (
              <Badge
                variant={ci.expected_pass ? "success" : "destructive"}
                className="text-[10px]"
                data-testid="land-ci-overall-badge"
              >
                {ci.expected_pass ? "expected pass" : "expected fail"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ciPending ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="land-ci-pending"
            >
              prediction unavailable
              {ci.note ? `: ${ci.note}` : "."}
            </p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No CI workflows predicted to trigger.
            </p>
          ) : (
            <div className="space-y-2" data-testid="land-ci-workflows">
              {workflows.map((w, i) => {
                const name = w.workflow_name ?? `workflow ${i + 1}`;
                const noHistory = w.sample_size === 0;
                return (
                  <div
                    key={`${name}-${i}`}
                    className="flex items-center gap-2 flex-wrap"
                    data-testid="land-ci-workflow-row"
                  >
                    <span className="font-mono text-sm min-w-0 truncate flex-1">
                      {name}
                    </span>
                    {w.trigger_uncertain && (
                      <Badge
                        variant="warning"
                        className="text-[10px]"
                        title="coord is unsure this workflow will trigger"
                      >
                        trigger uncertain
                      </Badge>
                    )}
                    {w.path_conditioned && (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        title="prediction conditioned on the changed paths"
                      >
                        path-conditioned
                      </Badge>
                    )}
                    {noHistory ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] italic"
                        title="no historical runs to learn from"
                      >
                        no history
                      </Badge>
                    ) : (
                      typeof w.sample_size === "number" && (
                        <span
                          className="text-[10px] text-muted-foreground tabular-nums"
                          title="number of historical runs"
                        >
                          n={w.sample_size}
                        </span>
                      )
                    )}
                    <ConfidenceBand conf={w.expected_pass} />
                  </div>
                );
              })}
            </div>
          )}
          {!ciPending && (ci.changed_paths?.length ?? 0) > 0 && (
            <p className="mt-2 text-[11px] font-mono text-muted-foreground truncate">
              changed: {(ci.changed_paths ?? []).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Deploys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Expected deploys
            {!deployPending && (
              <Badge variant="outline" className="text-xs">
                {deploys.length}
              </Badge>
            )}
            {!deployPending &&
              typeof deploy.expected_health_check_pass === "boolean" && (
                <Badge
                  variant={
                    deploy.expected_health_check_pass ? "success" : "destructive"
                  }
                  className="text-[10px]"
                  data-testid="land-deploy-health-badge"
                >
                  {deploy.expected_health_check_pass
                    ? "health check pass"
                    : "health check fail"}
                </Badge>
              )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deployPending ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="land-deploy-pending"
            >
              prediction unavailable
              {deploy.note ? `: ${deploy.note}` : "."}
            </p>
          ) : deploys.length === 0 ? (
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
                  data-testid="land-deploy-chip"
                >
                  <Rocket className="h-3 w-3" />
                  {d.surface ?? "surface"}
                  {d.target ? (
                    <span className="font-mono opacity-80">→ {d.target}</span>
                  ) : null}
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
