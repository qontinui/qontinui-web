"use client";

/**
 * LandRow — one declared land (its `LandSignature`) plus, when present, its
 * composed `LandVerification`, on one line with its detail behind a click.
 *
 * Replaces `LandCard` on `/admin/coord/lands`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2;
 * conventions from `frontend/docs/console-ui-style-guide.md`.
 *
 * `LandCard` was 601 lines rendering a four-line card — the wave's heaviest
 * single file. Most of that was wire types and colour ladders, which moved to
 * `landTypes.ts` unchanged; what is left here is the row and the cross-repo
 * panel it lazily fetches.
 *
 * ## The cross-repo panel: still lazy, now part of the row's own detail
 *
 * The card had TWO independent expansion affordances — the row (none) and a
 * clickable `cross-repo` badge that toggled `CrossRepoVerdictPanel`. The plan
 * corrected an earlier claim that this panel was always-mounted: it was not,
 * and its fetch-once-on-mount behaviour is the R5/R7-conformant part worth
 * keeping. What Wave 2 changes is only WHICH click opens it: the row's, like
 * every other record in the console (D2 — *"clicking a record must do the same
 * thing on every page"*).
 *
 * So `coord-land-crossrepo-badge` is now a non-interactive MARKER on the row
 * ("this land fanned out to sibling repos") rather than a `role="button"`
 * badge. It has to be: `<RecordRow>` renders the whole line as one `<button>`,
 * and a button inside a button is invalid HTML that browsers silently
 * re-parent. The panel itself still mounts only when the detail is open, still
 * fetches exactly once per mount, and still unmounts on collapse.
 *
 * ## Which chips are pinned to the ROW, and why it is not a free choice
 *
 * `specs/pages/coord-lands/state-machine.derived.json` asserts
 * `coord-land-card`, `-crossrepo-badge`, `-outcome-badge`, `-settled-badge`
 * and `-verdicts` in a STATIC state — that spec declares no transitions, so
 * every criterion is evaluated on page load with nothing expanded. All five
 * therefore render on the collapsed row **for a land that has them**: the
 * outcome and settled badges sit behind `ver`, and `<VerdictChips>` renders
 * nothing for an empty verdict list. That is a property of the DATA, not of
 * this component — which is exactly why `lands/page.specSelectors.test.tsx`
 * runs against the spec's OWN stub rather than a fixture of its own. They are rendered COMPACTLY rather
 * than moved (see `VerdictChips` for how the four-dimension cluster is kept
 * to ~80px), because the derived specs are frozen (D4b) and Spec-CI is not
 * runnable in this session, so re-derivation is not an available answer.
 *
 * Every `data-testid` `LandCard` authored is carried across unchanged (D4a).
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, Network } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import {
  VerdictChips,
  VerdictDetail,
} from "@/components/admin/coord/VerdictChips";
import {
  driftClassVariant,
  shortSha,
  type LandRow as LandRowData,
} from "@/components/admin/coord/landTypes";
import {
  OWED_REVIEW,
  VERIFICATION_PALETTE,
  deriveVerificationStatus,
} from "@/components/admin/coord/verificationStatus";

export type { LandRowData };

// ---- Cross-repo verdict panel ---------------------------------------------
//
// When a recent land carries a `correlation_id`, its cascade may have fanned
// out to sibling repos. The composed restack-verification verdict lives on
// coord at `/coord/restacks/verifications`; the web backend proxies it at
// `${API}/lands/verifications?correlation_id=…`. This panel fetches that ONCE
// on first mount (the row is otherwise presentational), using the same
// `httpClient.get` pattern the lands page uses.

const API = "/api/v1/operations";

// Wire shapes mirror coord's `/coord/restacks/verifications` response
// (snake_case). Rendered defensively — `worst_drift_class` / `d3_outcome` /
// `verified_at` are null until a repo is verified.
export interface RepoVerification {
  repo: string;
  signature_id?: string | null;
  worst_drift_class?: string | null;
  d3_outcome?: string | null;
  verified_at?: string | null;
  edge_verdicts?: unknown[] | null;
}

export interface ComposedVerification {
  worst_drift_class?: string | null;
  repo_count?: number | null;
  verified_count?: number | null;
}

export interface CrossRepoVerifications {
  correlation_id?: string | null;
  repos?: RepoVerification[] | null;
  composed?: ComposedVerification | null;
}

function CrossRepoVerdictPanel({ correlationId }: { correlationId: string }) {
  const [data, setData] = useState<CrossRepoVerifications | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch ONCE on mount — the panel only mounts when the operator expands the
  // row, and unmounts/remounts on re-expand (acceptable: a fresh verdict each
  // time). This is the behaviour the plan's Wave-2 amendment identified as
  // already R5/R7-conformant, and it is preserved verbatim.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ correlation_id: correlationId });
        const body = await httpClient.get<CrossRepoVerifications>(
          `${API}/lands/verifications?${qs.toString()}`
        );
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [correlationId]);

  const composed = data?.composed ?? null;
  const repos = data?.repos ?? [];

  return (
    <div
      className="rounded border border-border bg-muted/30 p-2.5 space-y-2 text-xs"
      data-testid="coord-land-crossrepo-panel"
    >
      {loading && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading cross-repo verdict…
        </span>
      )}
      {error && (
        <span
          className="text-muted-foreground italic"
          data-testid="coord-land-crossrepo-error"
        >
          Cross-repo verdict unavailable: {error}
        </span>
      )}
      {!loading && !error && data && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-muted-foreground">
              composed drift:
            </span>
            <Badge
              variant={driftClassVariant(composed?.worst_drift_class)}
              className="text-[10px]"
              data-testid="coord-land-crossrepo-composed-badge"
            >
              {composed?.worst_drift_class ?? "unknown"}
            </Badge>
            <span className="text-muted-foreground tabular-nums">
              {/* `0/0 verified` would be a measurement; an absent `composed`
                  block is coord declining to answer. Dashes, per R6. */}
              {composed?.verified_count ?? "–"}/{composed?.repo_count ?? "–"}{" "}
              verified
            </span>
          </div>
          {repos.length > 0 ? (
            <div className="space-y-1">
              {repos.map((r, i) => (
                <div
                  key={`${r.repo}-${i}`}
                  className="flex items-center gap-2 flex-wrap"
                  data-testid="coord-land-crossrepo-repo-row"
                >
                  <span className="font-mono">{r.repo}</span>
                  {r.worst_drift_class ? (
                    <Badge
                      variant={driftClassVariant(r.worst_drift_class)}
                      className="text-[10px]"
                    >
                      {r.worst_drift_class}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] italic">
                      unverified
                    </Badge>
                  )}
                  {r.d3_outcome && (
                    <span className="text-muted-foreground">{r.d3_outcome}</span>
                  )}
                  {r.verified_at && (
                    <span className="ml-auto">
                      <RowTime at={r.verified_at} verb="Verified" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground italic">
              No sibling repos in this correlation.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---- Row ------------------------------------------------------------------

/** `#123` when there is a PR, else the target sha — never the row UUID. */
function landIdentity(row: LandRowData): string {
  const sig = row.signature;
  if (typeof sig.pr_number === "number") return `#${sig.pr_number}`;
  return shortSha(sig.to_sha);
}

export function LandRow({
  row,
  expanded,
  onToggle,
}: {
  row: LandRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { signature: sig, verification: ver } = row;
  const action = (sig.action ?? "land") as string;
  const verdicts = ver?.dimension_verdicts ?? [];
  const correlationId = sig.correlation_id ?? null;
  const status = deriveVerificationStatus(ver);
  const owed = OWED_REVIEW[status.kind];

  return (
    <RecordRow
      data-testid="coord-land-card"
      rowKey={sig.id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span title={`${action} — ${sig.repo ?? "no repo recorded"}`}>
          {landIdentity(row)}
        </span>
      }
      label={
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Badge variant="outline" className="uppercase text-[10px] shrink-0">
            {action}
          </Badge>
          <span className="font-mono truncate" title={sig.repo ?? undefined}>
            {sig.repo ?? "—"}
          </span>
          {sig.branch && (
            <span
              className="font-mono text-xs text-muted-foreground truncate"
              title={sig.branch}
            >
              {sig.branch}
            </span>
          )}
        </span>
      }
      status={
        <>
          {correlationId && (
            // A MARKER, not a control — see the module doc. Its click target
            // is the row, which opens the panel below.
            <Badge
              variant="outline"
              className="font-mono text-[10px] inline-flex items-center gap-1 shrink-0"
              title="this land's cascade fanned out to sibling repos — expand the row for the composed verdict"
              data-testid="coord-land-crossrepo-badge"
            >
              <Network className="h-3 w-3" />
              cross-repo
            </Badge>
          )}
          <VerdictChips
            verdicts={verdicts}
            data-testid="coord-land-verdicts"
            chipTestId="coord-land-verdict-chip"
          />
          {ver ? (
            <>
              <span
                className="inline-flex shrink-0"
                data-testid="coord-land-outcome-badge"
              >
                <StatusBadge status={status} palette={VERIFICATION_PALETTE} />
              </span>
              <Badge
                variant={ver.settled ? "secondary" : "outline"}
                className="text-[10px] shrink-0"
                data-testid="coord-land-settled-badge"
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
              data-testid="coord-land-unverified-badge"
              title="the land declared itself; the verifier has not answered yet"
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
                data-testid="coord-land-review-owed"
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
            testId="coord-land-verdict-detail"
          />
        }
        actions={
          correlationId ? (
            <CrossRepoVerdictPanel correlationId={correlationId} />
          ) : undefined
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span className="font-mono">
              {shortSha(sig.from_sha)} → {shortSha(sig.to_sha)}
            </span>
            {sig.merge_strategy && <span>{sig.merge_strategy}</span>}
            <span>
              declared{" "}
              <RowTime
                at={sig.created_at ?? null}
                verb="Declared"
                className="inline"
              />
            </span>
            {typeof ver?.coverage === "number" && (
              <span data-testid="coord-land-coverage">
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
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            signature id: {sig.id}
            {ver ? ` · verification id: ${ver.id}` : ""}
            {correlationId ? ` · correlation id: ${correlationId}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
