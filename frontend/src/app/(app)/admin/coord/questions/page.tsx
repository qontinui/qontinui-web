"use client";

/**
 * /admin/coord/questions — agent question inbox.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 3 (Wave 3a).
 *
 * Three views: pending (default), answered, and the policy-gap queue. The
 * pending list polls every 10s so freshly-posted questions appear without a
 * manual refresh.
 *
 * Endpoints (proxied via `/api/v1/operations/agent-questions/*`):
 *   GET /agent-questions/pending      — pending rows
 *   GET /agent-questions/answered     — recently-answered rows
 *
 * Both backed by coord; both admin-gated.
 *
 * ## Console style (Phase 3 Wave 1)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Agent questions`
 *   wrapper is gone; `coord/layout.tsx` already renders the console title.
 * - **R1** — a `<HealthStrip>` derived from the three lists ALREADY FETCHED
 *   opens the page. A non-empty pending list IS the alarm on this route, so
 *   the strip goes red on it.
 * - **R6** — the shadcn `<Tabs>` became `<FilterTabs>`. `testIdPrefix` is
 *   `coord-questions-tab`, which reproduces `coord-questions-tab-pending` /
 *   `-answered` / `-gaps` byte-for-byte: `admin-coord-questions.spec.ts`
 *   asserts the first two, and they are frozen (D4a).
 * - **R2/R5/D1** — `<QuestionCard>` was a whole-card `<Link>` to
 *   `/admin/coord/questions/[id]`. It is now a one-line `<QuestionRow>` that
 *   expands in place, with the detail route behind an explicit action.
 *
 * `coord-questions-pending-count` moved onto the health strip's pending badge,
 * which is the element that now carries that number. The e2e spec asserts it
 * is visible; it is, above the fold, on the first line of the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  readIsUnknown,
  type HealthStripLevel,
} from "@/components/console";
import {
  QuestionRow,
  type AgentQuestionRow,
} from "@/components/admin/coord/QuestionRow";
import { GapRow } from "@/components/admin/coord/GapRow";
import { isGapQuestion } from "@/components/admin/coord/policy-gap";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;
const ANSWERED_LIMIT = 50;
const GAPS_LIMIT = 200;

type QuestionsTab = "pending" | "answered" | "gaps";

interface QuestionsListResponse {
  questions?: AgentQuestionRow[];
}

/**
 * A 200 whose body we do not recognise is UNKNOWN, not an empty list.
 *
 * `?? []` used to turn any object without a `questions` array into a confident
 * zero — the same `silent-empty-is-unknown` mistake as a swallowed `catch`,
 * with an HTTP 200 in front of it. Throwing routes it into the caller's catch,
 * where it is flagged as unreadable like any other failure.
 */
function extractQuestions(body: unknown): AgentQuestionRow[] {
  if (Array.isArray(body)) return body as AgentQuestionRow[];
  const rows =
    body && typeof body === "object"
      ? (body as QuestionsListResponse).questions
      : undefined;
  if (Array.isArray(rows)) return rows;
  throw new Error(
    "unrecognised agent-questions response: no `questions` array"
  );
}

