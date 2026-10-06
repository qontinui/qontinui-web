"use client";

/**
 * A metric's declared checkpoints, each with its due date, a met / missed /
 * unknown triple, the line that says how it stands (plan
 * `2026-10-06-overview-objectives-view` D5: awaiting, no report found, a
 * possible report not yet recorded, results can't be read — each its own
 * words, none ever MISSED or blank), the report inline, and the
 * per-criterion rows one disclosure down.
 */

import { Fragment } from "react";
import {
  checkpointStatusCopy,
  placementDisagreement,
  shortDay,
  unresolvedResultText,
} from "../../_lib/objectives";
import type {
  CheckpointResultRead,
  MetricRead,
} from "../../_lib/objectives-api";
import { CriterionList } from "./CriterionRows";
import { ReportPanel } from "./ReportPanel";
import { TallyMarks } from "./VerdictMark";
import { DISCLOSURE, MUTED, NOTICE, bridgeSafe } from "./ui";

function CheckpointBlock({
  metric,
  cp,
  uiBridgeId,
}: {
  metric: MetricRead;
  cp: CheckpointResultRead;
  uiBridgeId: string;
}) {
  const copy = checkpointStatusCopy(cp);
  const due = shortDay(cp.due);
  const undeclared = (cp.report?.rows ?? []).filter((r) => !r.declared);
  const disagreement = placementDisagreement(cp);
  return (
    <li className="py-4" data-ui-bridge-id={uiBridgeId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] font-medium text-foreground">
          {cp.label
            ? `${cp.label[0]!.toUpperCase()}${cp.label.slice(1)}`
            : cp.id}
          <span className="font-normal text-muted-foreground">
            {due ? ` · due ${due}` : " · no due date declared"}
          </span>
        </p>
        <TallyMarks tally={cp.tally} uiBridgeId={`${uiBridgeId}.tally`} />
      </div>
      {!cp.declared && (
        <p className={MUTED}>
          This checkpoint is named by a report, not by the document.
        </p>
      )}
      <p
        className={copy.unknown ? `mt-1 ${NOTICE} ${MUTED}` : `mt-1 ${MUTED}`}
        role="status"
        data-ui-bridge-id={`${uiBridgeId}.status`}
        data-status={cp.status}
      >
        {copy.unknown && <span aria-hidden>? </span>}
        {copy.text}
        {copy.detail && (
          <span className="block text-xs">Why: {copy.detail}</span>
        )}
      </p>
      {disagreement && (
        <p
          className={`mt-1 ${MUTED}`}
          data-ui-bridge-id={`${uiBridgeId}.placement-disagreement`}
        >
          {disagreement}
        </p>
      )}
      {cp.unresolved_results.length > 0 && (
        <ul
          className={`mt-1 ${MUTED}`}
          data-ui-bridge-id={`${uiBridgeId}.unresolved`}
        >
          {cp.unresolved_results.map((u, i) => (
            <li key={u.finding_id ?? i}>{unresolvedResultText(u)}</li>
          ))}
        </ul>
      )}
      {cp.report && (
        <ReportPanel
          metricName={metric.name}
          report={cp.report}
          uiBridgeId={`${uiBridgeId}.report`}
        />
      )}
      {cp.report?.block_warnings.length ? (
        <p className={`mt-1 text-xs text-muted-foreground`}>
          {cp.report.block_warnings.length === 1
            ? "1 note about the reported result"
            : `${cp.report.block_warnings.length} notes about the reported result`}
          : {cp.report.block_warnings.join("; ")}
        </p>
      ) : null}
      <details className="mt-1" data-ui-bridge-id={`${uiBridgeId}.criteria`}>
        <summary className={DISCLOSURE}>Show each criterion</summary>
        <div className="mt-1">
          <CriterionList
            metric={metric}
            items={cp.criteria}
            undeclared={undeclared}
            uiBridgeId={`${uiBridgeId}.rows`}
          />
        </div>
      </details>
      {cp.history.length > 0 && (
        <div className="mt-2" data-ui-bridge-id={`${uiBridgeId}.history`}>
          <p className={MUTED}>
            {cp.history.length === 1
              ? "1 earlier report for this checkpoint"
              : `${cp.history.length} earlier reports for this checkpoint`}
          </p>
          {cp.history.map((r) => {
            const hid = `${uiBridgeId}.history.${bridgeSafe(r.finding_id)}`;
            const extra = r.rows.filter((row) => !row.declared);
            return (
              <Fragment key={r.finding_id}>
                <ReportPanel
                  metricName={metric.name}
                  report={r}
                  label={`Open the earlier report${
                    shortDay(r.created_at)
                      ? ` of ${shortDay(r.created_at)}`
                      : ""
                  }`}
                  uiBridgeId={hid}
                />
                {/* D5: an undeclared row is shown under ITS report. */}
                {extra.length > 0 && (
                  <CriterionList
                    metric={metric}
                    items={[]}
                    undeclared={extra}
                    uiBridgeId={`${hid}.undeclared`}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </li>
  );
}

export function CheckpointResults({
  metric,
  uiBridgeId,
}: {
  metric: MetricRead;
  uiBridgeId: string;
}) {
  return (
    <ul className="divide-y divide-border" data-ui-bridge-id={uiBridgeId}>
      {metric.checkpoint_results.map((cp) => (
        <CheckpointBlock
          key={cp.id}
          metric={metric}
          cp={cp}
          uiBridgeId={`${uiBridgeId}.${bridgeSafe(cp.id)}`}
        />
      ))}
    </ul>
  );
}
