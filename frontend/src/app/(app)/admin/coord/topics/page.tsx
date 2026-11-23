"use client";

/**
 * /admin/coord/topics — every topic of the tenant, and which have stopped.
 *
 * Plan `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8 (D9). A topic groups the subprojects that serve one goal; coord
 * rolls its headline up from its confirmed members' cached verdicts (D7 as
 * amended B9) and caches it, with its `as_of`. The page composes the console
 * primitives only (style guide §6.4; §3.17 records it):
 *
 * - **R1** — a `HealthStrip`: red when a topic needs you or is stalled, amber
 *   when a topic's rollup is unknown or the read failed, green only on a
 *   measured zero.
 * - **R6** — `FilterTabs` Needs you · Stalled · Working · Waiting · Done · All,
 *   each counted from the one list coord serves; `–` until it answered. All is
 *   the default, and the only tab listing a topic never rolled up.
 * - **R2/R4/R5** — one `RecordRow` per topic: working/total subprojects ·
 *   title · headline badge · top reason · last activity and the rollup's
 *   as-of; it expands in place and carries "Open topic ↗".
 * - The `unassigned_subprojects` line under the strip, `–` when coord did not
 *   count it.
 *
 * A read that never answered is UNKNOWN with its reason — coord's 503
 * `schema_migration_pending` says "topics not available yet (migration
 * pending)" — never an empty list.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FilterTabs,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import {
  TOPIC_HEADLINE_PALETTE,
  TOPIC_TABS,
  TOPIC_TAB_LABEL,
  countText,
  deriveTopicStatus,
  describeEmptyTopics,
  inTopicTab,
  lifecycleWords,
  topicReadFailureWords,
  topicTabCounts,
  topicTabOf,
  workingText,
  workingTitle,
  type TopicTab,
} from "@/components/admin/coord/topics/topicStatus";
import type { TopicSummary } from "@/lib/api/operations/coordTopics";
import { useTopicsList } from "./_hooks/useTopicsList";

export default function CoordTopicsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = topicTabOf(searchParams?.get("tab"));
  const [query, setQuery] = useState("");
  const state = useTopicsList();
  const topics = state.list?.topics ?? null;
  /** coord answered, but says its topic tables are not ready: every count
   *  and "none" it implies is unknown, not zero. */
  const tablesNotReady = state.list?.tables_ready === false;
  const countable = tablesNotReady ? null : topics;

  const setTab = useCallback(
    (next: TopicTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "all") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ""), {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  const counts = useMemo(() => topicTabCounts(countable), [countable]);
  const unknownCount = useMemo(
    () =>
      countable === null
        ? null
        : countable.filter((t) => deriveTopicStatus(t).kind === "unknown")
            .length,
    [countable]
  );

  const needle = query.trim().toLowerCase();
  const inView = useMemo(
    () => (topics ?? []).filter((t) => inTopicTab(t, tab)),
    [topics, tab]
  );
  const shown = useMemo(
    () =>
      needle === ""
        ? inView
        : inView.filter(
            (t) =>
              t.title.toLowerCase().includes(needle) ||
              t.slug.toLowerCase().includes(needle) ||
              (t.summary ?? "").toLowerCase().includes(needle)
          ),
    [inView, needle]
  );

  const health = deriveHealth(
    counts,
    unknownCount,
    state.failure !== null,
    state.loaded,
    tablesNotReady
  );
  const badges: HealthBadge[] = [
    {
      key: "needs_you",
      label: `needs you ${countText(counts.needs_you)}`,
      tone: (counts.needs_you ?? 0) > 0 ? "attention" : "muted",
      onClick: () => setTab("needs_you"),
      navigationOnly: true,
      "data-testid": "coord-topics-strip-needs-you",
    },
    {
      key: "stalled",
      label: `stalled ${countText(counts.stalled)}`,
      tone: (counts.stalled ?? 0) > 0 ? "attention" : "muted",
      onClick: () => setTab("stalled"),
      navigationOnly: true,
      "data-testid": "coord-topics-strip-stalled",
    },
    {
      key: "unknown",
      label: `unknown ${countText(unknownCount)}`,
      tone: (unknownCount ?? 0) > 0 ? "waiting" : "muted",
      title:
        "Topics coord has not rolled up, or whose rollup rests on members it could not read.",
      "data-testid": "coord-topics-strip-unknown",
    },
  ];

  const tabs = TOPIC_TABS.map((t) => ({
    id: t,
    label: TOPIC_TAB_LABEL[t],
    count: counts[t],
    countNote: state.stale ? "the last good read; the latest failed" : null,
    attention: (t === "needs_you" || t === "stalled") && (counts[t] ?? 0) > 0,
    testId: `coord-topics-tab-${t}`,
  }));

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-topics-page"
      data-ui-bridge-id="coord-topics"
    >
      <div className="flex items-start gap-2">
        <HealthStrip
          className="flex-1"
          level={health.level}
          headline={health.headline}
          detail={health.detail}
          badges={badges}
          data-testid="coord-topics-strip"
        />
        <RefreshButton
          onRefresh={state.refresh}
          label="Re-read topics"
          title="Re-reads every topic; the page also re-reads itself every minute."
          data-testid="coord-topics-refresh"
        />
      </div>

      <p
        className="m-0 text-xs text-muted-foreground"
        data-testid="coord-topics-unassigned"
      >
        Subprojects that belong to no topic:{" "}
        <span className="font-mono text-foreground">
          {countText(state.list?.unassigned_subprojects)}
        </span>{" "}
        {state.failure && !state.list
          ? `— could not be read (${topicReadFailureWords(state.failure)}).`
          : state.list === null
            ? "— not read yet."
            : state.list.unassigned_subprojects === null ||
                state.list.unassigned_subprojects === undefined
              ? "— coord did not count them (unknown, not zero)."
              : ""}
        {state.list ? (
          <>
            {" "}
            Topics as of{" "}
            <RowTime
              at={state.list.as_of}
              verb="As of"
              absent={{
                label: "an unknown time",
                title: "coord did not date this read.",
              }}
            />
            .{" "}
            <span data-testid="coord-topics-lifecycle">
              {lifecycleWords(state.list.topics)}
            </span>
          </>
        ) : null}
      </p>

      {state.list?.tables_ready === false && (
        <p
          className="m-0 text-xs text-amber-200"
          role="status"
          data-testid="coord-topics-tables-not-ready"
        >
          coord reports its topic tables are not ready, so this list is not
          authoritative — an empty view here is unknown, not none.
        </p>
      )}

      <FilterTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        testIdPrefix="coord-topics-filter"
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Filter by title…"
        queryTestId="coord-topics-search"
      />

      {state.stale && state.failure && (
        <p
          className="m-0 text-xs text-amber-200"
          role="status"
          data-testid="coord-topics-stale"
        >
          The latest read failed — {topicReadFailureWords(state.failure)}. The
          topics below are from the last read that answered.
        </p>
      )}

      <RecordList<TopicSummary>
        items={shown}
        itemKey={(t) => t.id}
        loaded={state.loaded || state.failure !== null}
        empty={
          <p
            className="m-0 text-sm text-muted-foreground"
            data-testid="coord-topics-empty"
          >
            {describeEmptyTopics({
              tab,
              loaded: state.loaded,
              failure: state.failure,
              query: needle,
              loadedRows: inView.length,
              tablesReady: !tablesNotReady,
            })}
          </p>
        }
        renderRow={(t, ctx) => <TopicRow t={t} {...ctx} />}
      />
    </div>
  );
}

