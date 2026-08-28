"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DIFF_ADDED_COUNT_CLASS,
  DIFF_REMOVED_COUNT_CLASS,
  DiffTable,
  FilterTabs,
  diffLines,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { cn } from "@/lib/utils";
import { formatWhen } from "../_lib/format";
import {
  AUTHOR_CLASS_LABEL,
  classifyWriteAuthor,
  isAgentAuthored,
  tallyAuthors,
} from "../_lib/authorship";
import {
  LOOSENING_BADGE_CLASS,
  isLoosening,
  looseningClassificationPresent,
  notificationHref,
  sortWritesForFeed,
  writeKey,
} from "../_lib/writes";
import type { WriteDiffState } from "../_hooks/usePromptDocumentProposals";
import type { PromptDocumentWrite } from "../types";

/**
 * The standing limit of this feed, stated whether or not anything went wrong
 * this request.
 *
 * The feed is assembled from coord's version history, which is written by the
 * same commit as the write — but the operator's *notice* of a write is the
 * post-commit `PolicyDocumentChanged` emit, and that emit is best-effort by
 * design: `notify_document_version_change` logs and raises a
 * `PolicyChangeNotificationEmitFailed` alert rather than failing the write, and
 * is skipped entirely while `coord.notifications` is unprovisioned. That alert
 * kind has no resolver, so a row it opens outlives the fault.
 *
 * None of that sets a per-response caveat, so nothing above would say it. A
 * surface that reports what agents changed must not imply it reports ALL of it,
 * and the honest place to say so is beside the caveats that describe the same
 * class of gap.
 */
const COMPLETENESS_CAVEAT =
  "This list can be incomplete without saying so. Coord announces a write after " +
  "committing it, on a best-effort path: a failed announcement is logged and " +
  "alerted rather than retried, and none are sent at all while coord's " +
  "notification store is unprovisioned. Treat an absent write as unknown, not " +
  "as one that never happened.";

/** DOM id of one row's diff panel — the target of the row's `aria-controls`. */
function diffPanelId(
  write: Pick<PromptDocumentWrite, "kind" | "name" | "version_number">
): string {
  return `write-diff-${write.kind}-${write.name}-${write.version_number}`;
}

/** The author filter's two positions. Off (`all`) is the default. */
type AuthorFilter = "all" | "agent";

interface LandedWriteFeedProps {
  writes: PromptDocumentWrite[];
  /**
   * Every caveat that applies — unreadable, degraded, partial, truncated,
   * limited. They are independent conditions and can co-occur, so all of them
   * are shown.
   */
  notices: string[];
  /** True when a caveat means coord is actually failing, not just incomplete. */
  severe: boolean;
  /**
   * True when the caveats say nothing could be read. Distinct from `severe`:
   * every document failing individually leaves the feed empty without coord
   * being down, and the empty state must not then claim there is simply
   * nothing to show.
   */
  nothingRead: boolean;
  loading: boolean;
  acting: boolean;
  onRevert: (write: PromptDocumentWrite) => Promise<boolean>;
  /** Fetch the two bodies behind one row's diff. Lazy — called on expand. */
  onLoadDiff: (write: PromptDocumentWrite) => Promise<void>;
  /** The cached diff state for a row, or `null` if it was never asked for. */
  diffFor: (write: PromptDocumentWrite) => WriteDiffState | null;
}

