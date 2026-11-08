"use client";

/**
 * `report-figures set=<id or all>` — a report's headline figures at the stop
 * the page shows (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * Each figure: its value and unit, its baseline and target, which way is
 * better, its verdict (met / missed / unknown — a shape and a word), its
 * source and as-of, its change since the compared stop, and a small trend
 * over every stop on the page. A stop that did not measure it is a GAP in the
 * trend, never a zero; a value the stop did not measure reads
 * "not measured — <reason>".
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, YAxis } from "recharts";
import { Provenance } from "@/components/presentation/Provenance";
import { colors } from "@/config/theme";
import type { components } from "@/lib/api-client/generated-types";
import type { ReportBlockProps, ReportFiguresArgs } from "./blockArgs";
import {
  BlockFrame,
  BlockNotice,
  ReportContextLine,
  ReportNotReady,
} from "./blockChrome";
import { DeltaMark, formatValue } from "./delta";
import { snapshotDoc, useReport, type ReadyReport } from "./ReportContext";
import { NotMeasured, Served, servedText } from "./served";
import { VERDICT, betterWords, deltaOf } from "./vocabulary";

type Figure = components["schemas"]["SnapshotFigure"];

interface TrendPoint {
  seq: number;
  label: string;
  value: number | null;
}

/** The figure at every stop the page shows, oldest first. */
function trendOf(report: ReadyReport, figureId: string): TrendPoint[] {
  return report.stops.map((stop) => {
    const figure = snapshotDoc(stop)?.figures.find((f) => f.id === figureId);
    return {
      seq: stop.seq,
      label: servedText(stop.label),
      value: figure ? figure.value : null,
    };
  });
}

function Trend({
  points,
  target,
}: {
  points: TrendPoint[];
  target: number | null;
}) {
  if (points.length < 2) return null;
  const words = points
    .map((p) =>
      p.value === null
        ? `${p.label}: not measured`
        : `${p.label}: ${formatValue(p.value)}`
    )
    .join("; ");
  return (
    <div className="mt-2" data-trend-points={points.length}>
      {/* The chart is the picture; the sentence beside it is the reading. */}
      <div aria-hidden>
        <LineChart
          width={180}
          height={48}
          data={points}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
        >
          <CartesianGrid vertical={false} strokeOpacity={0.15} />
          <YAxis hide domain={["auto", "auto"]} />
          {target !== null && (
            <ReferenceLine
              y={target}
              stroke={colors.text.muted}
              strokeDasharray="3 3"
            />
          )}
          <Line
            type="linear"
            dataKey="value"
            stroke={colors.brand.primary}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </div>
      <p className="sr-only">Over every stop: {words}.</p>
    </div>
  );
}

function FigureCard({
  figure,
  report,
  uiBridgeId,
}: {
  figure: Figure;
  report: ReadyReport;
  uiBridgeId: string;
}) {
  const { selected, compared } = report;
  const changes = selected?.changes_since_previous ?? null;
  const change = changes?.figures.find((c) => c.figure_id === figure.id);
  // No entry in `changes` means the figure did not move.
  const previous = change
    ? change.new
      ? undefined
      : change.from
    : figure.value;
  const verdict = VERDICT[figure.verdict];
  const comparedLabel = compared
    ? servedText(compared.label)
    : "the stop before";
  return (
    <li
      className="rounded-md border border-border/60 p-3"
      data-ui-bridge-id={`${uiBridgeId}.figure.${figure.id}`}
    >
      <p className="font-medium text-foreground">
        <Served text={figure.label} />
      </p>
      <p className="text-xs text-muted-foreground">
        <Served text={figure.help} />
      </p>
      <p className="mt-2 font-[family-name:var(--font-overview-serif)] text-xl text-foreground">
        {figure.value === null ? (
          <NotMeasured reason={figure.unknown_reason} className="text-sm" />
        ) : (
          <>
            {formatValue(figure.value)}{" "}
            <span className="text-sm text-muted-foreground">
              <Served text={figure.unit} />
            </span>
          </>
        )}
        {changes !== null && (
          <DeltaMark
            kind={deltaOf(previous, figure.value)}
            previous={previous}
            current={figure.value}
            comparedLabel={comparedLabel}
            better={figure.better}
          />
        )}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Starting point</dt>
        <dd className="text-foreground">
          {figure.baseline === null
            ? "no baseline recorded"
            : formatValue(figure.baseline)}
        </dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd className="text-foreground">
          {figure.target === null
            ? "no target set"
            : formatValue(figure.target)}
        </dd>
        <dt className="text-muted-foreground">Direction</dt>
        <dd className="text-foreground">{betterWords(figure.better)}</dd>
        <dt className="text-muted-foreground">Verdict</dt>
        <dd
          className="text-foreground"
          data-verdict={figure.verdict}
          data-ui-bridge-id={`${uiBridgeId}.figure.${figure.id}.verdict`}
        >
          <span aria-hidden>{verdict.shape} </span>
          {verdict.word}
        </dd>
      </dl>
      <Trend points={trendOf(report, figure.id)} target={figure.target} />
      <div className="mt-2">
        <Provenance
          persistent
          source={servedText(figure.source)}
          asOf={figure.measured_at ?? selected?.as_of ?? null}
        />
      </div>
    </li>
  );
}

function Figures({
  report,
  set,
  uiBridgeId,
}: {
  report: ReadyReport;
  set: string;
  uiBridgeId: string;
}) {
  const { selected, view } = report;
  if (!selected) {
    return (
      <BlockNotice
        title="No stops have been published for this report yet."
        uiBridgeId={`${uiBridgeId}.empty`}
      />
    );
  }
  const doc = snapshotDoc(selected);
  const figures =
    doc === null
      ? []
      : set === "all"
        ? doc.figures
        : doc.figures.filter((f) => f.id === set);
  return (
    <>
      <ReportContextLine title={view.report.title} stop={selected} />
      {doc === null ? (
        <BlockNotice
          tone="problem"
          title="This stop's details can't be read."
          uiBridgeId={`${uiBridgeId}.unreadable`}
        />
      ) : figures.length === 0 ? (
        <BlockNotice
          tone={set === "all" ? "info" : "problem"}
          title={
            set === "all" ? (
              "This stop records no headline figures."
            ) : (
              <>
                This stop has no figure <code>{set}</code>.
              </>
            )
          }
          uiBridgeId={`${uiBridgeId}.none`}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {figures.map((figure) => (
            <FigureCard
              key={figure.id}
              figure={figure}
              report={report}
              uiBridgeId={uiBridgeId}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export function ReportFigures({
  args,
  report: slug,
}: ReportBlockProps<ReportFiguresArgs>) {
  const state = useReport(slug);
  const set = args.set ?? "all";
  const uiBridgeId = `overview.report.${slug}.figures.${set}`;
  return (
    <BlockFrame
      name="report-figures"
      uiBridgeId={uiBridgeId}
      label="Report figures"
    >
      {state.status === "ready" ? (
        <Figures report={state} set={set} uiBridgeId={uiBridgeId} />
      ) : (
        <ReportNotReady state={state} uiBridgeId={uiBridgeId} />
      )}
    </BlockFrame>
  );
}
