"use client";

/**
 * `report-scorecard table=<id>` — a rows × columns score table at the stop
 * the page shows (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * An ordinary HTML table: a caption saying what it measures and on what
 * scale, column and row headers carrying their plain-language help, and a
 * cell per score. Each cell carries its change since the compared stop —
 * ↑ / ↓ / = / new / unknown — as a shape plus a word, never colour alone. A
 * score the stop did not measure reads "not measured", with its reason in the
 * tooltip and in screen-reader text; never a `0`, a dash or a blank.
 */

import type { components } from "@/lib/api-client/generated-types";
import type { ReportBlockProps, ReportScorecardArgs } from "./blockArgs";
import {
  BlockFrame,
  BlockNotice,
  ReportContextLine,
  ReportNotReady,
  StopProvenance,
} from "./blockChrome";
import { DeltaMark, formatValue } from "./delta";
import {
  snapshotDoc,
  useReport,
  type ReadyReport,
  type SnapshotChanges,
} from "./ReportContext";
import { NotMeasured, Served, servedText } from "./served";
import { betterWords, deltaOf } from "./vocabulary";

type Schemas = components["schemas"];
type Table = Schemas["SnapshotTable"];
type Cell = Schemas["SnapshotCell"];
type CellChange = Schemas["CellChange"];

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}\u0000${columnId}`;
}

function ScoreCell({
  cell,
  change,
  comparing,
  comparedLabel,
  better,
}: {
  cell: Cell | undefined;
  change: CellChange | undefined;
  comparing: boolean;
  comparedLabel: string;
  better: "higher" | "lower";
}) {
  if (cell === undefined) {
    // The contract requires a cell for every column; a missing one is not
    // a score of anything.
    return <NotMeasured reason="this stop has no score here" compact />;
  }
  // No entry in `changes` means the score did not move; an entry says from
  // what (or that the compared stop had no such cell).
  const previous = change ? (change.new ? undefined : change.from) : cell.value;
  return (
    <>
      {cell.value === null ? (
        <NotMeasured reason={cell.unknown_reason} compact />
      ) : (
        <span className="text-foreground">{formatValue(cell.value)}</span>
      )}
      {comparing && (
        <DeltaMark
          kind={deltaOf(previous, cell.value)}
          previous={previous}
          current={cell.value}
          comparedLabel={comparedLabel}
          better={better}
        />
      )}
    </>
  );
}

function ScoreTable({
  table,
  changes,
  comparedLabel,
  uiBridgeId,
}: {
  table: Table;
  changes: SnapshotChanges | null;
  comparedLabel: string;
  uiBridgeId: string;
}) {
  const moved = new Map(
    (changes?.cells ?? [])
      .filter((c) => c.table_id === table.id)
      .map((c) => [cellKey(c.row_id, c.column_id), c] as const)
  );
  const comparing = changes !== null;
  const { scale } = table;
  const rowsOf = (
    rows: readonly {
      id: string;
      label: string;
      help?: string | null;
      cells: Record<string, Cell>;
    }[],
    part: "row" | "summary"
  ) =>
    rows.map((row) => (
      <tr
        key={row.id}
        className="border-t border-border/60"
        data-ui-bridge-id={`${uiBridgeId}.${part}.${row.id}`}
      >
        <th
          scope="row"
          className="py-1.5 pr-3 text-left font-normal text-foreground"
          title={row.help ? servedText(row.help) : undefined}
        >
          <Served text={row.label} />
          {row.help && (
            <span className="sr-only">
              {" — "}
              <Served text={row.help} />
            </span>
          )}
        </th>
        {table.columns.map((column) => (
          <td
            key={column.id}
            className="whitespace-nowrap px-2 py-1.5"
            data-ui-bridge-id={`${uiBridgeId}.cell.${row.id}.${column.id}`}
          >
            <ScoreCell
              cell={row.cells[column.id]}
              change={moved.get(cellKey(row.id, column.id))}
              comparing={comparing}
              comparedLabel={comparedLabel}
              better={scale.better}
            />
          </td>
        ))}
      </tr>
    ));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="mb-2 text-left">
          <span className="block font-medium text-foreground">
            <Served text={table.title} />
          </span>
          <span className="block text-muted-foreground">
            <Served text={table.caption} />
          </span>
          <span className="block text-xs text-muted-foreground">
            Scale {formatValue(scale.min)} to {formatValue(scale.max)},{" "}
            {betterWords(scale.better).toLowerCase()}
            {scale.target !== null
              ? `, target ${formatValue(scale.target)}`
              : ""}
            .
          </span>
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="py-1.5 pr-3 text-left font-medium text-muted-foreground"
            >
              <Served text={table.row_header} />
            </th>
            {table.columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="px-2 py-1.5 text-left font-medium text-muted-foreground"
                title={servedText(column.help)}
              >
                <Served text={column.label} />
                <span className="sr-only">
                  {" — "}
                  <Served text={column.help} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rowsOf(table.rows, "row")}</tbody>
        {table.summary_rows.length > 0 && (
          <tfoot className="font-medium">
            {rowsOf(table.summary_rows, "summary")}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Scorecard({
  report,
  tableId,
  uiBridgeId,
}: {
  report: ReadyReport;
  tableId: string;
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
  const doc = snapshotDoc(selected);
  const table = doc?.tables.find((t) => t.id === tableId) ?? null;
  const changes = selected.changes_since_previous;
  const comparedLabel = compared
    ? servedText(compared.label)
    : "the stop before";
  return (
    <>
      <ReportContextLine title={view.report.title} stop={selected} />
      {doc === null ? (
        <BlockNotice
          tone="problem"
          title="This stop's details can't be read."
          uiBridgeId={`${uiBridgeId}.unreadable`}
        />
      ) : table === null ? (
        <BlockNotice
          tone="problem"
          title={
            <>
              This stop has no table <code>{tableId}</code>.
            </>
          }
          detail="Check the table's id in this block's settings, or choose another stop."
          uiBridgeId={`${uiBridgeId}.no-table`}
        />
      ) : (
        <>
          <ScoreTable
            table={table}
            changes={changes}
            comparedLabel={comparedLabel}
            uiBridgeId={uiBridgeId}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {changes === null ? (
              "This is the report's first stop, so no changes are shown."
            ) : (
              <>
                Changes are since{" "}
                {compared ? (
                  <Served text={compared.label} />
                ) : (
                  "the stop before"
                )}
                .
              </>
            )}
          </p>
          <StopProvenance stop={selected} />
        </>
      )}
    </>
  );
}

export function ReportScorecard({
  args,
  report: slug,
}: ReportBlockProps<ReportScorecardArgs>) {
  const state = useReport(slug);
  const uiBridgeId = `overview.report.${slug}.scorecard.${args.table}`;
  return (
    <BlockFrame
      name="report-scorecard"
      uiBridgeId={uiBridgeId}
      label="Report scorecard"
    >
      {state.status === "ready" ? (
        <Scorecard
          report={state}
          tableId={args.table}
          uiBridgeId={uiBridgeId}
        />
      ) : (
        <ReportNotReady state={state} uiBridgeId={uiBridgeId} />
      )}
    </BlockFrame>
  );
}
