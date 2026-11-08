"use client";

/**
 * `report-changes` — "What changed since <compared stop>", in sentences (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D10): the scores that moved, the figures that moved, the items whose status
 * changed, and the dated events in the interval. The changes are the
 * server's (`changes_since_previous`), computed against the stop before in
 * time order; this block only says them.
 *
 * Two stops measured differently — a full review against a light check — do
 * not compare like for like, so the block says "Different method — compare
 * with care" whenever the server marks the method as changed.
 */

import type { components } from "@/lib/api-client/generated-types";
import { formatDay } from "@/app/(app)/overview/_lib/timeline";
import type { ReportBlockProps, ReportChangesArgs } from "./blockArgs";
import {
  BlockFrame,
  BlockNotice,
  ReportContextLine,
  ReportNotReady,
  StopProvenance,
} from "./blockChrome";
import { formatValue } from "./delta";
import { snapshotDoc, useReport, type ReadyReport } from "./ReportContext";
import { NotMeasured, Served, servedText } from "./served";
import { VERDICT, methodWords, statusWords } from "./vocabulary";

type Schemas = components["schemas"];
type Doc = Schemas["ReportSnapshotDoc"];

/** Said when the stop that held a reason is not on this page. */
const REASON_ON_THAT_STOP = "its reason is recorded with that stop";

function value(v: number | null, reason: string | null) {
  return v === null ? <NotMeasured reason={reason} /> : formatValue(v);
}

/** A table row of a document, summary rows included. */
function rowIn(doc: Doc | null, tableId: string, rowId: string) {
  const table = doc?.tables.find((t) => t.id === tableId);
  return [...(table?.rows ?? []), ...(table?.summary_rows ?? [])].find(
    (r) => r.id === rowId
  );
}

function verdictWord(verdict: string | null): string {
  return verdict === "met" || verdict === "missed" || verdict === "unknown"
    ? VERDICT[verdict].word.toLowerCase()
    : "unknown";
}

