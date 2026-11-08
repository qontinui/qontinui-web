"use client";

/**
 * /admin/coord/subprojects — every subproject of the tenant, and which have
 * stopped.
 *
 * Plan `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6 (D12). A subproject groups the sessions, gates, work units and PRs
 * of one piece of work; coord computes whether anything is still moving it
 * (D1, D6) and caches that verdict, with its `as_of`, for this list. The page
 * composes the console primitives only (style guide §6.4; §3.15 records what
 * it adds):
 *
 * - **R1** — a `HealthStrip` over the counts the tabs show: red when anything
 *   needs you or is stalled, amber when a count is stale, failed or not taken
 *   or a verdict is unknown, green only on a measured zero.
 * - **R6** — `FilterTabs` with live counts — Open · Needs you · Stalled ·
 *   Working · Waiting · Done · All — each coord's own count for its view, `–`
 *   until read. Open (the default) is every open subproject that is not done.
 *   One-offs, scheduled and merged subprojects are listed under All only; a
 *   tab says how many of its rows it folded there.
 * - **R2/R4/R5** — one `RecordRow` per subproject: sessions live/total · title
 *   · headline badge · top reason · last activity and the verdict's as-of.
 *   The row expands in place and carries "Open subproject ↗" (the detail page
 *   is a workspace: actions, history).
 * - **R3** — colours only through `subprojectStatus.ts`'s registered palette.
 *
 * A read that never answered is UNKNOWN with its reason — a pending migration
 * (`schema_migration_pending`) and an undeployed door are said as what they
 * are — never an empty list.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
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
} from "@/components/console";
import {
  SUBPROJECT_HEADLINE_PALETTE,
  SUBPROJECT_TABS,
  SUBPROJECT_TAB_LABEL,
  countText,
  deriveSubprojectStatus,
  deriveSubprojectsHealth,
  describeEmptyView,
  foldedReason,
  projectStateWords,
  readFailureWords,
  sessionsText,
  sessionsTitle,
  tabOf,
  type CountReading,
  type SubprojectTab,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import type { SubprojectSummary } from "@/lib/api/operations/coordSubprojects";
import { useSubprojectsList } from "./_hooks/useSubprojectsList";

/** The tabs whose rows leave one-offs, scheduled and merged ones to All. */
function foldsIntoAll(tab: SubprojectTab): boolean {
  return tab !== "all";
}

function badgeTone(r: CountReading, loud: "attention" | "waiting") {
  return r.value !== null && r.value > 0 ? loud : "muted";
}

