"use client";

/**
 * The repository corpus list: two views, the filter bar, and the paged rows.
 *
 * **Two views, not one filter.** "Never closed out" is served by its own
 * route (`GET /unfinished`) because the server derives it from three
 * independent signals — compliance footer, the `/unattended` taxonomy, and
 * open gates/PRs. Offering it as `?closeout_state=unfinished` would let the
 * UI re-derive from one signal and quietly disagree with the answer the
 * operator asked for by name (plan §3.4).
 *
 * **Facet shape follows the vocabulary, not convenience.** `state`,
 * `closeout_state` and `tenant_source` are Postgres CHECK-backed closed
 * vocabularies, so they are dropdowns. `account` and `repo` are free text —
 * an account home is whatever suffix someone created — so they are inputs
 * with the values SEEN ON THE LOADED PAGE offered as chips and labelled as
 * such. A dropdown built from page 1 is an invisible ceiling.
 *
 * **The filter bar tells the truth about itself.** Attribution and
 * secret-findings filtering are checked against what came back; if the server
 * did not apply them, the banner says so and says the filtering happened on
 * the loaded page only. See `useSessionRepository`'s `FilterHonesty`.
 */

import {
  AlertTriangle,
  Archive,
  RefreshCw,
  Search,
  ShieldQuestion,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PAGE_SIZE,
  useSessionRepository,
  type SecretAudit,
} from "./useSessionRepository";
import { SessionArtifactRow } from "./SessionArtifactRow";
import {
  CLOSEOUT_LABELS,
  SESSION_CLOSEOUT_STATES,
  SESSION_STATES,
  SESSION_TENANT_SOURCES,
  TENANT_SOURCE_LABELS,
} from "./types";

/** Radix reserves the empty string as a Select value, so "any" needs a token. */
const ANY = "__any__";