/**
 * Landed prompt-document writes, newest first, each revertible in one click.
 *
 * These are the edits that DID land. WHICH edits those are is a tenant setting,
 * not a constant: coord's `policy_write` dial decides whether a classified
 * loosening — an edit that grants or widens what agents may do — is held as a
 * proposal or lands announced. So this feed does not promise a direction. It
 * promises completeness of what landed (subject to `COMPLETENESS_CAVEAT`), and
 * it MARKS a loosening rather than assuming none can appear.
 *
 * Monitoring surface, not a supervision queue — plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, from the tenant's
 * `audience_profile/human-operator`. Nothing here waits on the operator: there
 * is no pending count, no approval affordance and no badge that decays. The
 * question it answers in one screen is *what have agents changed in my
 * governance layer*, and the answer to a wrong one is one click.
 *
 * Every caveat the backend set is rendered — `unavailable`, `degraded`,
 * `partial`, `truncated`, `limited` — because each one means a write is missing
 * from what is on screen.
 *
 * Undo appends a new version restoring the PREVIOUS body; it never rewrites
 * history, so an undo is itself undoable. Only the version that is currently
 * head gets the control — undoing an older-than-head write from a flat feed
 * would silently discard every write made since, so those rows show their
 * version and nothing more.
 *
 * ## Two OPTIONAL columns, and what absent means
 *
 * `loosening` and `notification_ref` are served by a coord change that lands
 * separately from this page. Absent is rendered as absent: no mark, no link, no
 * error, and never a badge asserting the negative. See `_lib/writes.ts`.
 */