export default function CoordQuestionsPage() {
  const [pending, setPending] = useState<AgentQuestionRow[]>([]);
  const [answered, setAnswered] = useState<AgentQuestionRow[]>([]);
  const [gaps, setGaps] = useState<AgentQuestionRow[]>([]);
  const [handledGaps, setHandledGaps] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<QuestionsTab>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One flag per list, because a failed read leaves that list at `[]` — the
  // SAME array a successful empty read produces. Everything downstream
  // (`pending.length`, `blockingGaps`, the empty copy, the strip's level) then
  // states the absence as fact. `loading` cannot stand in: `fetchAll` clears it
  // once all three settle, whether they succeeded or not.
  const [answeredError, setAnsweredError] = useState(false);
  const [gapsError, setGapsError] = useState(false);
  // ...and one "has coord ever ANSWERED this read?" flag per list, which is
  // what `readIsUnknown` keys on. The error flags alone cannot separate the
  // three states this page renders — never answered, answered then went dark,
  // answered and current — because a failed read and a confirmed-empty read
  // leave the same `[]` behind. `loading` cannot stand in either: `fetchAll`
  // clears it once all three settle, whether they succeeded or not.
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [answeredLoaded, setAnsweredLoaded] = useState(false);
  const [gapsLoaded, setGapsLoaded] = useState(false);

  // Generation guards — one per read, because all three flags now feed a
  // rendered verdict rather than a banner. Both race directions matter, and
  // they are NOT symmetric:
  //
  //   stale FAILURE lands after a fresh success -> spurious amber. Fails safe.
  //   stale SUCCESS lands after a fresh failure -> `setGapsError(false)` and
  //     the GREEN all-clear repaint on top of a read that is currently
  //     failing. That is the reviewed defect class, re-created in a race
  //     window, and the degraded poll below makes the window ordinary rather
  //     than theoretical.
  //
  // So a resolution from a superseded generation is dropped, in both arms.
  const pendingSeq = useRef(0);
  const answeredSeq = useRef(0);
  const gapsSeq = useRef(0);

  const fetchPending = useCallback(async () => {
    const seq = ++pendingSeq.current;
    try {
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/pending`
      );
      if (seq !== pendingSeq.current) return;
      setPending(extractQuestions(body));
      setError(null);
      setPendingLoaded(true);
    } catch (e) {
      if (seq !== pendingSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const fetchAnswered = useCallback(async () => {
    const seq = ++answeredSeq.current;
    try {
      // The answered endpoint may not be wired yet on every coord build;
      // any failure (incl. 404/501) is tolerated by the catch below, which
      // leaves the answered list empty so the pending tab still works.
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/answered?limit=${ANSWERED_LIMIT}`
      );
      if (seq !== answeredSeq.current) return;
      setAnswered(extractQuestions(body));
      setAnsweredError(false);
      setAnsweredLoaded(true);
    } catch (e) {
      if (seq !== answeredSeq.current) return;
      // Don't clobber a pending-tab error; the pending tab is the load-bearing
      // view and stays usable. But tolerating the failure is not the same as
      // ASSERTING an empty answered list, so flag it: `answered 0` and "No
      // recently-answered questions." are claims about coord, not about us.
      console.warn("[coord/questions] fetchAnswered failed", e);
      setAnsweredError(true);
    }
  }, []);

  // Gaps span both inboxes: blocking gaps are pending (unanswered), non-blocking
  // gaps are pre-answered. We pass `gap=true` as a coord-side hint AND
  // defensively client-filter on the POLICY_GAP marker, so the tab is correct
  // even during the window where coord's `gap` SQL filter isn't yet deployed.
  const fetchGaps = useCallback(async () => {
    const seq = ++gapsSeq.current;
    try {
      const [pendingBody, answeredBody] = await Promise.all([
        httpClient.get<unknown>(`${API}/agent-questions/pending?gap=true`),
        httpClient.get<unknown>(
          `${API}/agent-questions/answered?gap=true&limit=${GAPS_LIMIT}`
        ),
      ]);
      const merged = [
        ...extractQuestions(pendingBody),
        ...extractQuestions(answeredBody),
      ]
        .filter(isGapQuestion)
        .sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? "")
        );
      if (seq !== gapsSeq.current) return;
      setGaps(merged);
      setGapsError(false);
      setGapsLoaded(true);
    } catch (e) {
      if (seq !== gapsSeq.current) return;
      // The worst of the three to swallow: `gaps` at `[]` makes
      // `blockingGaps` 0, which is what turns the strip GREEN under the
      // headline "No agent is waiting on an answer". A read that never
      // happened must never produce the all-clear.
      console.warn("[coord/questions] fetchGaps failed", e);
      setGapsError(true);
    }
  }, []);

  /**
   * `fetchAll` needs its own generation for the same reason its three legs do.
   *
   * The refresh button calls it directly, so a click during the first load
   * runs two `fetchAll`s at once. The superseded one's three reads are each
   * dropped by their `*Seq` guard — leaving every `*Loaded` flag false — and
   * then it clears `loading` anyway, which is exactly the `neverAnswered`
   * state: all three lists render the red "could not be read" for reads that
   * merely got overtaken, attributing to coord a discard that was ours.
   * Skeletons are the honest rendering there, and keeping `loading` true is
   * what produces them.
   */
  const allSeq = useRef(0);

  const fetchAll = useCallback(async () => {
    const seq = ++allSeq.current;
    await Promise.all([fetchPending(), fetchAnswered(), fetchGaps()]);
    if (seq !== allSeq.current) return;
    setLoading(false);
  }, [fetchPending, fetchAnswered, fetchGaps]);

  // Gaps handled this session are hidden immediately; a refetch reconciles.
  const visibleGaps = useMemo(
    () => gaps.filter((g) => !handledGaps.has(g.question_id)),
    [gaps, handledGaps]
  );
  const onGapHandled = useCallback((questionId: string) => {
    setHandledGaps((prev) => new Set(prev).add(questionId));
  }, []);

  // `gapsError` is cleared only by a full read, and only `fetchPending` is
  // polled — so without this a single transient gap failure would pin the page
  // at "could not read the gaps inbox" until someone pressed refresh, while
  // pending re-read happily every 10s. A degraded page has to heal itself.
  //
  // `answeredError` is deliberately NOT in here. It drives no verdict — the
  // strip level and headline are decided by pending + gaps alone — and
  // `fetchAnswered`'s own comment above preserves tolerance for coord builds
  // where `/answered` is not wired at all. On such a build the flag is
  // permanently true, so including it would pin this page at 4x the read
  // volume forever with no path back to the cheap poll. Its badge stays
  // dashed, which is the honest rendering, and a refresh re-reads it.
  const degraded = useRef(false);
  const pollInFlight = useRef(false);
  useEffect(() => {
    // Written in an effect, not the render body: a concurrent render that
    // React throws away must not leave its value behind in a ref.
    degraded.current = error !== null || gapsError;
  }, [error, gapsError]);

  useEffect(() => {
    setLoading(true);
    // The FIRST load holds the poll lock too. Without this a tick 10s in
    // supersedes the initial reads, whose resolutions are then dropped by the
    // seq guards while `fetchAll` clears `loading` anyway — the fourth state
    // above, arrived at on an ordinary slow first load rather than a race.
    pollInFlight.current = true;
    void fetchAll().finally(() => {
      pollInFlight.current = false;
    });
    // Poll the pending list; the answered list is operator-driven and doesn't
    // need 10s churn — EXCEPT while a verdict-bearing read is unread, when the
    // whole point of the poll is to find out that it no longer is.
    const id = setInterval(() => {
      // A degraded tick is 4 logical reads, and `httpClient` retries a 5xx
      // three times with 1/2/4s backoff — comfortably longer than the 10s
      // interval. Without this guard the ticks overlap, which is exactly what
      // turns the generation races above from theoretical into routine.
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      const run = degraded.current ? fetchAll() : fetchPending();
      void run.finally(() => {
        pollInFlight.current = false;
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll, fetchPending]);

  const blockingGaps = visibleGaps.filter((g) => !g.responded_at).length;
  // UNKNOWN is "coord has never answered this read", and it is keyed on the
  // per-list `loaded` flag rather than on the list being empty — the shared
  // `readIsUnknown` predicate, which this page previously hand-spelled four
  // times in its older `readFailed && count === 0` form.
  //
  // That older spelling was written before there was a `loaded` flag, and its
  // stated reason — "the zero would otherwise be a claim about coord" — is
  // exactly what the flag now settles: once coord has answered, the zero IS
  // coord's claim. Keeping the count-keyed form has two costs the flag
  // removes. It FLICKERS: a genuinely-empty inbox plus one blipped poll flips
  // the page from "No pending questions" to "could not be read" and back on
  // the next tick, off no new information. And it is inconsistent with the
  // stale arm below — a retained count of 7 is kept and labelled old, while a
  // retained count of 0 is thrown away and called unknown, though both are
  // equally fetched.
  //
  // With `loaded` doing the work, the gaps tab and the gaps badge no longer
  // need separate predicates: the two used to diverge only because each was
  // keyed on its own rendered count, and "did the gap read land?" is one
  // question for both.
  //
  // There is a FOURTH state, and it is the one that reaches the all-clear:
  // a read whose resolution the seq guard DROPPED sets neither flag, while
  // `fetchAll` clears `loading` regardless. So a list can be "not loading",
  // carry no error, and still have heard nothing — `[]`, green, "No agent is
  // waiting on an answer", off a read that never landed. Reachable on the
  // first load alone: the initial `fetchAll` did not hold `pollInFlight`, so a
  // tick could supersede its own reads (that hole is closed below too).
  //
  // It is unknown for the same reason a failure is — there is no answer — so
  // it joins the same predicate rather than growing a fifth rendering. Named
  // separately from `readIsUnknown` because the cause is OURS (we discarded
  // the resolution), not coord's.
  const neverAnswered = (loadedFlag: boolean) => !loading && !loadedFlag;
  const pendingUnknown =
    readIsUnknown(pendingLoaded, error !== null) || neverAnswered(pendingLoaded);
  const answeredUnknown =
    readIsUnknown(answeredLoaded, answeredError) ||
    neverAnswered(answeredLoaded);
  const gapsUnknown =
    readIsUnknown(gapsLoaded, gapsError) || neverAnswered(gapsLoaded);

  // STALE is the other half, and it is the half this page never had: a read
  // that failed AFTER coord had answered. The counts are real measurements
  // going out of date, so they are kept and labelled — never dashed, and never
  // presented as current.
  const pendingStale = error !== null && !pendingUnknown;
  const answeredStale = answeredError && !answeredUnknown;
  const gapsStale = gapsError && !gapsUnknown;

  // "Is an agent waiting?" — the question the strip answers — is decided by
  // pending + gaps ALONE. The answered list is a read-only audit view, and
  // `fetchAnswered`'s own comment notes the endpoint may not be wired on every
  // coord build: letting it drive the level would leave such a build
  // permanently amber with the all-clear permanently hidden, which trains
  // operators to ignore amber and erodes the signal this whole change protects.
  const waitingUnreadable = [
    pendingUnknown ? "pending" : null,
    gapsUnknown ? "gaps" : null,
  ].filter(Boolean);
  const allUnreadable = [
    ...waitingUnreadable,
    answeredUnknown ? "answered" : null,
  ].filter(Boolean);
  const waitingUnknown = waitingUnreadable.length > 0;
  const anyUnknown = allUnreadable.length > 0;
  // A read that failed but left an answer behind: not fabricated, but not
  // fresh either, and otherwise its only trace is a `console.warn`. Named, like
  // the unknown ones — "something is stale" sends an operator hunting.
  //
  // The two lists are DISJOINT now (a read is either unknown or stale, never
  // both), so the detail line below can report each without one hiding the
  // other, which the previous `anyStale && !anyUnknown` form could not do.
  const waitingStaleNames = [
    pendingStale ? "pending" : null,
    gapsStale ? "gaps" : null,
  ].filter(Boolean);
  const staleNames = [
    ...waitingStaleNames,
    answeredStale ? "answered" : null,
  ].filter(Boolean);
  const waitingStale = waitingStaleNames.length > 0;
  const anyStale = staleNames.length > 0;
  const inboxWord = (n: number) => (n === 1 ? "inbox" : "inboxes");

  // R1 — derived from the three lists already on the page, never a second
  // fetch. `loading` is what makes a count UNKNOWN rather than zero.
  //
  // A failed read does the same thing and must be treated the same way. The
  // green arm is the dangerous one: it is reached by `pending.length === 0 &&
  // blockingGaps === 0`, both of which are what an EMPTY list produces — and a
  // failed fetch leaves exactly that. Without this guard, coord going dark
  // renders as "No agent is waiting on an answer", which is the one sentence
  // that tells an operator to stop looking at this page.
  //
  // STALE disqualifies the all-clear exactly as UNKNOWN does, and this is the
  // one place the two must NOT be told apart. The counts differ — unknown
  // dashes them, stale keeps them — but the green dot is a claim about NOW,
  // and the last good read is not now. A verdict may only be painted green off
  // a read that both landed and is current.
  const waitingNotCurrent = waitingUnknown || waitingStale;
  const level: HealthStripLevel =
    loading || (waitingNotCurrent && pending.length === 0 && blockingGaps === 0)
      ? "amber"
      : pending.length > 0
        ? "red"
        : blockingGaps > 0
          ? "amber"
          : "green";
  // When something loud is ALSO true, the unknown arm below is unreachable —
  // so it rides along on the loud headline instead of being dropped. The
  // headline is the surface an operator reads first, and "2 policy gaps still
  // blocking" with no hint that the pending inbox went unread understates what
  // is actually not known.
  // BOTH clauses, when both apply — the same correction the detail line gets
  // below. A ternary here would drop the stale one whenever anything was
  // unknown, and the number the headline is built from can be the stale one:
  // "2 policy gaps still blocking (pending unread)" says nothing about the 2
  // itself being a reading nobody has refreshed.
  const notCurrentClauses = [
    waitingUnknown ? `${waitingUnreadable.join(" and ")} unread` : null,
    waitingStale ? `${waitingStaleNames.join(" and ")} not refreshed` : null,
  ].filter(Boolean);
  const alsoNotCurrent = notCurrentClauses.length
    ? ` (${notCurrentClauses.join("; ")})`
    : "";
  const headline = loading
    ? "Waiting for coord…"
    : pending.length > 0
      ? `${pending.length} agent${
          pending.length === 1 ? " is" : "s are"
        } stopped waiting on you${alsoNotCurrent}`
      : blockingGaps > 0
        ? `${blockingGaps} policy gap${
            blockingGaps === 1 ? "" : "s"
          } still blocking${alsoNotCurrent}`
        : waitingUnknown
          ? // The stale clause rides along here too. Dropping it was the
            // defect corrected in the detail line and in `alsoNotCurrent`,
            // and this arm is the third place it could have been left behind.
            `Could not read the ${waitingUnreadable.join(" and ")} ${inboxWord(
              waitingUnreadable.length
            )} — unknown, not clear${
              waitingStale
                ? `; ${waitingStaleNames.join(" and ")} not refreshed`
                : ""
            }`
          : waitingStale
            ? // Not a verdict, and deliberately not a claim about the last
              // good read either. The obvious phrasing — "nothing was waiting
              // at the last good read" — names a moment and then says
              // something that can be false about it: `blockingGaps` counts
              // `visibleGaps`, which `handledGaps` filters optimistically, so
              // after the operator clears the last blocking gap the sentence
              // reports that read PLUS this session's own edit. The gaps
              // `empty=` copy dodges the same trap the same way. What is left
              // is the only thing the page actually knows: which reads have
              // not come back, and that this is therefore not an all-clear.
              `The ${waitingStaleNames.join(" and ")} ${inboxWord(
                waitingStaleNames.length
              )} ${
                waitingStaleNames.length === 1 ? "has" : "have"
              } not refreshed since the last good read — not clear, just not re-read`
            : "No agent is waiting on an answer";

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-questions-page">
      <HealthStrip
        level={level}
        headline={headline}
        detail={
          loading
            ? "counts appear once the inbox arrives"
            : anyUnknown || anyStale
              ? // Both clauses, when both apply. The previous form dropped the
                // stale one entirely whenever anything was unknown, so a page
                // with an unread pending inbox said nothing at all about a
                // gaps count that had quietly gone out of date.
                [
                  anyUnknown
                    ? `coord did not answer for: ${allUnreadable.join(
                        ", "
                      )}. Those counts are unknown — a dash, not a zero.`
                    : null,
                  anyStale
                    ? `Last refresh failed for: ${staleNames.join(
                        ", "
                      )}. Those counts are the last ones that landed, not current.`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "an unanswered question is an agent that has stopped — nothing else clears it"
        }
        badges={[
          {
            key: "pending",
            // The frozen `coord-questions-pending-count` testid
            // (`admin-coord-questions.spec.ts`) rides the badge that now
            // carries that number.
            "data-testid": "coord-questions-pending-count",
            // A dash for a read that failed, exactly as for one still in
            // flight: `pending.length` is 0 in both cases and means nothing in
            // either.
            label: (
              <>{loading || pendingUnknown ? "–" : pending.length} pending</>
            ),
            tone: !loading && pending.length > 0 ? "attention" : "muted",
            onClick: () => setTab("pending"),
            title: pendingUnknown
              ? "the pending inbox could not be read — count unknown"
              : "show the pending inbox",
          },
          {
            key: "gaps",
            label: <>gaps {loading || gapsUnknown ? "–" : blockingGaps}</>,
            tone: !loading && blockingGaps > 0 ? "attention" : "muted",
            onClick: () => setTab("gaps"),
            title: gapsUnknown
              ? "the gap inbox could not be read — count unknown"
              : "policy gaps still blocking an agent",
          },
          {
            key: "answered",
            label: (
              <>answered {loading || answeredUnknown ? "–" : answered.length}</>
            ),
            tone: "muted",
          },
        ]}
        data-testid="coord-questions-health"
      />

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <div
        className="flex items-center gap-1.5 flex-wrap"
        data-testid="coord-questions-tabs"
      >
        <FilterTabs<QuestionsTab>
          tabs={[
            // `count` is `null` while the first fetch is in flight, which
            // `<FilterTabs>` renders as `–`. A `0` here would claim we looked.
            // A FAILED fetch is the same claim with the same evidence — none —
            // so it takes the same `null`.
            {
              id: "pending",
              label: "Pending",
              count: loading || pendingUnknown ? null : pending.length,
              attention: !loading && pending.length > 0,
            },
            {
              id: "answered",
              label: "Answered",
              count: loading || answeredUnknown ? null : answered.length,
            },
            {
              id: "gaps",
              label: "Gaps",
              count: loading || gapsUnknown ? null : visibleGaps.length,
              attention: !loading && blockingGaps > 0,
            },
          ]}
          active={tab}
          onChange={setTab}
          testIdPrefix="coord-questions-tab"
          className="flex items-center gap-1.5 flex-wrap"
        />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={fetchAll}
          data-testid="coord-questions-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {tab === "pending" && (
        <div data-testid="coord-questions-pending-list">
          <RecordList
            items={pending}
            itemKey={(q) => q.question_id}
            loaded={!loading}
            skeletonRows={5}
            empty={
              // The empty slot is where the absence claim is actually made, so
              // it is the last place a read that did not land has to reach —
              // and `items` is `[]` in all THREE states, so only the flags can
              // tell them apart.
              //
              // The stale arm is not decoration. Coord answering "none" once
              // and then going dark permanently leaves this slot rendering
              // forever, and the plain copy below is present-tense and
              // unqualified: it would say "No pending questions" for hours
              // after the last read that could support it. The strip says
              // amber above, but this sentence is the one an operator scrolls
              // to, so it carries the timestamp too.
              pendingUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-pending-unreadable"
                >
                  The pending inbox could not be read, so whether an agent is
                  waiting is unknown — not none.
                </p>
              ) : pendingStale ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-pending-stale"
                >
                  No pending questions as of the last good read — this inbox
                  has not refreshed since, so a newer one would not show here.
                </p>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-pending-empty"
                >
                  No pending questions. Agents will queue them here when they
                  need an operator decision.
                </p>
              )
            }
            renderRow={(q, ctx) => (
              <QuestionRow
                question={q}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        </div>
      )}

      {tab === "answered" && (
        <div data-testid="coord-questions-answered-list">
          <RecordList
            items={answered}
            itemKey={(q) => q.question_id}
            loaded={!loading}
            skeletonRows={5}
            empty={
              answeredUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-answered-unreadable"
                >
                  The answered inbox could not be read — this list is unknown,
                  not empty.
                </p>
              ) : answeredStale ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-answered-stale"
                >
                  No recently-answered questions as of the last good read —
                  this list has not refreshed since.
                </p>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-answered-empty"
                >
                  No recently-answered questions.
                </p>
              )
            }
            renderRow={(q, ctx) => (
              <QuestionRow
                question={q}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        </div>
      )}

      {tab === "gaps" && (
        <div data-testid="coord-questions-gaps-list">
          <RecordList
            items={visibleGaps}
            itemKey={(g) => g.question_id}
            loaded={!loading}
            skeletonRows={4}
            empty={
              gapsUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-gaps-unreadable"
                >
                  The gap inbox could not be read. Whether an agent is blocked
                  on a missing policy clause is unknown — this is not an
                  all-clear.
                </p>
              ) : gapsStale ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-gaps-stale"
                >
                  {/* Deliberately does NOT say "no gaps at the last good
                      read": `visibleGaps` is that read MINUS anything handled
                      in this session, so the claim could be false about the
                      read it names. It says what is true — there is nothing
                      to show, and nothing has been re-read. */}
                  Nothing to show here, and the gap inbox has not refreshed
                  since the last good read — so this is not an all-clear.
                </p>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-gaps-empty"
                >
                  No policy gaps reported. Agents queue a gap here when no
                  policy clause covers a decision — accept the proposed clause
                  or dismiss it.
                </p>
              )
            }
            renderRow={(g, ctx) => (
              <GapRow
                question={g}
                onHandled={onGapHandled}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}
