"use client";

/**
 * A metric's declared checkpoints, each with its due date, a met / missed /
 * unknown triple, the line that says how it stands (plan
 * `2026-10-06-overview-objectives-view` D5: awaiting, no report found, a
 * possible report not yet recorded, results can't be read — each its own
 * words, none ever MISSED or blank), the report inline, and the
 * per-criterion rows one disclosure down. Why a read failed, the recorded
 * reports that could not be shown and the validator's notes (field paths
 * such as `rows[0].cause`) are mechanics, so they sit in "How this was
 * checked", never on the card face (D10 R8).
 */

import { Fragment } from "react";
import {
  checkpointStatusCopy,
  DEFINITION_UNKNOWN,
  dueWords,
  howCheckedCount,
  placementDisagreement,
  shortDay,
  unresolvedResultLine,
} from "../../_lib/objectives";
import type {
  CheckpointResultRead,
  MetricRead,
  UnresolvedResultRead,
} from "../../_lib/objectives-api";
import { CriterionList } from "./CriterionRows";
import { ReportPanel } from "./ReportPanel";
import { TallyMarks } from "./VerdictMark";
import { DISCLOSURE, MUTED, NOTICE, bridgeSafe } from "./ui";

/** The mechanics behind a status: why a read failed, the recorded reports
 *  that could not be shown, and the notes the result's validator left. One
 *  disclosure down; its summary says how many of each there are. */
export function HowChecked({
  why,
  unresolved = [],
  notes = [],
  uiBridgeId,
}: {
  why: string | null;
  unresolved?: UnresolvedResultRead[];
  notes?: string[];
  uiBridgeId: string;
}) {
  if (!why && unresolved.length === 0 && notes.length === 0) return null;
  const count = howCheckedCount(unresolved.length, notes.length);
  return (
    <details className="mt-1" data-ui-bridge-id={uiBridgeId}>
      <summary className={DISCLOSURE}>
        How this was checked{count ? ` (${count})` : ""}
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {why && (
          <>
            <dt>Why</dt>
            <dd
              className="break-words font-mono"
              data-ui-bridge-id={`${uiBridgeId}.why`}
            >
              {why}
            </dd>
          </>
        )}
        {unresolved.map((u, i) => (
          <Fragment key={`unresolved-${i}-${u.finding_id ?? "none"}`}>
            <dt>Recorded report</dt>
            <dd
              className="break-words font-mono"
              data-ui-bridge-id={`${uiBridgeId}.unresolved.${i}`}
            >
              {unresolvedResultLine(u)}
            </dd>
          </Fragment>
        ))}
        {notes.map((note, i) => (
          <Fragment key={`${i}-${note}`}>
            <dt>Note</dt>
            <dd className="break-words font-mono">{note}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

function CheckpointBlock({
  metric,
  cp,
  uiBridgeId,
}: {
  metric: MetricRead;
  cp: CheckpointResultRead;
  uiBridgeId: string;
}) {
  // The definition can't be read, so nothing it declares is known: not this
  // checkpoint's due date, nor whether it declares the checkpoint at all.
  const definitionUnreadable = !!metric.frontmatter_error;
  const copy = checkpointStatusCopy(cp, { definitionUnreadable });
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
            {` · ${dueWords(cp, definitionUnreadable)}`}
          </span>
        </p>
        {definitionUnreadable ? (
          // No criteria can be declared when the definition can't be read,
          // so a 0 / 0 / 0 tally would claim a count nobody could make.
          <span className={MUTED} data-ui-bridge-id={`${uiBridgeId}.tally`}>
            <span aria-hidden>? </span>
            Criteria: {DEFINITION_UNKNOWN.toLowerCase()}
          </span>
        ) : (
          <TallyMarks tally={cp.tally} uiBridgeId={`${uiBridgeId}.tally`} />
        )}
      </div>
      {!cp.declared && (
        <p className={MUTED} data-ui-bridge-id={`${uiBridgeId}.undeclared`}>
          {definitionUnreadable
            ? "Whether the document declares this checkpoint is unknown (the definition can't be read)."
            : "This checkpoint is named by a report, not by the document."}
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
      </p>
      <HowChecked
        // With no report, the status's reason IS the unresolved entries
        // (the read joins their details into it), so they are listed and
        // the reason is not said twice.
        why={
          cp.report || cp.unresolved_results.length === 0 ? copy.detail : null
        }
        unresolved={cp.unresolved_results}
        notes={cp.report?.block_warnings ?? []}
        uiBridgeId={`${uiBridgeId}.checked`}
      />
      {disagreement && (
        <p
          className={`mt-1 ${MUTED}`}
          data-ui-bridge-id={`${uiBridgeId}.placement-disagreement`}
        >
          {disagreement}
        </p>
      )}
      {cp.report && (
        <ReportPanel
          metricName={metric.name}
          report={cp.report}
          definitionUnreadable={definitionUnreadable}
          uiBridgeId={`${uiBridgeId}.report`}
        />
      )}
      <details className="mt-1" data-ui-bridge-id={`${uiBridgeId}.criteria`}>
        <summary className={DISCLOSURE}>Show each criterion</summary>
        <div className="mt-1">
          <CriterionList
            metric={metric}
            items={cp.criteria}
            undeclared={undeclared}
            undeclaredReport={cp.report}
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
                  definitionUnreadable={definitionUnreadable}
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
                    undeclaredReport={r}
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
