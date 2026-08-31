"use client";

/**
 * "Who did that, when, and why" — the operator audit feed, on the page where
 * the question gets asked. Plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 5.
 *
 * ## Why the Dev Ops page and not a sibling route
 *
 * The plan left the placement open. It belongs here for one reason: **the write
 * this feed exists to explain is three inches up the page.** Phase 1 put a
 * "Pause coord dispatch" control on every machine row, and that control cannot
 * show current drain state — coord serves no read of the drain map — so it
 * points at this feed for the durable answer. A sibling `/admin/coord/audit`
 * route would put the record of an action on a different page from the action,
 * which is the shape the merge kill switch was MOVED OUT OF by
 * `MergeTrainActivity`'s own module doc: "nobody opens a page about dwell
 * thresholds during an incident".
 *
 * It is collapsed, with a `storageKey`, because unlike the drain control it is
 * READ-ONLY: persisting "I keep this open" costs nothing and puts no consent
 * surface under a scrolling cursor. That is the same distinction
 * `CiCapacityDisclosure` draws in the other direction.
 *
 * ## What it shows, and what it refuses to
 *
 * Each row is one `coord.operator_audit` stamp: the acting operator, the
 * action, the resource, and — promoted out of `metadata` — the **blast
 * radius**, following `operator_disable.rs`, which computes
 * `affected_tenant_ids` before stamping precisely so the reach is auditable
 * after the fact rather than only inferable.
 *
 * Two refusals are load-bearing:
 *
 *  * A row whose metadata names no blast-radius key renders "not stated by the
 *    writer", never a quiet blank. An unstated reach is UNKNOWN, not zero.
 *  * An `operator_id` of all zeroes is called out as coord's nil-UUID fallback
 *    rather than rendered as an operator. It means a coord writer used
 *    `resolve_operator_id(&headers)` — a header this service never sends — and
 *    `audit_mutation` swallowed the FK violation in a fire-and-forget warn. The
 *    plan's §6 guardrail exists because that failure is otherwise invisible;
 *    this is where it becomes visible.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ScrollText } from "lucide-react";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { httpClient } from "@/services/service-factory";
import {
  AUDIT_FILTERS,
  DEFAULT_AUDIT_FILTER_ID,
  blastRadiusOf,
  isNilOperator,
  parseAuditPayload,
  reasonOf,
  resolveAuditFilter,
  type AuditRead,
  type AuditRow,
} from "./operatorAudit";

/** Same same-origin convention as `FLEET_HEALTH_API`. */
export const OPERATOR_AUDIT_API = "/api/v1/operations/coord/audit/recent";

/** Enough to reach back through an incident without scanning the table. */
const AUDIT_LIMIT = 100;

function OperatorCell({ row }: { row: AuditRow }) {
  if (isNilOperator(row)) {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
        title={
          "coord stamped this row with the nil UUID, which is the " +
          "`resolve_operator_id(&headers)` fallback — it reads a header " +
          "qontinui-web never sends. The acting operator was NOT recorded."
        }
        data-testid="audit-nil-operator"
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        operator not recorded
      </span>
    );
  }
  if (!row.operator_id) {
    return <span className="text-muted-foreground">no operator on row</span>;
  }
  return <span className="font-mono text-[11px]">{row.operator_id}</span>;
}

