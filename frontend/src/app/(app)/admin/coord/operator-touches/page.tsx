"use client";

/**
 * /admin/coord/operator-touches — where the operator's interruptions come
 * from, and whether the operator is the constraint.
 *
 * Plan `2026-08-27-operator-touch-read-and-surface` Phase C3 (C3-operator).
 * Reads coord's `GET /coord/operator-touches` through the web proxy — ONE
 * payload carrying the constraint verdict, the window aggregate and a keyset
 * page of touches.
 *
 * ## Structure (cloned from `/admin/coord/pull-decisions`)
 *
 * - **R1** — a `<HealthStrip>` DERIVED from the page-1 payload already on the
 *   page (`deriveTouchesHealth`). The verdict arrives in the same payload as
 *   the list (plan C3c), so there is no second fetch.
 * - **The strategic aggregate** — reason classes ranked by share, as a
 *   `<ShareList>` (style guide §3.5). Aggregate, read-only, no per-line action:
 *   the operator's question is which classes are worth a policy.
 * - **The record feed** — `<RecordList>` of `<OperatorTouchRow>`, human words
 *   on the row and coord's vocabulary only in the expanded detail (R8, R5).
 *   Paged with coord's `next_cursor`.
 *
 * **Not yet measured is not an empty page.** coord answers a tenant with no
 * touch ever recorded as `measurement: "not_yet_measured"`, and every surface
 * here says so in words — the strip, the aggregate and the feed's empty slot —
 * rather than rendering a healthy zero.
 *
 * **Disposition tabs carry live counts (R6) for free**: the aggregate always
 * covers the whole window while the filter narrows only the touch page, so
 * each tab's count is known from page 1's totals, whichever tab is active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
  ShareList,
  readIsUnknown,
  type FilterTab,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import { OperatorTouchRow } from "./_components/OperatorTouchRow";
import {
  deriveTouchesHealth,
  failureSentence,
  parseTouchReadFailure,
  readTouchesBody,
  reasonLabel,
  touchesOf,
  type OperatorTouch,
  type OperatorTouchesResponse,
  type TouchDisposition,
  type TouchReadFailure,
  type TouchWindowDays,
} from "./_lib/operatorTouchStatus";

const API = "/api/v1/operations";
/** Page size asked of coord (coord's own default; it clamps to 1..200). */
const PAGE_SIZE = 50;

type DispositionTab = "all" | TouchDisposition;

