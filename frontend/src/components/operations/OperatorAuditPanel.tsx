"use client";

/**
 * "Who did that, when, and why" — the operator audit feed, on the page where
 * the question gets asked. Plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 5.
 *
 * ## Why the Dev Ops page and not a sibling route
 *
 * The plan left the placement open. It belongs here for one reason: **the write
 * this feed exists to explain is three inches up the page.** Every machine row
 * carries a Drain/Undrain lever (`DeviceDrainControl`), which shows the drain
 * in force NOW; this feed is the durable answer to who set or released it,
 * when, and with what reach. A sibling `/admin/coord/audit`
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
 *
 * ## Presentation mode (plan `2026-10-23-console-presentation-spaces` Phase 7)
 *
 * The feed says what happened and when, in fixed words (`auditPresentation`):
 * a row's resource renders as the machine's alias when it is one of the
 * fleet's devices, and otherwise through `RedactedText` with a structured
 * descriptor; the actor is an alias when it is a machine and withheld when it
 * is a person; the reason is a descriptor; blast-radius values are counts,
 * aliases or redacted; and the raw metadata is not rendered. The view filters
 * and Refresh only change what is shown, so they are marked navigation-only;
 * the resource-key search (it takes device ids) is not rendered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { AlertTriangle, ScrollText } from "lucide-react";
import {
  CollapsiblePanel,
  NAVIGATION_ONLY_PROPS,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
} from "@/components/console";
import {
  MachineName,
  RedactedText,
  SectionCaption,
  usePresentationMode,
} from "@/components/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchCoordAuditRecent } from "@/lib/api/operations/coordAudit";
import {
  auditActorMachine,
  auditAreaWord,
  auditListCount,
  auditListValues,
  auditResourceKindWord,
  auditResourceMachine,
  indexDevices,
} from "./auditPresentation";
import { DEVOPS_SOURCES } from "./devOpsHeadline";
import type { FleetDeviceRef } from "./fleetResources";
import {
  AUDIT_FILTERS,
  DEFAULT_AUDIT_FILTER_ID,
  blastRadiusOf,
  describeAuditAction,
  isAuthorizationCheck,
  isNilOperator,
  parseAuditPayload,
  reasonOf,
  resolveAuditFilter,
  type AuditRead,
  type AuditRow,
  type BlastRadiusItem,
} from "./operatorAudit";

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
  // R8 — the label reaches the screen, the enum reaches a data attribute. An
  // action this build has no label for shows its own id rather than a
  // friendly-sounding placeholder: the id is a real fact and a working filter
  // term, and `data-audit-action-mapped` says which case you are looking at.
  const actionLabel = describeAuditAction(row.action);
  return (
    <RecordRow
      rowKey={row.audit_id}
      data-testid={`audit-row-${row.audit_id}`}
      identity={
        <span
          className={actionLabel.mapped ? undefined : "font-mono"}
          title={row.action}
          data-audit-action={row.action}
          data-audit-action-mapped={actionLabel.mapped ? "true" : "false"}
        >
          {actionLabel.label}
        </span>
      }
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
                action: row.action,
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

/**
 * One promoted blast-radius value as an outsider sees it: a count instead of
 * tenant ids, an alias instead of a device id, repositories only when
 * provably first-party, and an operator never.
 */
function PresentedBlastValue({
  row,
  item,
  byId,
}: {
  row: AuditRow;
  item: BlastRadiusItem;
  byId: ReturnType<typeof indexDevices>;
}) {
  switch (item.key) {
    case "affected_tenant_ids": {
      const n = auditListCount(row, item.key);
      return (
        <>{n === null ? "unknown" : n === 1 ? "1 tenant" : `${n} tenants`}</>
      );
    }
    case "affected_repos":
    case "scope_key": {
      const repos =
        item.key === "affected_repos"
          ? auditListValues(row, item.key)
          : [item.value];
      return (
        <RedactedText
          text={item.value}
          repo={repos}
          descriptor={{
            kind: item.key === "affected_repos" ? "Repositories" : "Scope",
            status: "recorded",
            at: row.occurred_at,
          }}
        />
      );
    }
    case "device_id": {
      const known = byId.get(item.value.trim().toLowerCase());
      return (
        <MachineName
          identity={{
            deviceId: item.value,
            hostname: known?.hostname ?? null,
          }}
        />
      );
    }
    case "target_operator_id":
      return <>an operator — withheld in presentation mode</>;
    default:
      // Drained / released, an expiry, a writer, a policy name, a level, a
      // version, a commit prefix: fixed vocabulary, times and numbers.
      return <>{item.value}</>;
  }
}

