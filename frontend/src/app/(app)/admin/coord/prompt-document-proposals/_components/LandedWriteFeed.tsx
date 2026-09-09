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
import { formatWhen, plural } from "../_lib/format";
import {
  AUTHOR_CLASS_LABEL,
  classifyWriteAuthor,
  isAgentAuthored,
  tallyAuthors,
} from "../_lib/authorship";
import {
  LOOSENING_BADGE_CLASS,
  countLooseningVerdicts,
  hasLooseningVerdict,
  isLoosening,
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
 * ## The author filter is the one layer allowed to hide a loosening
 *
 * The backend guarantees the PAYLOAD: its page slice is taken from a partition
 * that lifts classified loosenings above the recency order, so the response
 * carries every loosening among the writes it read — and when its `limited`
 * caveat is set it says exactly that, in the notice box above the rows. The
 * guarantee stops at the wire. This component's agent-authored filter then
 * removes rows from the screen, and a loosening is classified by DIRECTION, not
 * by author, so an `operator:` or unrecognised-label edit that widens what
 * agents may do is flagged and is precisely what the filter drops.
 *
 * So the filter must disclose flagged rows SPECIFICALLY, not only as part of an
 * author count, and the "none of the writes on this page…" line must not be
 * printed while one is hidden. Otherwise the page pairs a server sentence
 * promising every loosening is present with a screen showing none — the
 * absence-as-fact failure this feature exists to prevent, arriving through the
 * only layer with permission to hide a row.
 *
 * ## Every sentence here is scoped to the rows that carry a verdict
 *
 * Coord classifies writes as it rolls out, so a page routinely mixes rows with
 * a verdict and rows without one. A count of the classified rows is therefore
 * not a count of the rows — and a sentence about direction may only name the
 * set it actually has a verdict for. Both statements this component makes ABOUT
 * DIRECTION obey that: the on-screen line names its classified subset and
 * counts the silent
 * remainder, and the hidden-rows note counts hidden loosenings and hidden
 * unclassified rows as two separate facts. The alternative is the failure this
 * whole feature exists to prevent, in its quietest form — an unknown rendered
 * as a reassurance.
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

  // All four derived from `visible`, never one from each set: the "none
  // flagged" line below talks about what is ON SCREEN, and computing any of its
  // preconditions over the unfiltered feed would let a hidden
  // operator-authored loosening license a sentence about the rows the operator
  // can actually see. What the filter hides is stated by the hidden-rows note
  // instead, which is computed over `writes` for exactly that reason.
  /**
   * How many rows on screen coord actually classified, and how many it did not.
   *
   * `classified` used to be the whole story — a single served verdict licensed
   * the "none of the writes on this page…" line over every row, classified or
   * not. That is the backend's own stated failure mode one layer up: a
   * "corpus-wide reassurance drawn from a single classified row"
   * (`_limited_caveat`). Being scoped to the page does not answer it, because
   * the unclassified rows are ON the page — so the sentence has to name the set
   * it is actually about, and count the rest.
   *
   * Mixed classification is not an edge case. It is what the day the classifier
   * deploys looks like, and one document's history can span both states.
   */
  const verdictCount = useMemo(
    () => countLooseningVerdicts(visible),
    [visible]
  );
  const classified = verdictCount > 0;
  /** Rows on screen carrying no verdict either way — never `false`, absent. */
  const silentCount = visible.length - verdictCount;
  const flaggedCount = useMemo(
    () => visible.filter(isLoosening).length,
    [visible]
  );

  /**
   * Flagged rows this filter is hiding — the one thing the hidden-rows note
   * cannot express as an author count.
   *
   * **The backend now GUARANTEES what this filter can quietly undo.** The page
   * slice is taken from a stable partition that lifts classified loosenings
   * above the recency order (`operations.py` `_promote_flagged`), so the
   * response carries every loosening among the writes it read, whatever its
   * age. That guarantee is about the PAYLOAD. This filter then removes rows
   * from the screen, and a loosening is not always agent-authored: coord
   * classifies a write's direction, not its author, so an `operator:` edit that
   * widens what agents may do is flagged and is exactly what the agent filter
   * drops.
   *
   * Without this count the page could print "None of the writes on this page
   * were classified as widening what agents may do" while hiding one — the
   * absence-as-fact failure the whole feature is built to prevent, arriving
   * through the one layer that is allowed to hide rows. The `limited` caveat in
   * the notice box states the server's promise in as many words when it is set,
   * which sharpens the contradiction; it is not a precondition of it. That
   * caveat fires only when more writes were read than `limit` returned, and its
   * no-verdict-anywhere arm deliberately says nothing about direction at all.
   *
   * Counted over `writes` minus the filter, not over `visible`: these are by
   * definition the rows `visible` does not contain.
   *
   * **The `authorFilter` ternary is a cheap path, NOT a guard.** Dropping it
   * would change no rendering: with the filter off `visible === writes`, so a
   * non-agent loosening is on screen and `flaggedCount` already suppresses the
   * line. It is kept because the name says *hidden* and nothing is hidden in
   * that position — and it skips the scan.
   *
   * **Scope, exactly.** `isLoosening` is `=== true`, so this sees hidden rows
   * coord POSITIVELY classified and no others — correct, since absent is not
   * `false`. That leaves the weaker gap beside it, a hidden row whose direction
   * is simply unknown, which `hiddenUnverdicted` below now counts. This term
   * closes the false-claim hole; that one closes the unstated-unknown.
   */
  const hiddenFlagged = useMemo(
    () =>
      authorFilter === "agent"
        ? writes.filter((w) => !isAgentAuthored(w) && isLoosening(w)).length
        : 0,
    [writes, authorFilter]
  );

  /**
   * Hidden rows coord classified in NEITHER direction — the residual
   * `hiddenFlagged` deliberately cannot see.
   *
   * `hiddenFlagged` closes the FALSE-CLAIM hole: a positively classified
   * loosening must never be hidden under a sentence denying one exists. This
   * closes the weaker one beside it. A hidden row with no verdict is not a
   * loosening and is not "not a loosening" — its direction is simply unknown,
   * and until now the only thing on screen that acknowledged it was an author
   * count, which by construction says nothing about direction.
   *
   * That is a smaller gap than the one `hiddenFlagged` closes and it is still
   * the same shape: an unknown that nothing on the page renders as unknown.
   * Stated as its own count rather than folded into the flagged one, because
   * the two are different facts and merging them would make a
   * positively-classified loosening indistinguishable from a row nobody has
   * looked at.
   *
   * Disjoint from `hiddenFlagged` by construction — `isLoosening` requires an
   * explicit `true`, `hasLooseningVerdict` requires `true` or `false` — so the
   * two clauses below never describe the same write twice.
   */
  const hiddenUnverdicted = useMemo(
    () =>
      authorFilter === "agent"
        ? writes.filter((w) => !isAgentAuthored(w) && !hasLooseningVerdict(w))
            .length
        : 0,
    [writes, authorFilter]
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
          {hiddenFlagged > 0 && (
            // Said in the same breath as the author counts, because it is the
            // one fact those counts cannot carry: coord classifies a write's
            // DIRECTION, not its author, so a loosening can sit in any of the
            // three hidden classes. The caveat above may be promising that
            // every loosening this feed read is on the page — true of the
            // payload, and this filter is what makes it untrue of the screen.
            //
            // "That includes N", not "N of them": the antecedent is the hidden
            // SET, whose size is `hiddenByFilter`, and the two counts are
            // independent. At `hiddenByFilter === hiddenFlagged === 1` the
            // partitive reads "One of them" of a set of one; at 2 of 2 it reads
            // as a proper subset of itself. This phrasing is grammatical at
            // every pair of counts, which is what a sentence built from two
            // independent numbers has to be.
            <>
              {" "}
              <strong className="font-medium">
                That includes {plural(hiddenFlagged, "write")} classified as
                widening what agents may do; turn the filter off to read{" "}
                {hiddenFlagged === 1 ? "it" : "them"}.
              </strong>
            </>
          )}
          {hiddenUnverdicted > 0 && (
            // Not emphasised, because it is the weaker fact: an unstated
            // unknown rather than a contradicted claim. Said all the same —
            // the author counts above are the only other thing that mentions
            // these rows, and an author count structurally cannot express
            // direction, so without this clause their direction is disclosed
            // by nothing at all.
            //
            // "It also includes" when the flagged clause printed, "That
            // includes" when it did not: both take the hidden SET as their
            // antecedent, which is the reading that stays grammatical at every
            // pair of counts. Never "N of them" — the hidden set's size is
            // `hiddenByFilter`, an independent number, and at N === that size
            // the partitive reads as a proper subset of itself.
            <>
              {" "}
              {hiddenFlagged > 0 ? "It also includes" : "That includes"}{" "}
              {plural(hiddenUnverdicted, "write")} coord has not classified in
              either direction.
            </>
          )}
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
          the first.

          And said only ABOUT the rows coord classified. One served verdict is
          enough to license this line at all; it is not enough to license it
          over rows that carry none, and during a partial rollout those sit on
          the same page. `silentCount` picks the arm — the unqualified sentence
          when the two sets coincide, the scoped one with the remainder counted
          when they do not.

          And never while the author filter is hiding a flagged row. The three
          preconditions above are all computed over `visible`, which is correct
          for what they each assert — but together they say "no loosening is
          here", and with a loosening one click away that reads as "no loosening
          exists". `hiddenFlagged` is the only term that can see the difference;
          the filter note above states the number instead, which is the fact
          rather than the reassurance. */}
      {classified &&
        visible.length > 0 &&
        flaggedCount === 0 &&
        hiddenFlagged === 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="landed-writes-none-flagged"
        >
          {silentCount === 0 ? (
            // Every row on screen carries a verdict, so the unqualified
            // sentence is earned: the set it names and the set it has licence
            // over are the same set.
            <>
              None of the writes on this page were classified as widening what
              agents may do.
            </>
          ) : (
            // The partially-classified page. Same two-arm shape as the
            // backend's `_limited_caveat`, one scope in: it qualifies to the
            // writes coord classified and counts the silent remainder rather
            // than absorbing it. Without this the sentence above would draw a
            // verdict on every row from as little as one served `false`.
            <>
              None of the {plural(verdictCount, "write")} on this page that
              coord classified is a widening; the other{" "}
              {plural(silentCount, "write")}{" "}
              {silentCount === 1 ? "carries" : "carry"} no verdict either way.
            </>
          )}
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
