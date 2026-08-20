"use client";

/**
 * PullDecisionRow — one `repo_pull` decision audit row, on one line, with its
 * detail behind a click.
 *
 * Replaces `PullDecisionCard` on `/admin/coord/pull-decisions`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `PlanRow.tsx` / `AlertRow.tsx`.
 *
 * What changed: the card was a `p-4` block of four stacked lines (badge row,
 * mono repo/device line, rationale, outcome, evidence). It is now one
 * `px-3 py-2` row whose rationale IS the label, with everything else in the
 * `<RecordDetail>` slots.
 *
 * ## Which chips stay on the ROW, and why it is not a free choice
 *
 * `specs/pages/coord-pull-decisions/state-machine.derived.json` asserts
 * `coord-pull-decision-verdict`, `-autonomy`, `-timing` and `-no-outcome` in a
 * STATIC state — the spec has no transitions, so every criterion is evaluated
 * on page load with nothing expanded. Those four therefore have to render on
 * the collapsed row or the spec goes red, and the spec is frozen (D4b: derived
 * specs are re-derived from a fresh authed snapshot, never hand-edited, and
 * Spec-CI is not runnable in this session). They are rendered compactly rather
 * than moved.
 *
 * Every `data-testid` `PullDecisionCard` authored is carried across unchanged
 * (D4a) — `coord-pull-decision-card`, `-verdict`, `-timing`, `-autonomy`,
 * `-outcome`, `-no-outcome`, `-evidence`.
 */

import { Badge } from "@/components/ui/badge";
import { Bot, Hand } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  PULL_STATUS_PALETTE,
  derivePullDecisionStatus,
  evidenceSummary,
  pullIdentity,
  timingLabel,
  type PullDecisionRow as PullDecisionRowData,
} from "@/components/admin/coord/pullDecisionStatus";

export type { PullDecisionRowData };

export function PullDecisionRow({
  row,
  expanded,
  onToggle,
}: {
  row: PullDecisionRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = derivePullDecisionStatus(row);
  const timing = timingLabel(row);
  const evidence = evidenceSummary(row.timing_evidence);
  const outcome = row.outcome?.chosen_option ? row.outcome : null;

  return (
    <RecordRow
      data-testid="coord-pull-decision-card"
      rowKey={row.resolution_id}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      identity={<span title={row.repo ?? "no repo recorded"}>{pullIdentity(row.repo)}</span>}
      label={
        <span title={row.rationale ?? undefined}>
          {row.rationale || (
            <span className="text-muted-foreground italic">
              coord recorded no rationale
            </span>
          )}
        </span>
      }
      status={
        <>
          <span
            className="inline-flex shrink-0"
            data-testid="coord-pull-decision-verdict"
          >
            <StatusBadge status={status} palette={PULL_STATUS_PALETTE} />
          </span>
          {timing && (
            <Badge
              variant="outline"
              className="text-[10px] shrink-0"
              data-testid="coord-pull-decision-timing"
              title={`coord's timing verdict: ${timing}`}
            >
              {timing}
            </Badge>
          )}
          {row.autonomy && (
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] shrink-0"
              data-testid="coord-pull-decision-autonomy"
              title={
                row.autonomy === "auto_decide"
                  ? "coord decided this without asking"
                  : "coord offered guidance; the caller decides"
              }
            >
              {row.autonomy === "auto_decide" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <Hand className="h-3 w-3" />
              )}
              {row.autonomy}
            </Badge>
          )}
          {outcome ? (
            <Badge
              variant="outline"
              className="text-[10px] shrink-0"
              data-testid="coord-pull-decision-outcome"
              title={row.outcome?.reasoning ?? "the option actually taken"}
            >
              {outcome.chosen_option}
            </Badge>
          ) : (
            <span
              className="text-[10px] text-muted-foreground/70 italic shrink-0"
              data-testid="coord-pull-decision-no-outcome"
              title="coord recorded the decision but nothing has reported back what was actually done — unknown, not 'nothing happened'"
            >
              no outcome
            </span>
          )}
        </>
      }
      reason={status.reason}
      time={<RowTime at={row.resolved_at ?? null} verb="Resolved" />}
    >
      <RecordDetail
        why={
          <div className="text-xs">
            <span className="text-muted-foreground">Verdict: </span>
            <span className="text-foreground/90">
              {status.label}
              {status.reason ? ` — ${status.reason}` : ""}
            </span>
          </div>
        }
        problems={
          <div className="space-y-1">
            {row.rationale && (
              <p className="text-sm text-foreground">{row.rationale}</p>
            )}
            {row.hold_reason && (
              <p className="text-xs text-amber-300/90">
                hold reason: {row.hold_reason}
              </p>
            )}
            {evidence && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-pull-decision-evidence"
              >
                {evidence}
              </p>
            )}
          </div>
        }
        actions={
          <p className="text-xs text-muted-foreground">
            {outcome ? (
              <>
                Recorded outcome:{" "}
                <span className="text-foreground/90">
                  {outcome.chosen_option}
                </span>
                {outcome.reasoning ? (
                  <span className="italic"> — {outcome.reasoning}</span>
                ) : null}
                {outcome.recorded_at ? (
                  <>
                    {" "}
                    <RowTime
                      at={outcome.recorded_at}
                      verb="Outcome recorded"
                      className="inline"
                    />
                  </>
                ) : null}
              </>
            ) : (
              <span className="italic">
                No outcome has been reported for this decision. That is unknown,
                not &ldquo;nothing happened&rdquo; — the executor writes the
                outcome back only when it runs.
              </span>
            )}
          </p>
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              resolved{" "}
              <RowTime
                at={row.resolved_at ?? null}
                verb="Resolved"
                className="inline"
              />
            </span>
            {(row.behind ?? null) !== null && <span>↓{row.behind} behind</span>}
            {(row.ahead ?? 0) > 0 && <span>↑{row.ahead} ahead</span>}
            {row.kind && <span>kind: {row.kind}</span>}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            resolution id: {row.resolution_id}
            {row.repo ? ` · repo: ${row.repo}` : ""}
            {/* The one place a device UUID belongs (R8): expanded, labelled,
                and here because it is what an operator pastes into the
                device_id filter above or into a coord device query. */}
            {row.device_id ? ` · device id: ${row.device_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
