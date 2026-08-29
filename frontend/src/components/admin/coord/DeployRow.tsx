"use client";

/**
 * DeployRow — one declared deploy, on one line, with its detail behind a
 * click.
 *
 * Replaces `DeployCard` on `/admin/coord/deploys`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `PlanRow.tsx` / `AlertRow.tsx`.
 *
 * What changed:
 *
 * 1. **R2** — the card was a `p-4` block of up to five stacked lines. It is
 *    now one `px-3 py-2` row.
 * 2. **R3** — the composed outcome now derives through the SHARED
 *    `verificationStatus.ts` audit table (see its module doc for the two hues
 *    that changed and why), rather than off a `BadgeVariant` ladder with no
 *    severity model behind it.
 * 3. **R5** — the rollback proposal used to be a button inside the card body.
 *    It is now in the detail's `actions` slot, where an action belongs, and it
 *    still fetches ON DEMAND (one click, no poll) exactly as before.
 *
 * Every `data-testid` `DeployCard` authored is carried across unchanged (D4a) —
 * `coord-deploy-card`, `-outcome-badge`, `-settled-badge`, `-unverified-badge`,
 * `-verdicts`, `-verdict-chip`, `-verdict-outcome`, `-coverage`, `-rollback`,
 * `-rollback-btn`.
 */

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Database, Undo2 } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import {
  outcomeGlyph,
  VerdictChips,
  VerdictDetail,
} from "@/components/admin/coord/VerdictChips";
import {
  isManagedPredictedHeadFork,
  isNoProposalAnswer,
  rollbackProposalPossible,
  shortTarget,
  verdictChipLabel,
  type DeployRow as DeployRowData,
  type RollbackProposal,
} from "@/components/admin/coord/deployTypes";
import {
  OWED_REVIEW,
  VERIFICATION_PALETTE,
  deriveVerificationStatus,
} from "@/components/admin/coord/verificationStatus";
import type { DimensionVerdict } from "@/components/admin/coord/landTypes";

export type { DeployRowData };

const API = "/api/v1/operations";

/**
 * A managed predicted-head-fork keeps its own glyph: coord auto-resolves it,
 * so it is neither a pass nor a failure and must not borrow either glyph.
 *
 * Everything BELOW that carve-out is `outcomeGlyph`. It used to be a verbatim
 * second copy of that ladder — the exact defect this plan exists to remove,
 * and a live one: `/deploys` and `/lands` render the SAME chip cluster, so a
 * glyph added to one ladder and not the other would have shown two different
 * verdicts for one outcome. One `?` fallback, derived in one place.
 */
function deployGlyph(v: DimensionVerdict): string {
  if (isManagedPredictedHeadFork(v)) return "~";
  return outcomeGlyph(v.outcome);
}

