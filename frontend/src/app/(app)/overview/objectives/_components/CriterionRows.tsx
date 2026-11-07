"use client";

/**
 * Per-criterion rows: what each declared criterion aimed for, the verdict its
 * measurer stated (never recomputed, D4), the value and date behind it, why
 * it is unknown when it is, the cause and next step for a miss, and — one
 * disclosure down — how it was measured (D10 R8: method ids, tool names and
 * gate ids never sit in the card text).
 */

import { Fragment } from "react";
import {
  checkpointName,
  DEFINITION_UNKNOWN,
  outOfDateNotice,
  reportsById,
  shortDay,
  unknownReasonText,
  VERDICT_LOOK,
} from "../../_lib/objectives";
import type {
  CriterionResultRead,
  MetricRead,
  ReportRead,
  ResultRowRead,
} from "../../_lib/objectives-api";
import { openReport } from "./ReportPanel";
import { VerdictMark } from "./VerdictMark";
import { DISCLOSURE, MUTED, TEXT_LINK, bridgeSafe } from "./ui";

const ACTION_WORDS: Record<string, string> = {
  plan: "a plan is written for it",
  pr: "a pull request is open for it",
  gate: "it waits on a recorded condition",
  operator_ask: "a question is put to the project's owner",
};

/** The next step in plain words; its reference sits in the disclosure. */
function actionWords(kind: string): string {
  return ACTION_WORDS[kind] ?? "named in the details below";
}

