"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, ListChecks } from "lucide-react";
import { ComplianceStateNotice } from "./ComplianceStateNotice";
import {
  ATTRIBUTION_META,
  ITEM_STATE_LABEL,
  OUTSTANDING_STATES,
  resultBadge,
  type OutstandingItem,
  type OutstandingState,
} from "../compliance-types";

const ALL = "__all__";

type SortKey = "newest" | "oldest" | "state" | "ref" | "session";

const SORT_LABEL: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  state: "State",
  ref: "Item",
  session: "Session",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface LedgerProps {
  items: OutstandingItem[] | null;
  loading: boolean;
  unavailable: boolean;
  degraded: string | null;
  error: string | null;
}

/**
 * The outstanding-work ledger: every `deferred` or `gated` item any session has
 * reported, in one place.
 *
 * This is the first surface on which the fleet's unfinished work is queryable
 * at all — until now it lived scattered through plan files, findable only by
 * remembering which plan it was in. It is given filters and sorting for that
 * reason: a ledger you cannot narrow is a list you stop reading.
 *
 * It is honest about its own scope in two ways. It is a ledger of what sessions
 * REPORTED — not an independent inventory of everything undone, which nothing
 * can produce. And a gate whose link to its session was guessed rather than
 * recorded is labelled as guessed, never shown as a confirmed attribution.
 */
export function OutstandingWorkLedger({
  items,
  loading,
  unavailable,
  degraded,
  error,
}: LedgerProps) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<OutstandingState | typeof ALL>(
    ALL
  );
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const rows = useMemo(() => {
    let r = items ?? [];

    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((i) =>
        [i.ref, i.claude_session_id, i.reason, i.gate_id, i.detail]
          .filter((s): s is string => typeof s === "string")
          .some((s) => s.toLowerCase().includes(q))
      );
    }
    if (stateFilter !== ALL) r = r.filter((i) => i.state === stateFilter);

    const time = (i: OutstandingItem) => {
      const t = new Date(i.checked_at).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return [...r].sort((a, b) => {
      switch (sortKey) {
        case "oldest":
          return time(a) - time(b);
        case "state":
          return a.state.localeCompare(b.state) || time(b) - time(a);
        case "ref":
          return a.ref.localeCompare(b.ref);
        case "session":
          return a.claude_session_id.localeCompare(b.claude_session_id);
        case "newest":
        default:
          return time(b) - time(a);
      }
    });
  }, [items, search, stateFilter, sortKey]);

  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      deferred: all.filter((i) => i.state === "deferred").length,
      gated: all.filter((i) => i.state === "gated").length,
    };
  }, [items]);

  return (
    <section className="space-y-3" data-testid="outstanding-ledger">
      <div className="flex items-start gap-3">
        <ListChecks className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">Outstanding work</h3>
          <p className="text-xs text-muted-foreground">
            Everything sessions have reported as deferred or parked behind a
            gate, across every checked session. This is what the fleet said it
            did not finish — not an independent audit of everything undone.
          </p>
        </div>
      </div>

      <ComplianceStateNotice
        unavailable={unavailable}
        degraded={degraded}
        error={error}
        what="outstanding work"
      />

      {items && items.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="outstanding-search"
              className="text-xs text-muted-foreground"
            >
              Search
            </label>
            <Input
              id="outstanding-search"
              className="h-8 w-64"
              placeholder="item, session, reason, gate…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="outstanding-search"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">State</span>
            <Select
              value={stateFilter}
              onValueChange={(v) =>
                setStateFilter(v as OutstandingState | typeof ALL)
              }
            >
              <SelectTrigger
                className="h-8 w-44"
                data-testid="outstanding-state-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  All ({counts.deferred + counts.gated})
                </SelectItem>
                {OUTSTANDING_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ITEM_STATE_LABEL[s]} ({counts[s]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Sort</span>
            <Select
              value={sortKey}
              onValueChange={(v) => setSortKey(v as SortKey)}
            >
              <SelectTrigger
                className="h-8 w-40"
                data-testid="outstanding-sort"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORT_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="pb-1.5 text-xs text-muted-foreground">
            {rows.length} of {items.length} shown
          </p>
        </div>
      )}

      {loading && !items ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading outstanding work…
        </p>
      ) : items && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No session has reported deferred or gated work.
          </p>
        </div>
      ) : items ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-28">State</TableHead>
                <TableHead>Gate or stated reason</TableHead>
                <TableHead className="w-[15rem]">Session</TableHead>
                <TableHead className="w-44">Reported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nothing matches these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((item, idx) => {
                  const attribution =
                    item.attribution && item.attribution !== "session"
                      ? ATTRIBUTION_META[item.attribution]
                      : null;
                  // Attribution is folded in, so a gate coord only guessed at
                  // never renders with the confirmed (green) chip.
                  const resultMeta = item.result
                    ? resultBadge(item.result, item.attribution)
                    : null;
                  return (
                    <TableRow
                      key={`${item.claude_session_id}-${item.ref}-${idx}`}
                      data-testid="outstanding-row"
                    >
                      <TableCell className="max-w-[22rem]">
                        <span className="block truncate text-sm font-medium">
                          {item.ref}
                        </span>
                        {item.detail && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline">
                            {ITEM_STATE_LABEL[item.state] ?? item.state}
                          </Badge>
                          {resultMeta && (
                            <Badge variant={resultMeta.variant}>
                              {resultMeta.label}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[22rem]">
                        {item.state === "gated" && item.gate_id ? (
                          <div className="space-y-1">
                            <Link
                              href={`/admin/coord/gates?gate=${encodeURIComponent(
                                item.gate_id
                              )}`}
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                              data-testid={`outstanding-gate-link-${item.gate_id}`}
                            >
                              <code className="text-xs">{item.gate_id}</code>
                              <ExternalLink className="size-3" />
                            </Link>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.gate_status && (
                                <span className="text-xs text-muted-foreground">
                                  gate {item.gate_status}
                                </span>
                              )}
                              {attribution && (
                                <Badge
                                  variant="outline"
                                  title={attribution.detail}
                                >
                                  {attribution.label}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ) : item.reason ? (
                          <span className="block whitespace-pre-wrap text-sm text-muted-foreground">
                            {item.reason}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {item.state === "gated"
                              ? "Claimed as gated, but no gate id was given."
                              : "No reason was given."}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="block truncate text-xs">
                          {item.claude_session_id}
                        </code>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatWhen(item.checked_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