function AuditRowView({
  row,
  expanded,
  onToggle,
}: {
  row: AuditRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const blast = blastRadiusOf(row);
  const reason = reasonOf(row);
  return (
    <RecordRow
      rowKey={row.audit_id}
      data-testid={`audit-row-${row.audit_id}`}
      identity={<span className="font-mono">{row.action}</span>}
      label={
        row.resource_key ? (
          <span title={row.resource_key}>
            {row.resource_kind ? `${row.resource_kind} · ` : ""}
            {row.resource_key}
          </span>
        ) : (
          <span className="text-muted-foreground">no resource named</span>
        )
      }
      status={
        blast.unstated ? (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
            title="This row's metadata named no blast-radius field. The writer did not compute one — that is not the same as the action having affected nothing."
            data-testid="audit-blast-unstated"
          >
            reach not stated
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px]"
            data-testid="audit-blast-stated"
          >
            {blast.items.length} recorded
          </Badge>
        )
      }
      reason={reason ?? undefined}
      time={<RowTime at={row.occurred_at} verb="At" />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid={`audit-detail-${row.audit_id}`}
        why={
          <div className="space-y-1">
            <p className="text-xs">
              <span className="text-muted-foreground">Operator: </span>
              <OperatorCell row={row} />
            </p>
            <p className="text-xs">
              <span className="text-muted-foreground">Reason: </span>
              {reason ?? (
                <span className="italic text-muted-foreground">
                  none stated on this row
                </span>
              )}
            </p>
          </div>
        }
        problems={
          <div data-testid={`audit-blast-${row.audit_id}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Blast radius
            </p>
            {blast.unstated ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Not stated. This action&apos;s writer computed no blast-radius
                field, so how far it reached is <strong>unknown</strong> from
                this row — not zero. The pattern to follow is
                <code className="mx-1 font-mono">operator_disable.rs</code>,
                which computes{" "}
                <code className="font-mono">affected_tenant_ids</code> before
                stamping.
              </p>
            ) : (
              <dl className="mt-0.5 space-y-0.5 text-xs">
                {blast.items.map((item) => (
                  <div key={item.key} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="font-mono break-all">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        }
        raw={
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px]">
            {JSON.stringify(
              {
                audit_id: row.audit_id,
                occurred_at: row.occurred_at,
                metadata: row.metadata,
              },
              null,
              2
            )}
          </pre>
        }
      />
    </RecordRow>
  );
}

export function OperatorAuditPanel() {
  const [filterId, setFilterId] = useState(DEFAULT_AUDIT_FILTER_ID);
  const [read, setRead] = useState<AuditRead>({ state: "loading" });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const filter = useMemo(() => resolveAuditFilter(filterId), [filterId]);

  const load = useCallback(async () => {
    setRead({ state: "loading" });
    const params = new URLSearchParams({ limit: String(AUDIT_LIMIT) });
    if (filter.action) params.set("action", filter.action);
    try {
      const body = await httpClient.get<unknown>(
        `${OPERATOR_AUDIT_API}?${params.toString()}`
      );
      setRead(parseAuditPayload(body));
    } catch (err) {
      setRead({
        state: "unavailable",
        reason:
          err instanceof Error
            ? `the audit feed could not be read: ${err.message}`
            : "the audit feed could not be read.",
      });
    }
  }, [filter.action]);

  // Read on mount and on a filter change; NOT polled. An audit trail is
  // append-only history, not liveness — the reason to re-read it is that you
  // just did something, which is what the Refresh button is for.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <CollapsiblePanel
      data-testid="operator-audit-panel"
      storageKey="devops:operator-audit"
      defaultOpen={false}
      icon={<ScrollText className="h-4 w-4" />}
      title="Operator audit"
      summary={
        read.state === "ok" ? (
          <Badge variant="outline" className="text-[10px]">
            {read.rows.length}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            &ndash;
          </Badge>
        )
      }
      headerActions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          data-testid="operator-audit-refresh"
        >
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Every operator write coord stamped for this tenant, newest first —
          including the machine pauses set from the rows above. This is the
          durable answer to &ldquo;who took this host out, when, and why&rdquo;;
          the pause control itself cannot tell you, because coord serves no read
          of its drain map.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="operator-audit-filter"
            className="text-xs text-muted-foreground"
          >
            Showing
          </label>
          <select
            id="operator-audit-filter"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={filterId}
            onChange={(e) => setFilterId(e.target.value)}
            data-testid="operator-audit-filter"
          >
            {AUDIT_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {filter.hint}
          </span>
        </div>

        {read.state === "unavailable" ? (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2"
            role="status"
            data-testid="operator-audit-error"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                Audit feed unreadable
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The console could not read the audit feed &mdash; {read.reason}{" "}
                This says nothing about whether anyone changed anything; it is a
                statement about the request. Coord gates this route on the{" "}
                <code className="font-mono">admin</code> role, so a 403 here
                means the account lacks it, not that the feed is empty.
              </p>
            </div>
          </div>
        ) : (
          <RecordList
            items={read.state === "ok" ? read.rows : []}
            loaded={read.state === "ok"}
            itemKey={(row, i) => row.audit_id || `audit-${i}`}
            expandedKey={openKey}
            onExpandedKeyChange={setOpenKey}
            empty={
              <p className="text-xs text-muted-foreground">
                No <span className="font-mono">{filter.action ?? "*"}</span>{" "}
                rows in the most recent {AUDIT_LIMIT}. The read succeeded
                &mdash; this is a measurement, not a failed look. Widen the
                filter to see whether anything else was written.
              </p>
            }
            renderRow={(row, ctx) => (
              <AuditRowView
                key={row.audit_id}
                row={row}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        )}
      </div>
    </CollapsiblePanel>
  );
}