function deriveHealth(
  counts: Record<TopicTab, number | null>,
  unknown: number | null,
  failed: boolean,
  loaded: boolean,
  tablesNotReady: boolean
): { level: HealthStripLevel; headline: string; detail?: string } {
  if (!loaded) {
    return failed
      ? {
          level: "amber",
          headline: "Topics could not be read",
          detail: "Whether any topic needs you is unknown.",
        }
      : { level: "amber", headline: "Reading topics…" };
  }
  if (tablesNotReady) {
    return {
      level: "amber",
      headline: "Topic tables not ready",
      detail: failed
        ? "Whether any topic needs you is unknown; the latest read also failed."
        : "Whether any topic needs you is unknown.",
    };
  }
  const loud = (counts.needs_you ?? 0) + (counts.stalled ?? 0);
  if (loud > 0) {
    return {
      level: "red",
      headline: `${loud} topic${loud === 1 ? " needs you or is" : "s need you or are"} stalled`,
      detail: failed
        ? "From the last good read; the latest failed."
        : undefined,
    };
  }
  if (failed || (unknown ?? 0) > 0) {
    return {
      level: "amber",
      headline: failed
        ? "The latest read failed"
        : `${unknown} topic${unknown === 1 ? "" : "s"} unknown`,
      detail: failed
        ? "Counts are from the last good read."
        : "coord has not rolled them up, or could not read some members.",
    };
  }
  return { level: "green", headline: "No topic needs you or is stalled" };
}

function TopicRow({
  t,
  expanded,
  onToggle,
  rowKey,
}: {
  t: TopicSummary;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const status = deriveTopicStatus(t);
  const title = t.title || t.slug;
  return (
    <RecordRow
      rowKey={rowKey}
      identity={
        <span title={workingTitle(t)} data-testid="coord-topic-row-working">
          {workingText(t)}
        </span>
      }
      label={<span title={title}>{title}</span>}
      status={<StatusBadge status={status} palette={TOPIC_HEADLINE_PALETTE} />}
      reason={status.reason}
      attention={status.attention}
      time={
        <span className="flex items-center gap-1.5">
          <RowTime
            at={t.last_activity_at}
            verb="Last activity"
            absent={{
              label:
                t.last_rollup_as_of == null
                  ? "activity unknown"
                  : "no activity reported",
              title:
                t.last_rollup_as_of == null
                  ? "coord has not rolled this topic up, so its last activity is unknown."
                  : "coord reported no member activity time for this topic.",
            }}
          />
          <RowTime
            at={t.last_rollup_as_of}
            verb="Rolled up"
            prefix="rollup "
            absent={{
              label: "no rollup",
              title: "coord has not rolled this topic up yet.",
            }}
          />
        </span>
      }
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-topic-row"
    >
      <RecordDetail
        why={
          <>
            <p className="m-0 text-[13px] text-foreground/85">
              {status.label}
              {status.reason ? ` — ${status.reason}` : ""}
            </p>
            {t.unknown_members !== null && t.unknown_members > 0 && (
              <p className="m-0 text-xs text-muted-foreground">
                {t.unknown_members} member subproject
                {t.unknown_members === 1 ? "" : "s"} could not be read.
              </p>
            )}
            {t.summary && (
              <p className="m-0 text-xs text-muted-foreground">{t.summary}</p>
            )}
          </>
        }
        actions={
          <Link
            href={`/admin/coord/topics/${encodeURIComponent(t.id)}`}
            className="text-xs underline underline-offset-2 hover:text-foreground"
            data-testid="coord-topic-open"
          >
            Open topic ↗
          </Link>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            id {t.id} · slug {t.slug} · status {t.status}
            {t.parent_topic_id ? ` · parent ${t.parent_topic_id}` : ""}
          </p>
        }
      />
    </RecordRow>
  );
}