function MeasuredHow({
  methodDeclared,
  row,
  gateId,
  findingId,
  uiBridgeId,
}: {
  methodDeclared: string | null;
  row: ResultRowRead | null;
  /** The gate the measuring session ran under, from the row's report. */
  gateId: string | null;
  findingId: string | null;
  uiBridgeId: string;
}) {
  const lines: [string, string][] = [];
  if (methodDeclared) lines.push(["Declared method", methodDeclared]);
  if (row?.method) lines.push(["Method used", row.method]);
  if (row?.door) lines.push(["Tools", row.door]);
  if (row?.window)
    lines.push(["Window", `${row.window.from} to ${row.window.to}`]);
  if (row?.value !== null && row?.value !== undefined)
    lines.push(["Value", `${row.value}${row.unit ? ` ${row.unit}` : ""}`]);
  if (row?.action)
    lines.push(["Next step reference", `${row.action.kind} ${row.action.ref}`]);
  if (gateId) lines.push(["Gate", gateId]);
  if (findingId) lines.push(["Report finding", findingId]);
  if (lines.length === 0) return null;
  return (
    <details className="mt-1" data-ui-bridge-id={uiBridgeId}>
      <summary className={DISCLOSURE}>How this was measured</summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lines.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd className="break-words font-mono">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

function ReportButton({
  metricName,
  findingId,
  uiBridgeId,
}: {
  metricName: string;
  findingId: string;
  uiBridgeId: string;
}) {
  return (
    <button
      type="button"
      className={TEXT_LINK}
      onClick={() => openReport(metricName, findingId)}
      data-ui-bridge-id={uiBridgeId}
    >
      Open the report
    </button>
  );
}

export function CriterionRow({
  metric,
  item,
  uiBridgeId,
}: {
  metric: MetricRead;
  item: CriterionResultRead;
  uiBridgeId: string;
}) {
  const measured = shortDay(item.measured_at);
  const row = item.row;
  const stale = outOfDateNotice(item);
  // Only offer "Open the report" for a report this card has a panel for;
  // a button that does nothing would be a broken promise.
  const panels = reportsById(metric);
  const canOpen = (id: string | null | undefined): id is string =>
    !!id && panels.has(id);
  const report = item.finding_id ? panels.get(item.finding_id) : undefined;
  return (
    <li className="py-3" data-ui-bridge-id={uiBridgeId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-[15px] leading-snug text-foreground">
          {item.target ?? "No target text declared for this criterion"}
        </p>
        <VerdictMark
          verdict={item.verdict}
          uiBridgeId={`${uiBridgeId}.verdict`}
        />
      </div>
      {item.verdict === "unknown" ? (
        <p className={MUTED}>
          {unknownReasonText(item.unknown_reason)}
          {measured ? ` (reported ${measured})` : ""}
          {row?.value_text ? ` — ${row.value_text}` : ""}
        </p>
      ) : (
        <p className={MUTED}>
          {row?.value_text}
          {measured
            ? ` — measured ${measured}, at ${checkpointName(metric, item.reported_checkpoint)}`
            : ` — measurement date not stated, at ${checkpointName(metric, item.reported_checkpoint)}`}
        </p>
      )}
      {row?.cause && (
        <p className={MUTED}>
          <span className="text-foreground">Cause:</span> {row.cause}
        </p>
      )}
      {row?.action && (
        <p className={MUTED}>
          <span className="text-foreground">Next step:</span>{" "}
          {actionWords(row.action.kind)}
        </p>
      )}
      {stale && item.out_of_date_notice && (
        <p
          className={`mt-1 ${MUTED}`}
          data-ui-bridge-id={`${uiBridgeId}.out-of-date`}
        >
          <span aria-hidden>? </span>
          {stale}{" "}
          {canOpen(item.out_of_date_notice.finding_id) && (
            <ReportButton
              metricName={metric.name}
              findingId={item.out_of_date_notice.finding_id}
              uiBridgeId={`${uiBridgeId}.out-of-date.open`}
            />
          )}
        </p>
      )}
      {item.earlier.length > 0 && (
        <p className={`mt-1 ${MUTED}`}>
          Earlier:{" "}
          {item.earlier
            .map(
              (e) =>
                `${VERDICT_LOOK[e.verdict].symbol} ${VERDICT_LOOK[e.verdict].word} at ${checkpointName(metric, e.checkpoint)}`
            )
            .join("; ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4">
        <MeasuredHow
          methodDeclared={item.method}
          row={row}
          gateId={report?.gate_id ?? null}
          findingId={item.finding_id}
          uiBridgeId={`${uiBridgeId}.method`}
        />
        {canOpen(item.finding_id) && (
          <ReportButton
            metricName={metric.name}
            findingId={item.finding_id}
            uiBridgeId={`${uiBridgeId}.report`}
          />
        )}
      </div>
    </li>
  );
}

/** A reported row whose id the document does not declare (D5): shown,
 *  flagged, and never counted toward any declared criterion. When the
 *  definition can't be read, nothing is declared that the row could be
 *  checked against, so it is never called "not in the document's list". */
export function UndeclaredRow({
  row,
  report,
  definitionUnreadable,
  uiBridgeId,
}: {
  row: ResultRowRead;
  /** The report the row came in. */
  report: ReportRead | null;
  definitionUnreadable: boolean;
  uiBridgeId: string;
}) {
  return (
    <li className="py-3" data-ui-bridge-id={uiBridgeId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-[15px] leading-snug text-foreground">
          {definitionUnreadable
            ? "A reported row; whether the document lists it is unknown (the definition can’t be read)"
            : "A reported row not in the document’s list"}
        </p>
        <VerdictMark
          verdict={row.verdict}
          uiBridgeId={`${uiBridgeId}.verdict`}
        />
      </div>
      <p className={MUTED}>
        {row.value_text ?? unknownReasonText(row.unknown_reason)} — not counted
        toward any measure.
      </p>
      <MeasuredHow
        methodDeclared={null}
        row={row}
        gateId={report?.gate_id ?? null}
        findingId={report?.finding_id ?? null}
        uiBridgeId={`${uiBridgeId}.method`}
      />
    </li>
  );
}

export function CriterionList({
  metric,
  items,
  undeclared = [],
  undeclaredReport = null,
  uiBridgeId,
}: {
  metric: MetricRead;
  items: CriterionResultRead[];
  undeclared?: ResultRowRead[];
  /** The report the undeclared rows came in. */
  undeclaredReport?: ReportRead | null;
  uiBridgeId: string;
}) {
  const definitionUnreadable = !!metric.frontmatter_error;
  if (items.length === 0 && undeclared.length === 0) {
    return (
      <p className={MUTED} data-ui-bridge-id={`${uiBridgeId}.none`}>
        {definitionUnreadable
          ? `Criteria: ${DEFINITION_UNKNOWN.toLowerCase()}.`
          : "The document declares no criteria for this checkpoint."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border" data-ui-bridge-id={uiBridgeId}>
      {items.map((item) => (
        <CriterionRow
          key={item.id}
          metric={metric}
          item={item}
          uiBridgeId={`${uiBridgeId}.${bridgeSafe(item.id)}`}
        />
      ))}
      {undeclared.map((row) => (
        <UndeclaredRow
          key={`undeclared-${row.id}`}
          row={row}
          report={undeclaredReport}
          definitionUnreadable={definitionUnreadable}
          uiBridgeId={`${uiBridgeId}.undeclared-${bridgeSafe(row.id)}`}
        />
      ))}
    </ul>
  );
}