export function DeployRow({
  row,
  expanded,
  onToggle,
}: {
  row: DeployRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { signature: sig, verification: ver } = row;
  const verdicts = ver?.dimension_verdicts ?? [];
  const status = deriveVerificationStatus(ver);
  const owed = OWED_REVIEW[status.kind];

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
      // (e.g. unclean / no prior artifact) — render that honestly. The probe
      // used to be `/404/` over the whole message, which is `GET <url> failed:
      // <status> - <body>`: it matched the BODY, and it matched the deploy id
      // inside the URL, so any failure on a row whose hex id contains "404"
      // claimed there was no proposal. `isNoProposalAnswer` reads the status
      // field (see its doc); anything else keeps its real message.
      const msg = e instanceof Error ? e.message : String(e);
      setProposalMsg(
        isNoProposalAnswer(e)
          ? "No rollback proposal: coord does not consider this verification rollback-justified (unclean rollback or no prior artifact)."
          : msg
      );
    } finally {
      setProposalLoading(false);
    }
  }, [sig.id]);

  return (
    <RecordRow
      data-testid="coord-deploy-card"
      rowKey={sig.id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span title={sig.service ?? "no service recorded"}>
          {sig.service ?? "—"}
        </span>
      }
      label={
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Badge
            variant={sig.environment === "production" ? "secondary" : "outline"}
            className="text-[10px] uppercase shrink-0"
          >
            {sig.environment ?? "—"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground truncate">
            {shortTarget(sig.target)}
          </span>
          {sig.migration_required && (
            <Badge
              variant="warning"
              className="inline-flex items-center gap-1 text-[10px] shrink-0"
              title="this deploy declared a schema migration"
            >
              <Database className="h-3 w-3" />
              migration
            </Badge>
          )}
        </span>
      }
      status={
        <>
          <VerdictChips
            verdicts={verdicts}
            data-testid="coord-deploy-verdicts"
            chipTestId="coord-deploy-verdict-chip"
            outcomeTestId="coord-deploy-verdict-outcome"
            labelFor={verdictChipLabel}
            glyphFor={deployGlyph}
          />
          {ver ? (
            <>
              <span
                className="inline-flex shrink-0"
                data-testid="coord-deploy-outcome-badge"
              >
                <StatusBadge status={status} palette={VERIFICATION_PALETTE} />
              </span>
              <Badge
                variant={ver.settled ? "secondary" : "outline"}
                className="text-[10px] shrink-0"
                data-testid="coord-deploy-settled-badge"
                title={
                  ver.settled
                    ? "the verdict is final"
                    : "dimensions are still being observed — this verdict can still change"
                }
              >
                {ver.settled ? "settled" : "open"}
              </Badge>
            </>
          ) : (
            // The palette entry, not a hand-copied literal of it (§4):
            // `status` is already `unverified` on this branch, so
            // `VERIFICATION_PALETTE` is the amber's single source.
            <span
              className="inline-flex shrink-0"
              data-testid="coord-deploy-unverified-badge"
              title="the deploy declared itself; the verifier has not answered yet"
            >
              <StatusBadge status={status} palette={VERIFICATION_PALETTE} />
            </span>
          )}
        </>
      }
      reason={status.reason}
      time={<RowTime at={sig.created_at ?? null} verb="Declared" />}
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <div className="text-xs">
              <span className="text-muted-foreground">Verdict: </span>
              <span className="text-foreground/90">
                {status.label}
                {status.reason ? ` — ${status.reason}` : ""}
              </span>
            </div>
            {/* §4.2 clause 4 — a CALM kind that nonetheless owes somebody a
                decision says so in words, because the hue deliberately does
                not. */}
            {owed && (
              <p
                className="text-xs text-foreground/80"
                data-testid="coord-deploy-review-owed"
              >
                {owed}
              </p>
            )}
            {ver?.rationale && (
              <p className="text-xs text-muted-foreground italic">
                {ver.rationale}
              </p>
            )}
          </div>
        }
        problems={
          <VerdictDetail
            verdicts={verdicts}
            labelFor={verdictChipLabel}
            testId="coord-deploy-verdict-detail"
          />
        }
        actions={
          rollbackProposalPossible(ver) ? (
            <div className="space-y-2" data-testid="coord-deploy-rollback">
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
                    {/* THREE states: coord says yes, coord says no, and coord
                        did not say. `auto_eligible` is `boolean | null`, and a
                        plain truthy test reported an uncomputed null as a
                        measured "operator-gated". */}
                    <Badge
                      variant={
                        proposal.auto_eligible === true ? "warning" : "outline"
                      }
                      className={
                        proposal.auto_eligible == null
                          ? "text-[10px] border-dashed"
                          : "text-[10px]"
                      }
                    >
                      {proposal.auto_eligible === true
                        ? "auto-eligible (armed-only)"
                        : proposal.auto_eligible === false
                          ? "operator-gated"
                          : "eligibility not stated"}
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
              {/* Read-only by construction: this renders coord's
                  recommendation. Execution stays in the EXISTING CI deploy
                  workflow, which the operator dispatches there. */}
            </div>
          ) : undefined
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              declared{" "}
              <RowTime
                at={sig.created_at ?? null}
                verb="Declared"
                className="inline"
              />
            </span>
            {ver?.created_at && (
              <span>
                verified{" "}
                <RowTime
                  at={ver.created_at}
                  verb="Verified"
                  className="inline"
                />
              </span>
            )}
            {typeof ver?.coverage === "number" && (
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
            {sig.source && <span>source: {sig.source}</span>}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            signature id: {sig.id}
            {ver ? ` · verification id: ${ver.id}` : ""}
            {sig.correlation_id ? ` · correlation id: ${sig.correlation_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