/** The presentation-mode audit row (see the module doc). */
function PresentedAuditRow({
  row,
  byId,
  expanded,
  onToggle,
}: {
  row: AuditRow;
  byId: ReturnType<typeof indexDevices>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const blast = blastRadiusOf(row);
  const reason = reasonOf(row);
  const actionLabel = describeAuditAction(row.action);
  const machine = auditResourceMachine(row, byId);
  const actor = auditActorMachine(row, byId);
  return (
    <RecordRow
      rowKey={row.audit_id}
      data-testid={`audit-row-${row.audit_id}`}
      identity={
        <span
          className={actionLabel.mapped ? undefined : "font-mono"}
          data-audit-action-mapped={actionLabel.mapped ? "true" : "false"}
        >
          {actionLabel.label}
        </span>
      }
      label={
        machine ? (
          <MachineName identity={machine} />
        ) : row.resource_key ? (
          <RedactedText
            text={row.resource_key}
            repo={row.resource_key}
            descriptor={{
              kind: auditResourceKindWord(row.resource_kind),
              area: auditAreaWord(row.action),
              status: actionLabel.label,
              at: row.occurred_at,
            }}
          />
        ) : (
          <span className="text-muted-foreground">no resource named</span>
        )
      }
      status={
        <Badge
          variant="outline"
          className={`text-[10px]${blast.unstated ? " text-muted-foreground" : ""}`}
          data-testid={
            blast.unstated ? "audit-blast-unstated" : "audit-blast-stated"
          }
        >
          {blast.unstated
            ? "reach not stated"
            : `${blast.items.length} recorded`}
        </Badge>
      }
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
              {actor ? (
                <MachineName identity={actor} />
              ) : isNilOperator(row) ? (
                <OperatorCell row={row} />
              ) : row.operator_id ? (
                <span className="text-muted-foreground">
                  an operator — withheld in presentation mode
                </span>
              ) : (
                <span className="text-muted-foreground">
                  no operator on row
                </span>
              )}
            </p>
            <p className="text-xs">
              <span className="text-muted-foreground">Reason: </span>
              {reason ? (
                <RedactedText
                  text={reason}
                  repo={null}
                  descriptor={{
                    kind: "Reason",
                    status: "recorded",
                    at: row.occurred_at,
                  }}
                />
              ) : (
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
                Not stated — how far this change reached is{" "}
                <strong>unknown</strong> from this row, not zero.
              </p>
            ) : (
              <dl className="mt-0.5 space-y-0.5 text-xs">
                {blast.items.map((item) => (
                  <div key={item.key} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="break-all">
                      <PresentedBlastValue row={row} item={item} byId={byId} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        }
      />
    </RecordRow>
  );
}

/** Stable identity for the default, so the device index is built once. */
const NO_DEVICES: readonly FleetDeviceRef[] = [];

export function OperatorAuditPanel({
  devices = NO_DEVICES,
}: {
  /**
   * The fleet's devices (the page's `/fleet/health` spine), so presentation
   * mode can recognise a row whose resource or actor is a machine and name it
   * by its alias. Unused in operator mode.
   */
  devices?: readonly FleetDeviceRef[];
} = {}) {
  const { presenting } = usePresentationMode();
  const byId = useMemo(() => indexDevices(devices), [devices]);
  const [filterId, setFilterId] = useState(DEFAULT_AUDIT_FILTER_ID);
  const [read, setRead] = useState<AuditRead>({ state: "loading" });
  // When the current `ok` read arrived — the presentation chip's as-of. The
  // route serves no timestamp of its own.
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const filter = useMemo(() => resolveAuditFilter(filterId), [filterId]);

  // `require_role` stamps a `resource_kind=http.route` row on EVERY
  // authorized request through its layer, GETs included — so each read or
  // refresh of this panel writes into the feed it renders. Hidden by default so the
  // feed opens on the rows that answer "who did this", not the noise
  // reading it generates; the count stays visible so the toggle is never a
  // silent narrowing.
  const [hideAuthChecks, setHideAuthChecks] = useState(true);

  // Applied separately from the input's live value so typing does not
  // re-fetch on every keystroke — only `resourceKeyFilter` feeds `load`.
  const [resourceKeyInput, setResourceKeyInput] = useState("");
  const [resourceKeyFilter, setResourceKeyFilter] = useState("");

  // Both the proxy and coord gate this feed on coord-tenant admin, so a
  // non-admin read is a certain 403. It is not issued: the panel says who can
  // read it instead. `isCoordAdmin` is false until the user loads, and the
  // effect below re-runs when it turns true.
  const { isCoordAdmin, loading: authLoading, user } = useAuth();
  // `isCoordAdmin` is false while the user is still loading, which is NOT the
  // same fact as "this user is not an admin". Only a loaded user who is not an
  // admin gets the admin-only notice; until then the panel reads as loading.
  const authResolved = !authLoading && user != null;
  const confirmedNonAdmin = authResolved && !isCoordAdmin;

  // Stale-response guard. A filter change or Refresh issues a new read while
  // an older one may still be in flight; only the NEWEST request may write
  // `read`, or a slow earlier response would overwrite the current filter's
  // rows with another filter's. Unmount bumps it too, so nothing writes after.
  const requestSeq = useRef(0);
  useEffect(
    () => () => {
      requestSeq.current += 1;
    },
    []
  );

  const load = useCallback(async () => {
    if (!isCoordAdmin) return;
    const seq = ++requestSeq.current;
    setRead({ state: "loading" });
    try {
      const body = await fetchCoordAuditRecent({
        limit: AUDIT_LIMIT,
        action: filter.action,
        via: filter.via,
        resource_key: resourceKeyFilter,
      });
      if (seq !== requestSeq.current) return;
      const parsed = parseAuditPayload(body);
      setRead(parsed);
      if (parsed.state === "ok") setFetchedAtMs(Date.now());
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setRead({
        state: "unavailable",
        reason:
          err instanceof Error
            ? `the audit feed could not be read: ${err.message}`
            : "the audit feed could not be read.",
      });
    }
  }, [filter.action, filter.via, resourceKeyFilter, isCoordAdmin]);

  // Read on mount and on a filter change; NOT polled. An audit trail is
  // append-only history, not liveness — the reason to re-read it is that you
  // just did something, which is what the Refresh button is for.
  useEffect(() => {
    void load();
  }, [load]);

  const allRows = read.state === "ok" ? read.rows : [];
  const hiddenAuthChecks = allRows.filter(isAuthorizationCheck).length;
  const visibleRows = hideAuthChecks
    ? allRows.filter((row) => !isAuthorizationCheck(row))
    : allRows;

  return (
    <>
      <SectionCaption
        id="dev-ops.audit"
        sources={[
          {
            source: DEVOPS_SOURCES.operatorAudit,
            asOf: read.state === "ok" ? fetchedAtMs : null,
          },
        ]}
      />
      <CollapsiblePanel
        data-testid="operator-audit-panel"
        storageKey="devops:operator-audit"
        defaultOpen={false}
        icon={<ScrollText className="h-4 w-4" />}
        title="Operator audit"
        summary={
          read.state === "ok" ? (
            <Badge variant="outline" className="text-[10px]">
              {visibleRows.length}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              &ndash;
            </Badge>
          )
        }
        headerActions={
          <Button
            // A re-read of an append-only feed: it changes only what is
            // displayed (D3.2).
            {...NAVIGATION_ONLY_PROPS}
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
          {/* Operator orientation (the lever it points at is not mounted for
            an outsider); the section caption says what this feed is. */}
          {!presenting && (
            <p className="text-xs text-muted-foreground">
              Every operator write coord stamped for this tenant, newest first —
              including the machine drains set from the rows above. The drain
              lever shows what is in force now; this is the durable answer to
              &ldquo;who took this host out, when, and why&rdquo;.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="operator-audit-filter"
              className="text-xs text-muted-foreground"
            >
              Showing
            </label>
            <select
              // A view filter: it changes which rows are shown (D3.2).
              {...NAVIGATION_ONLY_PROPS}
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

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                // A view filter: it changes which rows are shown (D3.2).
                {...NAVIGATION_ONLY_PROPS}
                type="checkbox"
                checked={hideAuthChecks}
                onChange={(e) => setHideAuthChecks(e.target.checked)}
                data-testid="operator-audit-hide-auth-checks"
              />
              Hide authorization checks
              {hiddenAuthChecks > 0 ? ` (${hiddenAuthChecks} hidden)` : ""}
            </label>
          </div>

          {/* The resource-key search takes device ids and repository names —
            identifiers the presentation view never shows — so it is the
            operator's alone. */}
          {!presenting && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setResourceKeyFilter(resourceKeyInput.trim());
              }}
            >
              <label
                htmlFor="operator-audit-resource-key"
                className="text-xs text-muted-foreground"
              >
                Resource key
              </label>
              <input
                id="operator-audit-resource-key"
                type="text"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                placeholder="e.g. a device id — who touched THIS host"
                value={resourceKeyInput}
                onChange={(e) => setResourceKeyInput(e.target.value)}
                data-testid="operator-audit-resource-key"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                data-testid="operator-audit-resource-key-apply"
              >
                Apply
              </Button>
              {resourceKeyFilter ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setResourceKeyInput("");
                    setResourceKeyFilter("");
                  }}
                  data-testid="operator-audit-resource-key-clear"
                >
                  Clear
                </Button>
              ) : null}
            </form>
          )}

          {confirmedNonAdmin ? (
            <p
              className="text-xs text-muted-foreground"
              role="status"
              data-testid="operator-audit-admin-only"
            >
              The operator audit feed is readable by coord admins only, so it
              was not requested for this account. That is a statement about
              access, not about whether anyone changed anything.
            </p>
          ) : read.state === "unavailable" ? (
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
                  The console could not read the audit feed &mdash;{" "}
                  {read.reason} This says nothing about whether anyone changed
                  anything; it is a statement about the request. Coord gates
                  this route on the <code className="font-mono">admin</code>{" "}
                  role, so a 403 here means the account lacks it, not that the
                  feed is empty.
                </p>
              </div>
            </div>
          ) : (
            <RecordList
              items={visibleRows}
              loaded={read.state === "ok"}
              itemKey={(row, i) => row.audit_id || `audit-${i}`}
              expandedKey={openKey}
              onExpandedKeyChange={setOpenKey}
              empty={
                allRows.length > 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="operator-audit-all-hidden"
                  >
                    All {allRows.length} row(s) in this window are authorization
                    checks (<span className="font-mono">http.route</span>),
                    hidden by &ldquo;Hide authorization checks&rdquo; above
                    &mdash; not a real write. Turn it off to see them.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No <span className="font-mono">{filter.action ?? "*"}</span>{" "}
                    {filter.via ? (
                      <>
                        with{" "}
                        <span className="font-mono">
                          via: {filter.via}
                        </span>{" "}
                      </>
                    ) : null}
                    rows for this tenant at all &mdash; coord applies the filter
                    BEFORE the {AUDIT_LIMIT}-row limit, so this is zero matches,
                    not &ldquo;none in the last {AUDIT_LIMIT}&rdquo;. The read
                    succeeded; this is a measurement, not a failed look. Widen
                    the filter to see whether anything else was written.
                  </p>
                )
              }
              renderRow={(row, ctx) =>
                presenting ? (
                  <PresentedAuditRow
                    key={row.audit_id}
                    row={row}
                    byId={byId}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                  />
                ) : (
                  <AuditRowView
                    key={row.audit_id}
                    row={row}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                  />
                )
              }
            />
          )}
        </div>
      </CollapsiblePanel>
    </>
  );
}
