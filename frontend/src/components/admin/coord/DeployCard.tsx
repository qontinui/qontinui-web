"use client";

/**
 * DeployCard — render a single declared deploy (its `DeploySignature`) plus,
 * when present, its composed `DeployVerification` with the per-dimension
 * verdict row, and (for a settled-terminal verification) an on-demand
 * rollback-proposal fetch.
 *
 * Plan `2026-05-31-deploy-action-effect-signatures` — the "recent deploys"
 * history element on `/admin/coord/deploys`. Mirrors `LandCard` (the lands
 * sibling) and reuses its outcome→badge-variant contract so the D3 color
 * ladder cannot drift between the two surfaces.
 *
 * Wire shapes mirror coord's `/coord/deploys` response (snake_case serde).
 * Rendered defensively (optional chaining + fallbacks) because the
 * `PredictedDeployEffect` field set may grow.
 */

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Database,
  GitCommitHorizontal,
  Rocket,
  ShieldQuestion,
  Undo2,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";
import {
  composedOutcomeVariant,
  dimensionOutcomeVariant,
  type DimensionVerdict,
} from "@/components/admin/coord/LandCard";

// ---- Wire types -----------------------------------------------------------
//
// Coord serializes these as snake_case; local interfaces mirror
// `/coord/deploys`' projection (`row_to_deploy_entry`). The deploy dimensions
// are release/infra/schema/health/ci/config — `DimensionVerdict` is reused
// from LandCard (same {dimension, drift_class, outcome, detail} shape).

export interface DeployVerification {
  id: string;
  dimension_verdicts?: DimensionVerdict[] | null;
  composed_outcome?: string | null;
  settled?: boolean | null;
  dimensions_predicted?: number | null;
  dimensions_observed?: number | null;
  coverage?: number | null;
  rationale?: string | null;
  created_at?: string | null;
}

export interface DeploySignature {
  id: string;
  service?: string | null;
  environment?: "staging" | "production" | string | null;
  /// The typed deploy target, e.g. {"commit": "<sha>"} / {"image_digest": "sha256:…"}.
  target?: Record<string, unknown> | null;
  source?: "ci" | "manual" | "orchestrator" | string | null;
  migration_required?: boolean | null;
  correlation_id?: string | null;
  predicted?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface DeployRow {
  signature: DeploySignature;
  verification: DeployVerification | null;
}

export interface RollbackProposal {
  failed_signature_id?: string | null;
  declare?: {
    service?: string | null;
    source_image_or_commit?: string | null;
    target_environment?: string | null;
    source?: string | null;
    correlation_id?: string | null;
  } | null;
  ci_action?: { repo?: string | null; workflow_file?: string | null } | null;
  auto_eligible?: boolean | null;
  rationale?: string | null;
}

const API = "/api/v1/operations";

// ---- Helpers ----------------------------------------------------------------

/**
 * Render the typed deploy target as one short artifact token. Coord persists
 * `DeployTarget` adjacently tagged: `{kind: "image_digest"|"commit"|
 * "task_def_revision", value: …}`.
 */
export function shortTarget(target?: Record<string, unknown> | null): string {
  if (!target) return "—";
  const kind = target["kind"];
  const value = target["value"];
  if (kind === "image_digest" && typeof value === "string") {
    // sha256:abcd1234… → sha256:abcd123…
    return value.length > 15 ? `${value.slice(0, 15)}…` : value;
  }
  if (kind === "commit" && typeof value === "string") {
    return value.length > 8 ? value.slice(0, 8) : value;
  }
  if (kind === "task_def_revision" && typeof value === "number") {
    return `taskdef:${value}`;
  }
  return typeof value === "string" ? value.slice(0, 16) : "—";
}

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

/** A settled hard-terminal verification is the only state with a proposal. */
export function rollbackProposalPossible(
  ver?: DeployVerification | null
): boolean {
  if (!ver?.settled) return false;
  const o = (ver.composed_outcome ?? "").toLowerCase();
  return o === "failure" || o === "contradiction";
}

// ---- Card -----------------------------------------------------------------

export function DeployCard({ row }: { row: DeployRow }) {
  const { signature: sig, verification: ver } = row;
  const verdicts = ver?.dimension_verdicts ?? [];

  // ---- On-demand rollback proposal (only offered when possible) ----
  const [proposal, setProposal] = useState<RollbackProposal | null>(null);
  const [proposalMsg, setProposalMsg] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);

  const fetchProposal = useCallback(async () => {
    setProposalLoading(true);
    setProposalMsg(null);
    try {
      const body = await httpClient.get<RollbackProposal>(
        `${API}/deploys/${sig.id}/rollback-proposal`
      );
      setProposal(body);
    } catch (e) {
      setProposal(null);
      // Coord 404s when the latest verification does not justify a rollback
      // (e.g. unclean / no prior artifact) — render that honestly.
      const msg = e instanceof Error ? e.message : String(e);
      setProposalMsg(
        /404/.test(msg)
          ? "No rollback proposal: coord does not consider this verification rollback-justified (unclean rollback or no prior artifact)."
          : msg
      );
    } finally {
      setProposalLoading(false);
    }
  }, [sig.id]);

