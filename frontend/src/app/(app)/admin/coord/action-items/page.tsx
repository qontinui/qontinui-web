"use client";

/**
 * /admin/coord/action-items — the to-dos the operator owes.
 *
 * Plan `2026-10-12-operator-action-items-pushed-to-the-phone` Phase 3. An
 * action item is created by coord when a gate with a `notify_operator`
 * continuation clears, by a work unit's dispatch, or by an agent, and coord
 * pushes it to the operator's phone. This page is the console half: every
 * item with its push delivery made visible, and Done / Dismiss.
 *
 * Composed from `components/console` (`frontend/docs/console-ui-style-guide.md`):
 *
 * - **R1** — a `<HealthStrip>` derived from the envelope already fetched:
 *   red when an owed item's push did not land (the console is then the only
 *   place telling the operator), amber when items are owed, green otherwise.
 * - **R6** — Open / Done / Dismissed tabs whose counts are coord's
 *   server-computed `counts` (never `items.length`, which is the page size),
 *   and `–` until the first read answers.
 * - **R2/R5** — one item per `<ActionItemRow>`, detail in place.
 *
 * Coord answers `503 schema_migration_pending` until the
 * `coord.operator_action_items` revision deploys; that renders as "not
 * available yet", never as an error and never as "nothing owed".
 *
 * Paging: one page of up to {@link PAGE_LIMIT} (coord's clamp). When coord
 * says there is more, the page says so rather than implying the list is whole.
 */

import { useCallback, useMemo, useState } from "react";
import {
  BackendErrorMessage,
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
  type HealthBadge,
} from "@/components/console";
import { ActionItemRow } from "@/components/admin/coord/ActionItemRow";
import {
  ACTION_ITEM_RESOLVE_OPTIONS,
  deriveActionItemsHealth,
  isMigrationPending,
  type ActionItemCounts,
  type ActionItemResolution,
  type ActionItemsResponse,
  type ActionItemsTab,
  type CoordActionItem,
} from "@/components/admin/coord/actionItemStatus";
import {
  fetchActionItems,
  resolveActionItem,
} from "@/lib/api/operations/actionItems";
import { operationsErrorReading } from "@/lib/api/operations/base";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";

const POLL_INTERVAL_MS = 15_000;
const PAGE_LIMIT = 200;

const TAB_LABEL: Record<ActionItemsTab, string> = {
  open: "Open",
  done: "Done",
  dismissed: "Dismissed",
};

export default function CoordActionItemsPage() {
  const [tab, setTab] = useState<ActionItemsTab>("open");
  const [response, setResponse] = useState<ActionItemsResponse | null>(null);
  // Kept across tab switches: the counts are tenant-wide, so a tab change
  // does not make them unknown.
  const [counts, setCounts] = useState<ActionItemCounts | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveErrors, setResolveErrors] = useState<Record<string, unknown>>(
    {}
  );

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      try {
        const body = await fetchActionItems(
          { status: tab, limit: PAGE_LIMIT },
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (!isCurrent()) return;
        setResponse(body);
        setCounts(body.counts ?? null);
        setReadError(null);
      } catch (e) {
        if (!isCurrent()) return;
        setReadError(e);
      }
    },
    [tab]
  );

  const { refresh } = useSingleFlightPoll(poll, POLL_INTERVAL_MS, {
    supersedeOnChange: true,
  });

  const changeTab = useCallback((next: ActionItemsTab) => {
    setTab(next);
    // The rows belong to the previous tab's question; never show them under
    // the new tab's label while its read is in flight.
    setResponse(null);
  }, []);

  const onResolve = useCallback(
    async (item: CoordActionItem, status: ActionItemResolution) => {
      setResolvingId(item.item_id);
      setResolveErrors((prev) => {
        const next = { ...prev };
        delete next[item.item_id];
        return next;
      });
      try {
        await resolveActionItem(
          item.item_id,
          status,
          undefined,
          ACTION_ITEM_RESOLVE_OPTIONS
        );
        await refresh();
      } catch (e) {
        setResolveErrors((prev) => ({
          ...prev,
          [item.item_id]: operationsErrorReading(e),
        }));
      } finally {
        setResolvingId(null);
      }
    },
    [refresh]
  );

  const migrationPending = readError != null && isMigrationPending(readError);
  const readFailed = readError != null && !migrationPending;
  const loaded = response !== null;
  const items = useMemo(() => response?.items ?? [], [response]);

  const health = useMemo(
    () =>
      deriveActionItemsHealth({
        loaded,
        migrationPending,
        readFailed,
        tab,
        response,
        counts,
      }),
    [loaded, migrationPending, readFailed, tab, response, counts]
  );

  const badges: HealthBadge[] = [
    {
      key: "open",
      label: <>open {counts ? counts.open : "–"}</>,
      tone: counts && counts.open > 0 ? "waiting" : "muted",
      "data-testid": "action-items-open-count",
    },
    {
      key: "undelivered",
      label: (
        <>
          not on phone{" "}
          {health.undelivered === null
            ? "–"
            : `${health.undelivered}${health.undeliveredIsFloor ? "+" : ""}`}
        </>
      ),
      tone:
        health.undelivered !== null && health.undelivered > 0
          ? "attention"
          : "muted",
      title:
        "open items whose push failed, could not be sent, or had nobody to go to — counted on the Open tab",
      "data-testid": "action-items-undelivered-count",
    },
  ];

  const tabs = (Object.keys(TAB_LABEL) as ActionItemsTab[]).map((id) => ({
    id,
    label: TAB_LABEL[id],
    count: counts ? counts[id] : null,
    attention:
      id === "open" && health.undelivered !== null && health.undelivered > 0,
  }));

  const tabTotal = counts ? counts[tab] : null;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-action-items-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={badges}
        data-testid="coord-action-items-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs
          tabs={tabs}
          active={tab}
          onChange={changeTab}
          testIdPrefix="action-items-tab"
        />
        <RefreshButton
          onRefresh={refresh}
          label="Refresh action items"
          title="Re-read the action items and their push state from coord now"
          data-testid="action-items-refresh"
        />
      </div>

      {readFailed && (
        <p
          className="text-sm text-destructive"
          data-testid="action-items-read-error"
        >
          Could not read action items:{" "}
          <BackendErrorMessage error={operationsErrorReading(readError)} />
        </p>
      )}

      {migrationPending ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="action-items-migration-pending"
        >
          Action items are not available on this deployment yet — coord has not
          migrated its action-item table.
        </p>
      ) : (
        <div data-testid="coord-actions-list">
          <RecordList
            items={items}
            itemKey={(i, index) => i.item_id || `item-${index}`}
            loaded={loaded}
            skeletonRows={4}
            renderRow={(item, ctx) => (
              <ActionItemRow
                item={item}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
                onResolve={onResolve}
                resolving={resolvingId === item.item_id}
                resolveError={resolveErrors[item.item_id] ?? null}
              />
            )}
            empty={
              readFailed ? null : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="action-items-empty"
                >
                  {tab === "open"
                    ? "Nothing is owed by you right now."
                    : `No ${TAB_LABEL[tab].toLowerCase()} action items.`}
                </p>
              )
            }
          />
          {response?.next_cursor && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="action-items-truncated"
            >
              Showing the newest {items.length}
              {tabTotal !== null ? ` of ${tabTotal}` : ""}; older items are not
              listed here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
