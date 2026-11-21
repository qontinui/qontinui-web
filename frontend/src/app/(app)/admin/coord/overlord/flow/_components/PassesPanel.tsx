"use client";

/**
 * The passes behind the numbers: each `/triage-sessions` run in the window, and
 * on opening one, every terminal it screened and what it decided. Reads coord's
 * pass ledger directly (`GET /coord/overlord/passes[/{pass_id}]`), so a number
 * on the page can be followed down to the rows that made it.
 *
 * It is its own read, separate from the flow payload the strip is derived from,
 * and only happens once the panel is opened: `CollapsiblePanel` unmounts its
 * children, and a pass's rows can run to thousands. A failure here says so in
 * here and does not touch the strip.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ListTree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  absoluteTime,
} from "@/components/console";
import {
  fetchOverlordPass,
  fetchOverlordPasses,
} from "@/lib/api/operations/overlordFlow";
import {
  MALFORMED_FAILURE,
  failureSentence,
  flowWindow,
  parseFlowReadFailure,
  passWord,
  versionWords,
  type FlowReadFailure,
  type FlowWindowId,
} from "../_lib/overlordFlowStatus";
import {
  accountWords,
  actionWords,
  passReason,
  passRowHref,
  passesQuery,
  readPassDetail,
  readPassList,
  reasonsWords,
  rowCountMismatch,
  type PassDetail,
  type PassList,
  type PassSummary,
} from "../_lib/overlordPasses";

function PassDetailBody({
  passId,
  refreshNonce,
}: {
  passId: string;
  refreshNonce: number;
}) {
  const [detail, setDetail] = useState<PassDetail | null>(null);
  const [failure, setFailure] = useState<FlowReadFailure | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const body = readPassDetail(await fetchOverlordPass(passId));
        if (!live) return;
        if (body) {
          setDetail(body);
          setFailure(null);
        } else {
          setFailure(MALFORMED_FAILURE);
        }
      } catch (e) {
        if (live) setFailure(parseFlowReadFailure(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [passId, refreshNonce]);

  if (failure && !detail) {
    return (
      <p
        className="text-xs text-muted-foreground italic m-0"
        data-testid="overlord-flow-pass-unknown"
      >
        Unknown — {failureSentence(failure)}. This pass&apos;s rows were not
        read, which is not the same as it having none.
      </p>
    );
  }
  if (!detail) {
    return (
      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="overlord-flow-pass-reading"
      >
        Reading this pass&apos;s rows…
      </p>
    );
  }
  const mismatch = rowCountMismatch(detail);
  return (
    <RecordDetail
      why={
        <div className="space-y-1" data-testid="overlord-flow-pass-meta">
          {failure && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400 m-0"
              data-testid="overlord-flow-pass-stale"
            >
              The latest refresh failed ({failureSentence(failure)}), so these
              rows are the last good read.
            </p>
          )}
          <p className="text-[13px] text-foreground/85 m-0">
            {passWord(detail.scope)} pass, {passWord(detail.mode)}, started{" "}
            {absoluteTime(detail.startedAt)}
            {detail.endedAt
              ? `, ended ${absoluteTime(detail.endedAt)}`
              : detail.endedAt === null
                ? ", no end recorded"
                : ", end unknown"}
            .
          </p>
          <p
            className="text-xs text-muted-foreground m-0"
            data-testid="overlord-flow-pass-skipped"
          >
            {detail.skippedSteps === null
              ? "Skipped steps: unknown."
              : detail.skippedSteps.length === 0
                ? "No step was skipped."
                : `Skipped: ${detail.skippedSteps.join(", ")}.`}
          </p>
          {mismatch && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400 m-0"
              data-testid="overlord-flow-pass-mismatch"
            >
              {mismatch}
            </p>
          )}
        </div>
      }
      actions={
        detail.rows.length === 0 ? (
          <p
            className="text-xs text-muted-foreground m-0"
            data-testid="overlord-flow-pass-no-rows"
          >
            Coord served no row for this pass.
          </p>
        ) : (
          // Focusable: a table with no links in it still has to scroll by keyboard.
          <div
            className="max-h-96 w-full overflow-auto"
            role="region"
            aria-label="Terminals this pass screened"
            tabIndex={0}
          >
            <table
              className="w-full text-left text-xs"
              data-testid="overlord-flow-pass-rows"
            >
              <caption className="sr-only">
                Every terminal this pass screened, unknown verdicts first
              </caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    session
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    verdict
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    account
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    action
                  </th>
                  <th scope="col" className="font-normal pb-1">
                    reasons
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((r) => {
                  const href = passRowHref(r);
                  const name = r.sessionName ?? `terminal ${r.terminalId}`;
                  return (
                    <tr
                      key={r.terminalId}
                      className="align-top"
                      data-testid="overlord-flow-pass-row"
                    >
                      <th scope="row" className="font-normal py-1 pr-3">
                        {href ? (
                          <Link
                            href={href}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </th>
                      <td className="font-mono py-1 pr-3">{r.verdict}</td>
                      <td className="py-1 pr-3">{accountWords(r)}</td>
                      <td className="py-1 pr-3">{actionWords(r)}</td>
                      <td className="py-1">{reasonsWords(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
      raw={
        <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
          pass {detail.passId} · device{" "}
          {detail.deviceId ?? "none or not served"} · runner port{" "}
          {detail.runnerPort ?? "unknown"} · build{" "}
          {detail.runnerBuild === undefined
            ? "unknown"
            : (detail.runnerBuild ?? "none recorded")}{" "}
          · triage-sessions.py{" "}
          <span title={detail.triageVersion ?? undefined}>
            {versionWords(detail.triageVersion)}
          </span>
        </p>
      }
    />
  );
}

function PassRecordRow({
  pass,
  expanded,
  onToggle,
  refreshNonce,
}: {
  pass: PassSummary;
  refreshNonce: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <RecordRow
      data-testid="overlord-flow-pass"
      rowKey={pass.passId}
      expanded={expanded}
      onToggle={onToggle}
      identity={
        <span className="font-mono text-[11px]">{passWord(pass.scope)}</span>
      }
      label={<span>{passWord(pass.mode)}</span>}
      status={
        <Badge variant="outline" className="font-mono text-[11px]">
          {pass.rowCount} {pass.rowCount === 1 ? "row" : "rows"}
        </Badge>
      }
      reason={passReason(pass)}
      reasonTestId="overlord-flow-pass-reason"
      time={<RowTime at={pass.startedAt} verb="Started" />}
    >
      <PassDetailBody passId={pass.passId} refreshNonce={refreshNonce} />
    </RecordRow>
  );
}

function PassesList({
  windowId,
  refreshNonce,
}: {
  windowId: FlowWindowId;
  refreshNonce: number;
}) {
  const [list, setList] = useState<PassList | null>(null);
  const [failure, setFailure] = useState<FlowReadFailure | null>(null);
  /** Only the newest read may land. */
  const reqRef = useRef(0);
  const words = flowWindow(windowId).words;

  useEffect(() => {
    const req = ++reqRef.current;
    void (async () => {
      try {
        const body = readPassList(
          await fetchOverlordPasses(passesQuery(windowId, Date.now()))
        );
        if (reqRef.current !== req) return;
        if (body) {
          setList(body);
          setFailure(null);
        } else {
          setFailure(MALFORMED_FAILURE);
        }
      } catch (e) {
        if (reqRef.current === req) setFailure(parseFlowReadFailure(e));
      }
    })();
    return () => {
      // Unmounting (the panel closed) means nothing may land afterwards.
      reqRef.current += 1;
    };
  }, [windowId, refreshNonce]);

  if (failure && !list) {
    return (
      <p
        className="text-sm text-muted-foreground italic m-0"
        data-testid="overlord-flow-passes-unknown"
      >
        Unknown — {failureSentence(failure)}. This is not an empty list.
      </p>
    );
  }
  const cut =
    list?.truncated === true
      ? `Newest ${list.passes.length} of ${list.total ?? "an unknown number of"} passes in ${words}.`
      : list && list.truncated === undefined
        ? "Coord did not say whether it cut this list, so it may not be every pass."
        : null;
  return (
    <div className="space-y-1">
      {failure && (
        <p
          className="text-xs text-amber-600 dark:text-amber-400 m-0"
          data-testid="overlord-flow-passes-stale"
        >
          The latest refresh failed ({failureSentence(failure)}), so this is the
          last good read.
        </p>
      )}
      {cut && (
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="overlord-flow-passes-cut"
        >
          {cut}
        </p>
      )}
      <RecordList
        items={list?.passes ?? []}
        itemKey={(p) => p.passId}
        loaded={list !== null}
        skeletonRows={3}
        renderRow={(p, ctx) => (
          <PassRecordRow
            pass={p}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            refreshNonce={refreshNonce}
          />
        )}
        empty={
          <p
            className="text-sm text-muted-foreground italic m-0"
            data-testid="overlord-flow-passes-empty"
          >
            No triage pass recorded in {words}.
          </p>
        }
      />
    </div>
  );
}

export function PassesPanel({
  windowId,
  refreshNonce,
}: {
  windowId: FlowWindowId;
  /** Bumped by the page's refresh, which should re-read this list as well. */
  refreshNonce: number;
}) {
  return (
    <CollapsiblePanel
      title="Passes"
      titleAs="h2"
      icon={<ListTree className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span className="text-xs normal-case tracking-normal text-muted-foreground">
          each run and the terminals it screened
        </span>
      }
      defaultOpen={false}
      storageKey="coord-overlord-flow-passes-open"
      data-testid="overlord-flow-passes"
    >
      {/* Keyed: a new window owns nothing the old one read. */}
      <PassesList
        key={windowId}
        windowId={windowId}
        refreshNonce={refreshNonce}
      />
    </CollapsiblePanel>
  );
}