export function SessionRepositoryList() {
  const {
    view,
    changeView,
    filters,
    updateFilter,
    resetFilters,
    hasFilters,
    seen,
    items,
    serverTotal,
    guessedTenantCount,
    honesty,
    unfinished,
    offset,
    setOffset,
    loading,
    error,
    reload,
  } = useSessionRepository();

  const listView = view === "all";

  return (
    <section className="space-y-3" data-testid="session-repository-list">
      {/* ── View switch ─────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-ui-bridge-id="session-repository.views"
      >
        <Button
          variant={listView ? "default" : "outline"}
          size="sm"
          onClick={() => changeView("all")}
          data-testid="session-repository-view-all"
        >
          <Archive className="size-3.5" />
          All archived sessions
        </Button>
        <Button
          variant={!listView ? "default" : "outline"}
          size="sm"
          onClick={() => changeView("unfinished")}
          data-testid="session-repository-view-unfinished"
        >
          <AlertTriangle className="size-3.5" />
          Never closed out
        </Button>
        {!listView && (
          <p className="text-xs text-muted-foreground">
            Derived server-side from the compliance footer, the
            <code className="mx-1 font-mono">/unattended</code>
            taxonomy, and open gates or unlanded PRs attributable to the
            session. Filters do not apply to this view.
          </p>
        )}
      </div>

      {/* ── Filters (corpus view only) ──────────────────────────────── */}
      {listView && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search prompts…"
                value={filters.q}
                onChange={(e) => updateFilter("q", e.target.value)}
                data-testid="session-repository-q"
              />
            </div>

            <Input
              className="w-[150px]"
              placeholder="Account"
              value={filters.account}
              onChange={(e) => updateFilter("account", e.target.value)}
              data-testid="session-repository-account"
            />

            <Input
              className="w-[150px]"
              placeholder="Repo"
              value={filters.repo}
              onChange={(e) => updateFilter("repo", e.target.value)}
              data-testid="session-repository-repo"
            />

            <Select
              value={filters.state === "" ? ANY : filters.state}
              onValueChange={(v) => updateFilter("state", v === ANY ? "" : v)}
            >
              <SelectTrigger
                className="w-[140px]"
                data-testid="session-repository-state"
              >
                <SelectValue placeholder="Any state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any state</SelectItem>
                {SESSION_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={
                filters.closeoutState === "" ? ANY : filters.closeoutState
              }
              onValueChange={(v) =>
                updateFilter("closeoutState", v === ANY ? "" : v)
              }
            >
              <SelectTrigger
                className="w-[180px]"
                data-testid="session-repository-closeout"
              >
                <SelectValue placeholder="Any closeout" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any closeout</SelectItem>
                {SESSION_CLOSEOUT_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CLOSEOUT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Plan §3.6 rule 2: a guessed attribution must be FILTERABLE,
                not merely visible. */}
            <Select
              value={filters.tenantSource === "" ? ANY : filters.tenantSource}
              onValueChange={(v) =>
                updateFilter("tenantSource", v === ANY ? "" : v)
              }
            >
              <SelectTrigger
                className="w-[220px]"
                data-testid="session-repository-tenant-source"
              >
                <SelectValue placeholder="Any attribution" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any attribution</SelectItem>
                {SESSION_TENANT_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TENANT_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="w-[160px]"
              type="date"
              value={filters.since}
              onChange={(e) => updateFilter("since", e.target.value)}
              aria-label="Active since"
              data-testid="session-repository-since"
            />

            {/* Plan §5: `coord_redacted` bodies carry a digest that cannot be
                verified against the original, so they are separable. */}
            <Select
              value={filters.bodySource === "" ? ANY : filters.bodySource}
              onValueChange={(v) =>
                updateFilter("bodySource", v === ANY ? "" : v)
              }
            >
              <SelectTrigger
                className="w-[200px]"
                data-testid="session-repository-body-source"
              >
                <SelectValue placeholder="Any body source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any body source</SelectItem>
                <SelectItem value="disk_verbatim">
                  Verbatim from disk
                </SelectItem>
                <SelectItem value="coord_redacted">
                  Redacted (digest not verifiable)
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Plan §4.1: an audit query. It SELECTS rows — it never hides
                one from a caller who did not ask, and never masks a body.
                Three buckets, because "never scanned" is not "clean". */}
            <Select
              value={filters.secretAudit === "" ? ANY : filters.secretAudit}
              onValueChange={(v) =>
                updateFilter(
                  "secretAudit",
                  v === ANY ? "" : (v as SecretAudit)
                )
              }
            >
              <SelectTrigger
                className="w-[210px]"
                data-testid="session-repository-secret-audit"
                title="An audit query over the backfill detector's output. Selecting rows here hides nothing from anyone and masks no body — exposure is controlled by access, not by mutating bytes."
              >
                <SelectValue placeholder="Any detector state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any detector state</SelectItem>
                <SelectItem value="findings">Has secret findings</SelectItem>
                <SelectItem value="scanned_clean">
                  Scanned, no findings
                </SelectItem>
                <SelectItem value="never_scanned">Never scanned</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                data-testid="session-repository-clear"
              >
                <X className="size-3.5" />
                Clear
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => void reload()}
              disabled={loading}
              data-testid="session-repository-refresh"
              aria-label="Reload"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>

          {/* Suggestions from the LOADED page — explicitly not the corpus. */}
          {(seen.accounts.length > 0 || seen.repos.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>On this page:</span>
              {seen.accounts.map((a) => (
                <button
                  key={`account-${a}`}
                  type="button"
                  className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70"
                  onClick={() => updateFilter("account", a)}
                  data-testid={`facet-account-${a}`}
                >
                  {a}
                </button>
              ))}
              {seen.repos.map((r) => (
                <button
                  key={`repo-${r}`}
                  type="button"
                  className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70"
                  onClick={() => updateFilter("repo", r)}
                  data-testid={`facet-repo-${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── The filter bar's own honesty ────────────────────────────── */}
      {honesty.degraded && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="session-repository-filter-degraded"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            This backend did not apply {honesty.ignored.join(" or ")}. The rows
            below were filtered on the LOADED PAGE only —{" "}
            {honesty.droppedLocally} row
            {honesty.droppedLocally === 1 ? "" : "s"} dropped here, and
            matching rows on other pages are not shown. Treat this as a
            partial answer, not the corpus.
          </p>
        </div>
      )}

      {/* ── What GET /unfinished reports beside its results ─────────── */}
      {!listView && unfinished && (
        <div
          className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
          data-testid="session-repository-unfinished-context"
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">
              {unfinished.unknownCount}
            </strong>{" "}
            session{unfinished.unknownCount === 1 ? "" : "s"} have never been
            evaluated for closeout at all, and{" "}
            <strong className="text-foreground">
              {unfinished.cleanCount}
            </strong>{" "}
            are recorded as closed out. The unevaluated bucket is deliberately
            NOT merged into the list below: an empty list beside a large
            unevaluated count means the derivation has not run, which is a
            different fact from &ldquo;everything was closed out&rdquo;.
          </p>
          {unfinished.coordOutstanding && (
            <p
              className={
                unfinished.coordOutstanding.available
                  ? "text-muted-foreground"
                  : "flex items-start gap-1.5 text-amber-700 dark:text-amber-300"
              }
              data-testid="session-repository-coord-signal"
              data-coord-available={
                unfinished.coordOutstanding.available ? "true" : "false"
              }
            >
              {unfinished.coordOutstanding.available ? (
                "coord's outstanding-work ledger was read as part of this answer."
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  coord&apos;s outstanding-work ledger could not be read
                  {unfinished.coordOutstanding.unavailable_reason
                    ? `: ${unfinished.coordOutstanding.unavailable_reason}`
                    : ""}
                  . One of the three closeout signals is missing from this
                  answer, so the list is incomplete rather than short.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* ── Standing attribution census for the loaded page ─────────── */}
      {listView && items.length > 0 && guessedTenantCount > 0 && (
        <p
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          data-testid="session-repository-guessed-census"
        >
          <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
          {guessedTenantCount} of {items.length} rows on this page carry a
          tenant nobody declared. Filter by attribution above to review them.
        </p>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="session-repository-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t load the repository: {error}.{" "}
            {items.length > 0
              ? "Showing the last rows loaded — they may be out of date."
              : "Nothing could be loaded; this is unknown, not empty."}
          </p>
        </div>
      )}

      {loading && items.length === 0 ? (
        <Skeleton className="h-40 w-full" />
      ) : /*
           No rows AND no error is a real empty. No rows WITH an error is
           UNKNOWN — the banner above already says so, and printing "the
           repository is empty" underneath would contradict it in the same
           viewport.
         */
      items.length === 0 && !error ? (
        <p
          className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground"
          data-testid="session-repository-empty"
        >
          {!listView
            ? "No session is recorded as never closed out."
            : hasFilters
              ? "No archived sessions match these filters."
              : "The repository is empty. Nothing has been archived yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <SessionArtifactRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {serverTotal > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="session-repository-range">
            {honesty.degraded ? (
              <>
                showing {items.length} of {serverTotal} matched server-side
                (page filtered locally)
              </>
            ) : (
              <>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, serverTotal)} of{" "}
                {serverTotal}
              </>
            )}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              data-testid="session-repository-prev"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= serverTotal || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              data-testid="session-repository-next"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {!listView && items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1.5">
            {serverTotal}
          </Badge>
          session{serverTotal === 1 ? "" : "s"} never closed out.
        </p>
      )}
    </section>
  );
}
