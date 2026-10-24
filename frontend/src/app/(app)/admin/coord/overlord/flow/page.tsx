"use client";

/**
 * /admin/coord/overlord/flow — does the overlord actually move sessions?
 *
 * Plan `2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`
 * Phase 4. Reads coord's `GET /coord/overlord/flow` through the web proxy —
 * ONE payload, derived by coord over the window's `/triage-sessions` passes:
 * time from a session first stopping to its close, what a nudge led to, which
 * sessions sat unchanged pass after pass, the UNKNOWN share of the latest
 * pass, and each pass's verdict histogram.
 *
 * ## Structure (the `/admin/coord/verification` shape)
 *
 * - **R1** — a `<HealthStrip>` DERIVED from that one payload
 *   (`deriveFlowHealth`); no second fetch.
 * - **Window picker** — 24h / 7d / 30d (`window_hours` 24 / 168 / 720).
 * - **Metric tiles** — one `<StatCluster>` per metric under its heading, so
 *   the numbers compose the console's existing count vocabulary rather than
 *   minting a tile component (§6.4).
 * - **Unchanged sessions** — `<RecordList>` of `<UnchangedRow>`; each opens to
 *   the per-session console view when a Claude session id was proven.
 * - **Verdicts per pass** — the histogram over time, in a `<CollapsiblePanel>`
 *   with an `sr-only` table (R7).
 *
 * **Three states per number** (`overlordFlowStatus.ts`): measured; coord's
 * explicit `null`, rendered as a labelled "no data"; and unknown, rendered as
 * `–`. A failed read before any answer is UNKNOWN everywhere
 * (`readIsUnknown`) — never a zero, never an empty list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HealthStrip,
  RecordList,
  RefreshButton,
  StatCluster,
  readIsUnknown,
  type Stat,
} from "@/components/console";
import { fetchOverlordFlow } from "@/lib/api/operations/overlordFlow";
import { UnchangedRow } from "./_components/UnchangedRow";
import { VerdictHistogramChart } from "./_components/VerdictHistogramChart";
import {
  FLOW_WINDOWS,
  MALFORMED_FAILURE,
  NO_DATA,
  deriveFlowHealth,
  durationWords,
  failureSentence,
  flowQuery,
  flowWindow,
  histogramPoints,
  metricTitle,
  metricValue,
  parseFlowReadFailure,
  percentWords,
  readFlowBody,
  type FlowReadFailure,
  type FlowView,
  type FlowWindowId,
} from "./_lib/overlordFlowStatus";

function countValue(n: number | undefined): number | null {
  return n === undefined ? null : n;
}

const UNKNOWN_TITLE = "unknown — coord's answer did not carry this number";

function MetricTile({
  title,
  explain,
  stats,
  testId,
}: {
  title: string;
  explain: string;
  stats: Stat[];
  testId: string;
}) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
        {title}
      </h2>
      <StatCluster stats={stats} />
      <p className="text-[11px] text-muted-foreground m-0">{explain}</p>
    </section>
  );
}

function timeToCloseStats(v: FlowView | null): Stat[] {
  const t = v?.timeToClose;
  const noData = "no session that stopped in this window has been closed yet";
  return [
    {
      key: "median",
      label: "median",
      value: t ? metricValue(t.medianSecs, durationWords) : null,
      title: t ? metricTitle(t.medianSecs, noData) : UNKNOWN_TITLE,
      "data-testid": "overlord-flow-ttc-median",
    },
    {
      key: "p90",
      label: "p90",
      value: t ? metricValue(t.p90Secs, durationWords) : null,
      title: t ? metricTitle(t.p90Secs, noData) : UNKNOWN_TITLE,
      "data-testid": "overlord-flow-ttc-p90",
    },
    {
      key: "count",
      label: "closed",
      value: countValue(t?.count),
      "data-testid": "overlord-flow-ttc-count",
    },
    {
      key: "triage",
      label: "by triage",
      value: countValue(t?.byTriage),
      tone: "muted",
      title: "closed by triage's own close action",
      "data-testid": "overlord-flow-ttc-triage",
    },
    {
      key: "absent",
      label: "gone from a full pass",
      value: countValue(t?.byAbsent),
      tone: "muted",
      title: "no longer present in a later full pass on the same runner",
      "data-testid": "overlord-flow-ttc-absent",
    },
  ];
}

function nudgeProgressStats(v: FlowView | null): Stat[] {
  const n = v?.nudge;
  return [
    {
      key: "rate",
      label: "progressed",
      value: n ? metricValue(n.progressRate, percentWords) : null,
      title: n
        ? metricTitle(n.progressRate, "no nudge was sent in this window")
        : UNKNOWN_TITLE,
      "data-testid": "overlord-flow-nudge-progress-rate",
    },
    {
      key: "progressed",
      label: "of nudged",
      value:
        n && n.progressed !== undefined && n.nudged !== undefined
          ? `${n.progressed}/${n.nudged}`
          : null,
      "data-testid": "overlord-flow-nudge-counts",
    },
    {
      key: "unmeasured",
      label: "unmeasured",
      value: countValue(n?.unmeasured),
      tone: "muted",
      title:
        "nudges whose following rows never measured progress — counted apart, never as no progress",
      "data-testid": "overlord-flow-nudge-unmeasured",
    },
  ];
}

function nudgeFinishStats(v: FlowView | null): Stat[] {
  const n = v?.nudge;
  return [
    {
      key: "rate",
      label: "finished",
      value: n ? metricValue(n.finishRate, percentWords) : null,
      title: n
        ? metricTitle(n.finishRate, "no nudge was sent in this window")
        : UNKNOWN_TITLE,
      "data-testid": "overlord-flow-nudge-finish-rate",
    },
    {
      key: "finished",
      label: "of nudged",
      value:
        n && n.finished !== undefined && n.nudged !== undefined
          ? `${n.finished}/${n.nudged}`
          : null,
      "data-testid": "overlord-flow-nudge-finish-counts",
    },
  ];
}

const NO_PASS_TITLE = "no data — no pass was recorded in this window";

function unknownShareStats(v: FlowView | null): Stat[] {
  const latest = v?.latestUnknown;
  const share =
    latest === undefined || v === null
      ? undefined
      : latest === null
        ? null
        : latest.share;
  return [
    {
      key: "share",
      label: "unknown",
      value: metricValue(share, percentWords),
      title:
        latest === null
          ? NO_PASS_TITLE
          : share === null
            ? "no data — the latest pass screened no terminal"
            : share === undefined
              ? UNKNOWN_TITLE
              : undefined,
      tone: typeof share === "number" && share > 0 ? "warning" : "default",
      "data-testid": "overlord-flow-unknown-share",
    },
    {
      key: "rows",
      label: "of rows",
      // Coord's empty list says the same thing for both stats: no pass, so
      // "no data" — never a `–` (unknown) beside a "no data" share.
      value:
        latest === null
          ? NO_DATA
          : latest
            ? `${latest.unknownRows}/${latest.rows}`
            : null,
      title:
        latest === null ? NO_PASS_TITLE : latest ? undefined : UNKNOWN_TITLE,
      "data-testid": "overlord-flow-unknown-rows",
    },
  ];
}

export default function CoordOverlordFlowPage() {
  const [windowId, setWindowId] = useState<FlowWindowId>("7d");
  const [view, setView] = useState<FlowView | null>(null);
  /** True once a read has SUCCEEDED for the current window. */
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failure, setFailure] = useState<FlowReadFailure | null>(null);
  /** Only the newest read may land — a window change supersedes the rest. */
  const reqRef = useRef(0);

  const fetchFlow = useCallback(async () => {
    const req = ++reqRef.current;
    try {
      const body = readFlowBody(await fetchOverlordFlow(flowQuery(windowId)));
      if (reqRef.current !== req) return;
      if (!body) {
        setFailed(true);
        setFailure(MALFORMED_FAILURE);
        return;
      }
      setView(body);
      setLoaded(true);
      setFailed(false);
      setFailure(null);
    } catch (e) {
      if (reqRef.current !== req) return;
      setFailed(true);
      setFailure(parseFlowReadFailure(e));
    }
  }, [windowId]);

  useEffect(() => {
    // A new window owns nothing the old one read: its numbers are about a
    // different span, so they go, and "loaded" with them — a failure of the
    // new read is then UNKNOWN, never the old numbers relabelled.
    setView(null);
    setLoaded(false);
    setFailed(false);
    setFailure(null);
    void fetchFlow();
  }, [fetchFlow]);

  const win = flowWindow(windowId);
  const health = useMemo(
    () => deriveFlowHealth({ view, loaded, failed, failure, windowId }),
    [view, loaded, failed, failure, windowId]
  );
  const unknown = readIsUnknown(loaded, failed);
  const shown = loaded ? view : null;
  const points = useMemo(
    () => (shown?.series ? histogramPoints(shown.series) : null),
    [shown]
  );

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-overlord-flow-page"
    >
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-overlord-flow-health"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {FLOW_WINDOWS.map((w) => (
          <Button
            key={w.id}
            size="sm"
            variant={windowId === w.id ? "secondary" : "ghost"}
            aria-pressed={windowId === w.id}
            onClick={() => setWindowId(w.id)}
            data-testid={`overlord-flow-window-${w.id}`}
          >
            {w.id}
          </Button>
        ))}
        <RefreshButton
          onRefresh={fetchFlow}
          label="Refresh session flow"
          title="Re-reads coord's flow metrics for the selected window now"
          data-testid="overlord-flow-refresh"
        />
        {unknown && failure && (
          <p
            className="text-xs text-muted-foreground m-0"
            data-testid="overlord-flow-unknown"
          >
            Unknown — {failureSentence(failure)}. Every number below is a dash,
            not a zero.
          </p>
        )}
      </div>

      <div
        className="grid gap-4 sm:grid-cols-2"
        data-testid="overlord-flow-tiles"
      >
        <MetricTile
          title="Time to close"
          explain="From a session's first STOPPED row to its close — by triage, or by being gone from a later full pass."
          stats={timeToCloseStats(shown)}
          testId="overlord-flow-tile-ttc"
        />
        <MetricTile
          title="Nudge → progress"
          explain="Nudges followed, within the next passes, by a work tool call."
          stats={nudgeProgressStats(shown)}
          testId="overlord-flow-tile-nudge-progress"
        />
        <MetricTile
          title="Nudge → finished"
          explain="Nudges followed, within the next passes, by a finished verdict or a close."
          stats={nudgeFinishStats(shown)}
          testId="overlord-flow-tile-nudge-finished"
        />
        <MetricTile
          title="Unknown share, latest pass"
          explain="Terminals the most recent pass could not classify."
          stats={unknownShareStats(shown)}
          testId="overlord-flow-tile-unknown"
        />
      </div>

      <section className="space-y-2" data-testid="overlord-flow-unchanged">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
          Unchanged across consecutive full passes
        </h2>
        <RecordList
          items={shown?.unchanged ?? []}
          itemKey={(r) => r.key}
          loaded={loaded || failed}
          skeletonRows={3}
          renderRow={(r, ctx) => (
            <UnchangedRow
              row={r}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
          empty={
            unknown ? (
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-unchanged-unknown"
              >
                Unknown —{" "}
                {failure ? failureSentence(failure) : "the read did not land"}.
                This is not an empty list.
              </p>
            ) : shown && shown.unchanged === null ? (
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-unchanged-absent"
              >
                Unknown — coord&apos;s answer did not carry the unchanged list.
              </p>
            ) : failed ? (
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-unchanged-stale-empty"
              >
                None at the last good read — the latest refresh failed, so this
                may no longer hold.
              </p>
            ) : shown && shown.passesConsidered === 0 ? (
              // An empty list over NO pass is not an all-clear: nothing was
              // screened, so nothing could be seen staying unchanged.
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-unchanged-no-pass"
              >
                No triage pass recorded in {win.words} — no session could be
                seen staying unchanged, so this is not an all-clear.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-unchanged-empty"
              >
                No session held the same verdict and reasons across consecutive
                full passes in {win.words}.
              </p>
            )
          }
        />
      </section>

      <VerdictHistogramChart points={points} windowWords={win.words} />
    </div>
  );
}