function buildQuery(params: {
  windowDays: TouchWindowDays;
  disposition: DispositionTab;
  before?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("window_days", String(params.windowDays));
  qs.set("limit", String(PAGE_SIZE));
  if (params.disposition !== "all") qs.set("disposition", params.disposition);
  if (params.before) qs.set("before", params.before);
  return qs.toString();
}

export default function CoordOperatorTouchesPage() {
  const [windowDays, setWindowDays] = useState<TouchWindowDays>(7);
  const [disposition, setDisposition] = useState<DispositionTab>("all");

  /** The page-1 payload — the one carrying the aggregate and the verdict. */
  const [head, setHead] = useState<OperatorTouchesResponse | null>(null);
  const [touches, setTouches] = useState<OperatorTouch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  /** True once a page-1 read has SUCCEEDED for the current query. */
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failure, setFailure] = useState<TouchReadFailure | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailure, setOlderFailure] = useState<string | null>(null);

  /** A page-1 read is out; "Load older" waits for it rather than racing it. */
  const [firstLoading, setFirstLoading] = useState(true);

  /** Only the newest page-1 read may land — a filter change supersedes the rest. */
  const reqRef = useRef(0);
  /**
   * Only the newest OLDER-page read may land. A page-1 read bumps this too:
   * an older page fetched against the previous page 1's cursor must never be
   * spliced onto the new one (a gap, a stale cursor and duplicate keys).
   */
  const olderReqRef = useRef(0);

  const fetchFirstPage = useCallback(async () => {
    const req = ++reqRef.current;
    setFirstLoading(true);
    try {
      const body = readTouchesBody(
        await httpClient.get<unknown>(
          `${API}/coord/operator-touches?${buildQuery({ windowDays, disposition })}`
        )
      );
      if (reqRef.current !== req) return;
      // Only a page 1 that LANDS replaces the list, so only then is an older
      // read against the previous cursor stale. Superseding it here (not at
      // request time) keeps a valid older page when the refresh fails. Its own
      // spinner will not clear once superseded, so clear it here.
      olderReqRef.current += 1;
      setLoadingOlder(false);
      setHead(body);
      setTouches(touchesOf(body));
      setCursor(body.next_cursor ?? null);
      setLoaded(true);
      setFailed(false);
      setFailure(null);
      setOlderFailure(null);
    } catch (e) {
      if (reqRef.current !== req) return;
      setFailed(true);
      setFailure(parseTouchReadFailure(e));
    } finally {
      if (reqRef.current === req) setFirstLoading(false);
    }
  }, [windowDays, disposition]);

  useEffect(() => {
    // A new query owns nothing the old one read: its counts, verdict and rows
    // are about a different window, so they go, and "loaded" with them — a
    // failure of the new read is then UNKNOWN, never the old numbers relabelled.
    setHead(null);
    setTouches([]);
    setCursor(null);
    setLoaded(false);
    setFailed(false);
    setFailure(null);
    setOlderFailure(null);
    void fetchFirstPage();
  }, [fetchFirstPage]);

  const fetchOlder = useCallback(async () => {
    if (!cursor) return;
    const older = ++olderReqRef.current;
    const current = () => olderReqRef.current === older;
    setLoadingOlder(true);
    try {
      const body = readTouchesBody(
        await httpClient.get<unknown>(
          `${API}/coord/operator-touches?${buildQuery({ windowDays, disposition, before: cursor })}`
        )
      );
      if (!current()) return;
      setTouches((prev) => {
        const seen = new Set(prev.map((t) => t.touch_id));
        return [...prev, ...touchesOf(body).filter((t) => !seen.has(t.touch_id))];
      });
      setCursor(body.next_cursor ?? null);
      setOlderFailure(null);
    } catch (e) {
      if (!current()) return;
      setOlderFailure(failureSentence(parseTouchReadFailure(e)));
    } finally {
      if (current()) setLoadingOlder(false);
    }
  }, [cursor, windowDays, disposition]);

  const health = useMemo(
    () =>
      deriveTouchesHealth({ head, loaded, failed, failure, windowDays }),
    [head, loaded, failed, failure, windowDays]
  );

  const measured = loaded && head?.measurement === "measured";
  const totals = measured ? (head?.totals ?? null) : null;

  const tabs: FilterTab<DispositionTab>[] = [
    { id: "all", label: "All", count: totals?.touches ?? null },
    {
      id: "operator_reaching",
      label: "Reached you",
      count: totals?.operator_reaching ?? null,
    },
    {
      id: "agent_dispatchable",
      label: "Agent can handle",
      count: totals?.agent_dispatchable ?? null,
    },
    {
      id: "unknown",
      label: "Routing unknown",
      count: totals?.unknown ?? null,
    },
  ];

  const reasonClasses = measured ? (head?.reason_classes ?? []) : [];
  const split = measured ? (head?.policy_authorized_split ?? null) : null;

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-operator-touches-page"
    >
      <HealthStrip
        level={health.level}
        headline={
          <span title={health.headlineTitle ?? undefined}>
            {health.headline}
          </span>
        }
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-operator-touches-health"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <FilterTabs
          tabs={tabs}
          active={disposition}
          onChange={setDisposition}
          testIdPrefix="operator-touches-filter"
        />
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(windowDays)}
            onValueChange={(v) => setWindowDays(v === "30" ? 30 : 7)}
          >
            <SelectTrigger
              className="h-8 w-36 text-xs"
              data-testid="operator-touches-window"
              aria-label="Window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <RefreshButton
            onRefresh={fetchFirstPage}
            label="Refresh operator touches"
            title="Re-reads the verdict and the counts, and returns the list to its newest page"
            data-testid="operator-touches-refresh"
          />
        </div>
      </div>

      <section className="space-y-2" data-testid="operator-touches-aggregate">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground m-0">
          Where your interruptions come from
        </h2>
        {!loaded ? (
          <p className="text-xs text-muted-foreground italic m-0">
            {failed
              ? "Unknown — the touch store could not be read, so no class can be ranked."
              : "Reading…"}
          </p>
        ) : !measured ? (
          <p
            className="text-xs text-muted-foreground italic m-0"
            data-testid="operator-touches-not-measured"
          >
            Not yet measured — the touch emitter has not run. No class can be
            ranked until a touch is recorded; an empty list here would claim
            there were none.
          </p>
        ) : (
          <>
            {split && (
              <p
                className="text-xs text-muted-foreground m-0"
                data-testid="operator-touches-policy-split"
                title="Always split by what policy said, so a single number cannot train sessions to swallow a correct escalation"
              >
                Judged against policy: {split.yes} allowed · {split.no} not
                called for · {split.unknown} not yet judged
              </p>
            )}
            <ShareList
              data-testid="operator-touches-reason-classes"
              total={totals?.touches ?? null}
              items={reasonClasses.map((c) => ({
                key: c.reason_code,
                label: reasonLabel(c.reason_code),
                // R8: the wire token lives in the hover, never the label.
                title: c.reason_code,
                count: c.count,
                detail: `${c.operator_reaching} reached you · ${c.agent_dispatchable} agent · ${c.unknown} unknown`,
              }))}
              empty={
                <p className="text-xs text-muted-foreground italic m-0">
                  No touch in {windowDays === 30 ? "the last 30 days" : "the last 7 days"}{" "}
                  — measured, and none recorded in this window.
                </p>
              }
            />
          </>
        )}
      </section>

      <section className="space-y-2" data-testid="coord-operator-touches">
        <RecordList
          items={touches}
          itemKey={(t) => t.touch_id}
          loaded={loaded || failed}
          skeletonRows={6}
          renderRow={(t, ctx) => (
            <OperatorTouchRow
              touch={t}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
          empty={
            readIsUnknown(loaded, failed) ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="operator-touches-unknown"
              >
                Unknown —{" "}
                {failure ? failureSentence(failure) : "the read did not land"}.
                This is not an empty store.
              </p>
            ) : !measured ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="operator-touches-empty-not-measured"
              >
                Not yet measured — the touch emitter has not run.
              </p>
            ) : cursor ? (
              // coord bounds a filtered scan and hands back its POSITION with
              // possibly zero rows. That is "not found yet", not "none".
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="operator-touches-empty-scan-bounded"
              >
                None found in the newest touches coord scanned — load older to
                keep looking. This is not a claim that none exist.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="operator-touches-empty"
              >
                No touch matches this filter in this window.
              </p>
            )
          }
        />
        {cursor && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchOlder()}
              disabled={loadingOlder || firstLoading}
              data-testid="operator-touches-older"
            >
              {loadingOlder ? "Loading…" : "Load older touches"}
            </Button>
            {olderFailure && (
              <span className="text-xs text-destructive">
                Older touches could not be read — {olderFailure}
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