function Changes({
  report,
  uiBridgeId,
}: {
  report: ReadyReport;
  uiBridgeId: string;
}) {
  const { selected, compared, view } = report;
  if (!selected) {
    return (
      <BlockNotice
        title="No stops have been published for this report yet."
        uiBridgeId={`${uiBridgeId}.empty`}
      />
    );
  }
  const changes = selected.changes_since_previous;
  const header = (
    <ReportContextLine title={view.report.title} stop={selected} />
  );
  if (changes === null) {
    return (
      <>
        {header}
        <BlockNotice
          title="This is the report's first stop, so there is nothing earlier to compare it with."
          uiBridgeId={`${uiBridgeId}.first`}
        />
      </>
    );
  }
  const doc: Doc | null = snapshotDoc(selected);
  // The compared stop's own document, for the reason a value it did not
  // measure was not measured — when that stop is on this page.
  const before: Doc | null = snapshotDoc(compared);
  const comparedName = compared ? (
    <Served text={compared.label} />
  ) : (
    "the stop before"
  );
  const tableOf = (id: string) => doc?.tables.find((t) => t.id === id);
  const rowOf = (tableId: string, rowId: string) => rowIn(doc, tableId, rowId);
  const cellReason = (tableId: string, rowId: string, columnId: string) =>
    rowOf(tableId, rowId)?.cells[columnId]?.unknown_reason ?? null;
  const cellReasonBefore = (
    tableId: string,
    rowId: string,
    columnId: string
  ) =>
    before
      ? (rowIn(before, tableId, rowId)?.cells[columnId]?.unknown_reason ?? null)
      : REASON_ON_THAT_STOP;
  const columnOf = (tableId: string, columnId: string) =>
    tableOf(tableId)?.columns.find((c) => c.id === columnId);
  const figureOf = (id: string) => doc?.figures.find((f) => f.id === id);
  const figureReasonBefore = (id: string) =>
    before
      ? (before.figures.find((f) => f.id === id)?.unknown_reason ?? null)
      : REASON_ON_THAT_STOP;
  const itemOf = (id: string) => doc?.items.find((i) => i.id === id);
  const name = (text: string | undefined, fallback: string) =>
    text === undefined ? fallback : <Served text={text} />;

  const nothing =
    changes.cells.length === 0 &&
    changes.figures.length === 0 &&
    changes.items.length === 0 &&
    changes.events.length === 0;

  return (
    <>
      {header}
      <h3 className="font-medium text-foreground">
        What changed since {comparedName}
      </h3>
      {changes.method_changed && (
        <div
          role="note"
          className="mt-2 border-l-2 border-amber-500 pl-3"
          data-ui-bridge-id={`${uiBridgeId}.method-changed`}
        >
          <p className="text-foreground">
            <span aria-hidden>⚠ </span>Different method — compare with care
          </p>
          <p className="text-xs text-muted-foreground">
            {compared
              ? `${servedText(compared.label)} was a ${methodWords(compared.method_kind).toLowerCase()}; this stop is a ${methodWords(selected.method_kind).toLowerCase()}. Not every difference is a change in the project.`
              : `This stop was measured by a different method from the stop before. Not every difference is a change in the project.`}
          </p>
        </div>
      )}
      {nothing ? (
        <p
          className="mt-2 text-muted-foreground"
          data-ui-bridge-id={`${uiBridgeId}.nothing`}
        >
          Nothing changed since {comparedName}.
        </p>
      ) : (
        <ul className="mt-2 space-y-1" data-ui-bridge-id={`${uiBridgeId}.list`}>
          {changes.cells.map((c) => (
            <li key={`cell:${c.table_id}:${c.row_id}:${c.column_id}`}>
              {name(tableOf(c.table_id)?.title, "A table")}:{" "}
              {name(rowOf(c.table_id, c.row_id)?.label, "a row")},{" "}
              {name(columnOf(c.table_id, c.column_id)?.label, "a column")}{" "}
              {c.new ? (
                <>
                  is new:{" "}
                  {value(c.to, cellReason(c.table_id, c.row_id, c.column_id))}.
                </>
              ) : (
                <>
                  went from{" "}
                  {value(
                    c.from,
                    cellReasonBefore(c.table_id, c.row_id, c.column_id)
                  )}{" "}
                  to{" "}
                  {value(c.to, cellReason(c.table_id, c.row_id, c.column_id))}.
                </>
              )}
            </li>
          ))}
          {changes.figures.map((f) => {
            const figure = figureOf(f.figure_id);
            return (
              <li key={`figure:${f.figure_id}`}>
                {name(figure?.label, "A figure")}{" "}
                {f.new ? (
                  <>is new: {value(f.to, figure?.unknown_reason ?? null)}</>
                ) : (
                  <>
                    went from {value(f.from, figureReasonBefore(f.figure_id))}{" "}
                    to {value(f.to, figure?.unknown_reason ?? null)}
                  </>
                )}
                {f.verdict_from !== f.verdict_to
                  ? f.verdict_from === null
                    ? `; its verdict is ${verdictWord(f.verdict_to)}.`
                    : `; its verdict went from ${verdictWord(f.verdict_from)} to ${verdictWord(f.verdict_to)}.`
                  : "."}
              </li>
            );
          })}
          {changes.items.map((i) => (
            <li key={`item:${i.item_id}`}>
              {name(itemOf(i.item_id)?.label, "An item")}{" "}
              {i.new || i.from_status === null
                ? `is new: ${statusWords(i.to_status).label}.`
                : `went from ${statusWords(i.from_status).label} to ${statusWords(i.to_status).label}.`}
            </li>
          ))}
          {changes.events.map((e, n) => (
            <li key={`event:${e.item_id}:${e.at}:${n}`}>
              {formatDay(e.at) ?? e.at}: <Served text={e.label} />
              {itemOf(e.item_id) && (
                <>
                  {" ("}
                  <Served text={itemOf(e.item_id)!.label} />
                  {")"}
                </>
              )}
              .
            </li>
          ))}
        </ul>
      )}
      <StopProvenance stop={selected} />
    </>
  );
}

export function ReportChanges({
  report: slug,
}: ReportBlockProps<ReportChangesArgs>) {
  const state = useReport(slug);
  const uiBridgeId = `overview.report.${slug}.changes`;
  return (
    <BlockFrame
      name="report-changes"
      uiBridgeId={uiBridgeId}
      label="What changed in the report"
    >
      {state.status === "ready" ? (
        <Changes report={state} uiBridgeId={uiBridgeId} />
      ) : (
        <ReportNotReady state={state} uiBridgeId={uiBridgeId} />
      )}
    </BlockFrame>
  );
}