export default function CoordSubprojectsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = tabOf(searchParams?.get("tab"));
  const [query, setQuery] = useState("");
  const list = useSubprojectsList(tab);

  const setTab = useCallback(
    (next: SubprojectTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      // Open is the default, so it needs no parameter; every other view —
      // All included — is named in the URL, so it can be linked.
      if (next === "open") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ""), {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  const health = useMemo(
    () => deriveSubprojectsHealth(list.counts),
    [list.counts]
  );

  const { rows } = list;
  const needle = query.trim();
  const { shown, matched, folded } = useMemo(() => {
    const lower = needle.toLowerCase();
    const matches = (s: SubprojectSummary) =>
      lower === "" ||
      s.title.toLowerCase().includes(lower) ||
      s.slug.toLowerCase().includes(lower) ||
      (s.goal ?? "").toLowerCase().includes(lower);
    const hit = rows.items.filter(matches);
    if (!foldsIntoAll(tab))
      return { shown: hit, matched: hit.length, folded: 0 };
    const kept = hit.filter((s) => foldedReason(s) === null);
    return {
      shown: kept,
      matched: hit.length,
      folded: hit.length - kept.length,
    };
  }, [rows.items, needle, tab]);

  const badges: HealthBadge[] = [
    {
      key: "needs_you",
      label: `needs you ${countText(list.counts.needs_you.value)}`,
      tone: badgeTone(list.counts.needs_you, "attention"),
      onClick: () => setTab("needs_you"),
      navigationOnly: true,
      "data-testid": "coord-subprojects-strip-needs-you",
    },
    {
      key: "stalled",
      label: `stalled ${countText(list.counts.stalled.value)}`,
      tone: badgeTone(list.counts.stalled, "attention"),
      onClick: () => setTab("stalled"),
      navigationOnly: true,
      "data-testid": "coord-subprojects-strip-stalled",
    },
    {
      key: "unknown",
      label: `unknown ${countText(list.counts.unknown.value)}`,
      tone: badgeTone(list.counts.unknown, "waiting"),
      title:
        "Open subprojects whose verdict coord has not computed, or could not read.",
      "data-testid": "coord-subprojects-strip-unknown",
    },
  ];

  const tabs = SUBPROJECT_TABS.map((t) => ({
    id: t,
    label: SUBPROJECT_TAB_LABEL[t],
    count: list.counts[t].value,
    attention:
      (t === "needs_you" || t === "stalled") && (list.counts[t].value ?? 0) > 0,
    testId: `coord-subprojects-tab-${t}`,
  }));

  const emptyText = describeEmptyView({
    tab,
    loaded: rows.loaded,
    failure: rows.failure,
    stale: rows.stale,
    query: needle,
    loadedRows: rows.items.length,
    matched,
    folded,
    more: rows.more,
  });

  const unattached = list.unattached;
  const viewCount = list.counts[tab].value;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-subprojects-page"
      data-ui-bridge-id="coord-subprojects"
    >
      <div className="flex items-start gap-2">
        <HealthStrip
          className="flex-1"
          level={health.level}
          headline={health.headline}
          detail={health.detail}
          badges={badges}
          data-testid="coord-subprojects-strip"
        />
        <RefreshButton
          onRefresh={list.refresh}
          label="Re-read subprojects"
          title="Re-reads every count and this view's first page; the page also re-reads its rows every minute and its counts every two."
          data-testid="coord-subprojects-refresh"
        />
      </div>

      <p
        className="m-0 text-xs text-muted-foreground"
        data-testid="coord-subprojects-unattached"
      >
        Work units that belong to no subproject:{" "}
        <span className="font-mono text-foreground">
          {countText(unattached.value)}
        </span>
        {unattached.failure
          ? unattached.value !== null
            ? ` — the last good count; the latest read failed (${readFailureWords(unattached.failure)}).`
            : ` — could not be read (${readFailureWords(unattached.failure)}).`
          : unattached.value === null
            ? unattached.answered
              ? " — coord did not count them (unknown, not zero)."
              : " — not read yet."
            : list.unattachedByClass &&
                Object.keys(list.unattachedByClass).length > 0
              ? ` (${Object.entries(list.unattachedByClass)
                  .map(([cls, n]) => `${projectStateWords(cls)} ${n}`)
                  .join(", ")})`
              : ""}
      </p>

      <FilterTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        testIdPrefix="coord-subprojects-filter"
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Filter this page by title…"
        queryTestId="coord-subprojects-search"
      />

      {rows.stale && rows.failure && (
        <p
          className="m-0 text-xs text-amber-200"
          role="status"
          data-testid="coord-subprojects-rows-stale"
        >
          The latest read of this view failed — {readFailureWords(rows.failure)}
          . The rows below are from the last read that answered
          {rows.asOf ? (
            <>
              {" "}
              (<RowTime at={rows.asOf} verb="Read" />)
            </>
          ) : null}
          .
        </p>
      )}

      <RecordList<SubprojectSummary>
        items={shown}
        itemKey={(s) => s.id}
        loaded={rows.loaded || rows.failure !== null}
        empty={
          <p
            className="m-0 text-sm text-muted-foreground"
            data-testid="coord-subprojects-empty"
          >
            {emptyText}
          </p>
        }
        renderRow={(s, ctx) => <SubprojectRow s={s} {...ctx} />}
      />

      {folded > 0 && shown.length > 0 && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-subprojects-folded"
        >
          {folded} more on this page {folded === 1 ? "is" : "are"} a one-off,
          scheduled or merged subproject, listed under{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setTab("all")}
          >
            All
          </button>
          .
        </p>
      )}

      {rows.loaded && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="coord-subprojects-page-count">
            {rows.items.length} loaded
            {viewCount !== null ? ` of ${viewCount}` : ""}
            {rows.more ? "; more are available" : ""}.
          </span>
          {rows.pages > 1 && (
            <span data-testid="coord-subprojects-rows-paused">
              These rows are as of{" "}
              <RowTime
                at={rows.asOf}
                verb="Read"
                absent={{
                  label: "an unknown time",
                  title: "coord did not date the first page.",
                }}
              />
              ; with more than one page loaded the rows are not re-read every
              minute — Refresh starts again from the first page.
            </span>
          )}
          {rows.more && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.loadMore()}
              disabled={list.loadingMore}
              data-testid="coord-subprojects-load-more"
            >
              {list.loadingMore ? "Loading…" : "Load more"}
            </Button>
          )}
          {list.loadMoreFailure && (
            <span
              className="text-destructive"
              role="status"
              data-testid="coord-subprojects-load-more-failed"
            >
              Loading more failed — {readFailureWords(list.loadMoreFailure)}.
              The rows above are unaffected.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SubprojectRow({
  s,
  expanded,
  onToggle,
  rowKey,
}: {
  s: SubprojectSummary;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const status = deriveSubprojectStatus(s);
  const folded = foldedReason(s);
  const title = s.title || s.slug;
  return (
    <RecordRow
      rowKey={rowKey}
      identity={
        <span
          title={sessionsTitle(s.sessions)}
          data-testid="coord-subproject-row-sessions"
        >
          {sessionsText(s.sessions)}
        </span>
      }
      // The label truncates; its title carries the whole of it (R2).
      label={<span title={title}>{title}</span>}
      status={
        <StatusBadge status={status} palette={SUBPROJECT_HEADLINE_PALETTE} />
      }
      reason={status.reason}
      attention={status.attention}
      time={
        <span className="flex items-center gap-1.5">
          <RowTime
            at={s.last_activity_at}
            verb="Last activity"
            absent={{
              label: "no activity",
              title: "coord reports no member activity for this subproject.",
            }}
          />
          <RowTime
            at={s.verdict_as_of}
            verb="Verdict computed"
            prefix="verdict "
            absent={{
              label: "no verdict",
              title:
                "coord's reconciler has not computed a verdict for this subproject yet.",
            }}
          />
        </span>
      }
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-row"
    >
      <RecordDetail
        why={
          <>
            <p className="m-0 text-[13px] text-foreground/85">
              {status.label}
              {status.reason ? ` — ${status.reason}` : ""}
              {s.reasons_count > 1
                ? ` (and ${s.reasons_count - 1} more reason${s.reasons_count === 2 ? "" : "s"})`
                : ""}
            </p>
            {s.goal && (
              <p className="m-0 text-xs text-muted-foreground">
                Goal: {s.goal}
              </p>
            )}
            {folded && (
              <p className="m-0 text-xs text-muted-foreground">
                Listed under All only: {folded}.
              </p>
            )}
          </>
        }
        actions={
          <Link
            href={`/admin/coord/subprojects/${encodeURIComponent(s.id)}`}
            className="text-xs underline underline-offset-2 hover:text-foreground"
            data-testid="coord-subproject-open"
          >
            Open subproject ↗
          </Link>
        }
        history={
          <p className="m-0 text-xs text-muted-foreground">
            Founded <RowTime at={s.created_at} verb="Founded" /> · updated{" "}
            <RowTime at={s.updated_at} verb="Updated" />
            {s.closed_at ? (
              <>
                {" "}
                · closed <RowTime at={s.closed_at} verb="Closed" />
              </>
            ) : null}{" "}
            · work units {countText(s.work_units.open)} open of{" "}
            {countText(s.work_units.total)}
          </p>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            id {s.id} · slug {s.slug} · origin {s.origin} · status {s.status}
            {s.root_agent_session_id
              ? ` · root session ${s.root_agent_session_id}`
              : ""}
            {s.merged_into ? ` · merged into ${s.merged_into}` : ""}
          </p>
        }
      />
    </RecordRow>
  );
}