export function LandedWriteFeed({
  writes,
  notices,
  severe,
  nothingRead,
  loading,
  acting,
  onRevert,
  onLoadDiff,
  diffFor,
}: LandedWriteFeedProps) {
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const tally = useMemo(() => tallyAuthors(writes), [writes]);

  const visible = useMemo(() => {
    const filtered =
      authorFilter === "agent" ? writes.filter(isAgentAuthored) : writes;
    return sortWritesForFeed(filtered);
  }, [writes, authorFilter]);

  // Both derived from `visible`, never one from each set: the "none flagged"
  // line below talks about what is ON SCREEN, and computing its precondition
  // over the unfiltered feed would let a hidden operator-authored loosening
  // license a sentence about the rows the operator can actually see.
  const classified = useMemo(
    () => looseningClassificationPresent(visible),
    [visible]
  );
  const flaggedCount = useMemo(
    () => visible.filter(isLoosening).length,
    [visible]
  );

  // R6: a count that has not been fetched is `–`, never `0`. Nothing was read
  // ⇒ these counts describe an empty screen, not an empty corpus.
  const counted = !nothingRead;
  const hiddenByFilter =
    authorFilter === "agent"
      ? tally.operator + tally.system + tally.unknown
      : 0;

  const toggle = (write: PromptDocumentWrite) => {
    const key = writeKey(write);
    // The fetch is kicked off OUTSIDE the state updater. An updater must be
    // pure: React may run it during render (and StrictMode runs it twice on
    // purpose), and `onLoadDiff` sets state on the parent — which from a
    // render pass is a cross-component update React refuses.
    const opening = expandedKey !== key;
    setExpandedKey(opening ? key : null);
    if (opening) {
      // Fire-and-forget: the row renders its own loading/error state from the
      // cache, so an unhandled rejection here would only duplicate that.
      void onLoadDiff(write);
    }
  };

  return (
    <section className="space-y-3" data-testid="landed-writes">
      <div>
        <h2 className="text-sm font-semibold">Recently landed writes</h2>
        <p className="text-xs text-muted-foreground">
          Every edit that went straight in, newest first — whatever direction it
          was. Which kinds of edit are allowed to land unheld is your
          policy-write setting, so anything that widens what agents may do can
          appear here too; those are marked and sorted to the top. Each write is
          a new version, so undoing the latest is one click and is itself
          undoable.
        </p>
      </div>

      {/* R6 filter strip. Off by default — an author filter that hides rows is
          opt-in, and what it hides is counted below rather than dropped. */}
      <FilterTabs
        tabs={[
          { id: "all", label: "All authors", count: counted ? writes.length : null },
          {
            id: "agent",
            label: "Agent-authored",
            count: counted ? tally.agent : null,
          },
        ]}
        active={authorFilter}
        onChange={setAuthorFilter}
        testIdPrefix="landed-writes-author"
      />

      {authorFilter === "agent" && hiddenByFilter > 0 && (
        // The web proxy returns writes unfiltered on purpose — "filtering on a
        // guessed prefix would silently hide writes". This filter is therefore
        // allowed to hide, but never silently: it says how many and in which
        // class, so an unrecognised author label shows up as a number the
        // operator can act on rather than as a row that vanished.
        <p
          className="text-xs text-muted-foreground"
          data-testid="landed-writes-filter-hidden"
        >
          Hiding {hiddenByFilter}{" "}
          {hiddenByFilter === 1 ? "write" : "writes"} that this filter does not
          class as agent-authored: {tally.operator} by you, {tally.system} from
          coord&apos;s shipped defaults, {tally.unknown} whose author label is
          not one this page recognises.
        </p>
      )}

      {/* Coord genuinely failing gets the amber treatment; "incomplete but
          working" (degraded / partial / truncated) stays muted. The standing
          completeness caveat rides in the same box — it describes the same
          class of gap, and hiding it when nothing else went wrong is exactly
          the implied completeness this surface must not offer. */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2.5",
          severe
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-border bg-muted/50"
        )}
        data-testid="landed-writes-notice"
      >
        <AlertTriangle
          className={cn(
            "mt-0.5 size-4 shrink-0",
            severe
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          )}
        />
        <div
          className={cn(
            "space-y-1 text-sm",
            severe
              ? "text-amber-800 dark:text-amber-200"
              : "text-muted-foreground"
          )}
        >
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          <p data-testid="landed-writes-completeness">{COMPLETENESS_CAVEAT}</p>
        </div>
      </div>

      {loading && writes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading recent writes…
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {/* "Nothing recorded yet" is a CLAIM, and only safe when the feed
                actually read everything. coord being down is one way to lose
                that right; so is every document failing individually, which
                sets `partial` without `unavailable`. Either way, do not tell
                the operator the queue is empty. And a filtered view being
                empty says nothing about the corpus at all. */}
            {nothingRead
              ? "No writes could be read — see the note above."
              : authorFilter === "agent"
                ? "No agent-authored writes among the ones on this page."
                : "No document writes recorded yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((write) => {
            const isHead = write.version_number === write.current_version;
            const key = writeKey(write);
            const expanded = expandedKey === key;
            const flagged = isLoosening(write);
            const authorClass = classifyWriteAuthor(write.edited_by);
            const href = notificationHref(write.notification_ref);
            return (
              <li
                key={key}
                // No left-edge accent: R4's accent encodes ATTENTION, and a
                // landed loosening needs none — it already landed and nothing
                // waits on the operator. The mark is the badge and the sort.
                className="rounded-lg border border-border bg-card"
                data-testid={`write-${write.kind}-${write.name}-${write.version_number}`}
                data-loosening={flagged ? "true" : undefined}
              >
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={expanded}
                    // Undefined while collapsed: `WriteDiff` only mounts when
                    // expanded, so a constant IDREF here points at nothing for
                    // most of the row's life. axe flags that under
                    // `aria-valid-attr-value`; jsx-a11y does not, which is why
                    // lint stayed green on it.
                    aria-controls={expanded ? diffPanelId(write) : undefined}
                    onClick={() => toggle(write)}
                    data-testid={`write-toggle-${write.kind}-${write.name}-${write.version_number}`}
                  >
                    {/* Spans, not divs/ps: a <button>'s content model is
                        phrasing content, and flow content inside one lays out
                        inconsistently across browsers. */}
                    <span className="flex flex-wrap items-center gap-2">
                      {expanded ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium">
                        {write.label}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        v{write.version_number}
                        {isHead ? " · current" : ""}
                      </code>
                      {flagged && (
                        // Only an explicit `true` mints this. An absent flag
                        // renders nothing at all — never a "not a loosening"
                        // badge, which would assert a verdict coord did not
                        // give.
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", LOOSENING_BADGE_CLASS)}
                          title="Coord classified this edit as granting or widening authority. It landed rather than waiting for you — your policy-write setting allows that — so it is listed first. Nothing is blocked; this is here to be read."
                          data-testid={`write-loosening-${write.kind}-${write.name}-${write.version_number}`}
                        >
                          Widens authority
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {write.edited_by ?? "unknown author"}
                      {write.edited_by ? (
                        <> ({AUTHOR_CLASS_LABEL[authorClass]})</>
                      ) : null}{" "}
                      · {formatWhen(write.created_at)}
                    </span>
                    {write.change_note && (
                      <span className="block truncate text-xs italic text-muted-foreground">
                        {write.change_note}
                      </span>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    {href && (
                      // Absent ref ⇒ no link. Points into the EXISTING
                      // notifications feed; this route builds no second one.
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                      >
                        <Link
                          href={href}
                          title="Open the notification this write was announced with, and the reasoning its author recorded."
                          data-testid={`write-reasoning-${write.kind}-${write.name}-${write.version_number}`}
                        >
                          <MessageSquareText className="size-4" />
                          Why
                        </Link>
                      </Button>
                    )}

                    {isHead && write.version_number > 1 && (
                      <CoordAdminOnly
                        fallback={<ReadOnlyNotice label="Admin only" />}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={acting}
                          onClick={() => onRevert(write)}
                          title={`Restore the wording from v${write.version_number - 1}`}
                          data-testid={`revert-${write.kind}-${write.name}`}
                        >
                          <Undo2 className="size-4" />
                          Undo
                        </Button>
                      </CoordAdminOnly>
                    )}
                  </div>
                </div>

                {expanded && (
                  <WriteDiff
                    write={write}
                    state={diffFor(write)}
                    // One source for both: the id and the testid ARE the same
                    // string, and building it twice lets a future edit to
                    // `diffPanelId` desync them silently.
                    id={diffPanelId(write)}
                    data-testid={diffPanelId(write)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Said only when the field was actually served. "Nothing on this page
          widens authority" and "this coord build does not classify landed
          writes" are different facts, and the second must never be printed as
          the first. */}
      {classified && visible.length > 0 && flaggedCount === 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="landed-writes-none-flagged"
        >
          None of the writes on this page were classified as widening what
          agents may do.
        </p>
      )}
    </section>
  );
}

/**
 * One row's previous → current diff.
 *
 * Rendering only: both bodies come from the `…/versions/{n}` reads the undo
 * path already makes, and the engine is the console's shared `diffLines`. There
 * is no new endpoint and no second diff implementation.
 */
function WriteDiff({
  write,
  state,
  id,
  "data-testid": testId,
}: {
  write: PromptDocumentWrite;
  state: WriteDiffState | null;
  /** Target of the row button's `aria-controls`. */
  id: string;
  "data-testid"?: string;
}) {
  const diff = useMemo(
    () =>
      state?.status === "ready"
        ? diffLines(state.previous, state.current)
        : null,
    [state]
  );

  if (!state || state.status === "loading") {
    return (
      <p
        id={id}
        className="border-t border-border px-3 py-3 text-xs text-muted-foreground"
        data-testid={testId}
      >
        Loading the text of v{write.version_number}…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        id={id}
        className="border-t border-border px-3 py-3 text-xs text-muted-foreground"
        data-testid={testId}
      >
        {/* An unreadable version is not an empty diff. */}
        Couldn&apos;t read this version&apos;s text: {state.error}. What changed
        is unknown, not nothing.
      </p>
    );
  }

  const previousLabel =
    write.version_number > 1 ? `v${write.version_number - 1}` : "nothing";

  return (
    <div id={id} className="border-t border-border" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/40 px-3 py-2 text-xs">
        <span className="font-medium">
          {previousLabel} → v{write.version_number}
        </span>
        {diff?.stats.identical ? (
          <span className="text-muted-foreground">
            Identical — this version&apos;s text matches the one before it.
          </span>
        ) : (
          <>
            <span className={DIFF_ADDED_COUNT_CLASS}>
              +{diff?.stats.added ?? 0}
            </span>
            <span className={DIFF_REMOVED_COUNT_CLASS}>
              −{diff?.stats.removed ?? 0}
            </span>
            {diff?.stats.truncated && (
              <span className="text-muted-foreground">
                Document too large for a line-by-line diff — showing a full
                replacement.
              </span>
            )}
          </>
        )}
      </div>
      <DiffTable lines={diff?.lines ?? []} className="max-h-72" />
    </div>
  );
}