  return (
    <Card data-testid="coord-deploy-card">
      <CardContent className="p-4 space-y-2.5">
        {/* Header line: service + environment + source + outcome badges */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm">{sig.service ?? "—"}</span>
          </span>
          <Badge
            variant={sig.environment === "production" ? "secondary" : "outline"}
            className="text-[10px] uppercase"
          >
            {sig.environment ?? "—"}
          </Badge>
          {sig.source && (
            <Badge variant="outline" className="text-[10px]">
              {sig.source}
            </Badge>
          )}
          {sig.migration_required && (
            <Badge
              variant="warning"
              className="inline-flex items-center gap-1 text-[10px]"
            >
              <Database className="h-3 w-3" />
              migration
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {ver ? (
              <>
                <Badge
                  variant={composedOutcomeVariant(ver.composed_outcome)}
                  data-testid="coord-deploy-outcome-badge"
                >
                  {ver.composed_outcome ?? "pending"}
                </Badge>
                <Badge
                  variant={ver.settled ? "secondary" : "outline"}
                  className="text-[10px]"
                  data-testid="coord-deploy-settled-badge"
                >
                  {ver.settled ? "settled" : "open"}
                </Badge>
              </>
            ) : (
              <Badge
                variant="outline"
                className="inline-flex items-center gap-1"
                data-testid="coord-deploy-unverified-badge"
              >
                <ShieldQuestion className="h-3 w-3" />
                declared, not yet verified
              </Badge>
            )}
          </div>
        </div>

        {/* Artifact + correlation line */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground font-mono">
          <span className="inline-flex items-center gap-1">
            <GitCommitHorizontal className="h-3 w-3" />
            {shortTarget(sig.target)}
          </span>
          {sig.correlation_id && (
            <span title={`correlation_id ${sig.correlation_id}`}>
              corr {sig.correlation_id.slice(0, 8)}
            </span>
          )}
          {sig.created_at && (
            <span className="ml-auto">{formatTime(sig.created_at)}</span>
          )}
        </div>

        {/* Per-dimension verdict row */}
        {ver && verdicts.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 pt-1"
            data-testid="coord-deploy-verdicts"
          >
            {verdicts.map((v, i) => (
              <span
                key={`${v.dimension}-${i}`}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
                title={v.detail ?? undefined}
                data-testid="coord-deploy-verdict-chip"
              >
                <span className="font-medium uppercase text-muted-foreground">
                  {v.dimension}
                </span>
                {v.drift_class && (
                  <span className="text-muted-foreground">{v.drift_class}</span>
                )}
                <Badge
                  variant={dimensionOutcomeVariant(v.outcome)}
                  className="text-[10px] px-1 py-0"
                >
                  {v.outcome ?? "—"}
                </Badge>
              </span>
            ))}
          </div>
        )}

        {/* Coverage + rationale */}
        {ver && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {typeof ver.coverage === "number" && (
              <span data-testid="coord-deploy-coverage">
                coverage {Math.round(ver.coverage * 100)}%
                {typeof ver.dimensions_observed === "number" &&
                  typeof ver.dimensions_predicted === "number" && (
                    <>
                      {" "}
                      ({ver.dimensions_observed}/{ver.dimensions_predicted} dims)
                    </>
                  )}
              </span>
            )}
            {ver.rationale && (
              <span className="italic truncate">{ver.rationale}</span>
            )}
          </div>
        )}

        {/* Rollback proposal — offered ONLY for a settled hard terminal.
            Read-only: renders coord's recommendation; execution stays in the
            EXISTING CI deploy workflow (operator dispatches it there). */}
        {rollbackProposalPossible(ver) && (
          <div className="pt-1 space-y-2" data-testid="coord-deploy-rollback">
            {!proposal && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchProposal}
                disabled={proposalLoading}
                data-testid="coord-deploy-rollback-btn"
              >
                <Undo2 className="h-3 w-3 mr-1" />
                {proposalLoading ? "Loading…" : "Rollback proposal"}
              </Button>
            )}
            {proposalMsg && (
              <p className="text-xs text-muted-foreground italic">
                {proposalMsg}
              </p>
            )}
            {proposal && (
              <div className="rounded border border-border p-2 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={proposal.auto_eligible ? "warning" : "outline"}
                    className="text-[10px]"
                  >
                    {proposal.auto_eligible
                      ? "auto-eligible (armed-only)"
                      : "operator-gated"}
                  </Badge>
                  {proposal.declare?.source_image_or_commit && (
                    <span className="font-mono">
                      → {proposal.declare.source_image_or_commit.slice(0, 20)}
                    </span>
                  )}
                  {proposal.ci_action?.workflow_file && (
                    <span className="font-mono text-muted-foreground">
                      via {proposal.ci_action.workflow_file}
                    </span>
                  )}
                </div>
                {proposal.rationale && (
                  <p className="text-muted-foreground">{proposal.rationale}</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
