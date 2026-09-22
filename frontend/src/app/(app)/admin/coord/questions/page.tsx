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
 *
 * ## Reachability (plan
 * `2026-09-12-a-correctly-escalated-question-is-unreachable-in-the-operator-inbox`,
 * Phase 2d)
 *
 * The defect this phase closes, measured 2026-09-12: `coord.agent_questions`
 * held ~23,700 pending rows, 23,258 of them `pr_fix` addressed to an AGENT and
 * only ~442 to the operator. This page fetched pending with no `limit`, coord
 * silently capped at 100, and the page read none of the truncation fields coord
 * already sends. The operator saw 100 rows out of 23,700 with nothing saying
 * so, and a correctly-escalated security question sat unanswerable for 10 days.
 *
 * Four things changed, and each is a separate failure the old page had:
 *
 * 1. **The counts are the SERVER's.** `total` (an exact pre-`LIMIT`
 *    `COUNT(*) OVER ()`) drives the badge, the tab count, the strip level and
 *    the headline. `pending.length` is the length of one page and says nothing
 *    about the queue. Where the server reports no `total`, the page length is
 *    the fallback and the badge's tooltip says so.
 * 2. **Truncation is stated.** `coord-questions-pending-truncated` names how
 *    many rows are NOT on this page, rather than leaving a full page
 *    indistinguishable from a complete one.
 * 3. **Pending defaults to `audience=operator`.** The one change the operator
 *    actually feels. `<FilterChips>`' empty selection is the unfiltered state,
 *    so "whole queue" sends no parameter at all.
 * 4. **An offset pager** (`PlanLibraryList`'s shape, against a server `total`),
 *    not a cursor walk — the row an operator cannot find is usually the oldest,
 *    and "Last page" is a jump rather than 470 clicks.
 *
 * **Every request parameter here may be unknown to the DEPLOYED coord/proxy
 * build**, and FastAPI ignores an unknown query parameter rather than
 * rejecting it. So the page degrades on evidence rather than on faith: it reads
 * the echoed `limit` back (`pageSizeHonoured`) and the echoed `offset`
 * (`offsetIgnored`), and says which parameter went nowhere instead of quietly
 * showing the wrong thing. "Deployed" is the load-bearing word — coord's source
 * on `main` may already carry a parameter this box's build does not, so a grep
 * of that source is never grounds for deleting a degrade path here.
 *
 * 5. **A window past the END of the queue is not an empty queue.** coord's
 *    `total` is a `COUNT(*) OVER ()` riding on the rows it returns, so an
 *    offset past the match set returns zero rows and coord OMITS `total`
 *    entirely. Reading that as 0 renders the green all-clear over a queue of
 *    ~23,200 — with the pager and the truncation notice both gone, because
 *    each is gated on the very fields coord withheld, and the offset stuck
 *    where it was so every later poll repaints it. `pendingPastEnd` /
 *    `pastEndClamp` are that state and its recovery.
 *
 * The free-text filter is CLIENT-SIDE over the rows already fetched — there is
 * no server-side search on this route — so every surface that renders a
 * filtered list also states that reach. Silently searching one page of 23,700
 * and reporting nothing would be this same defect wearing a text box.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FilterChips,
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
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
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlight } from "@/components/operations/useSingleFlightPoll";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;
const ANSWERED_LIMIT = 50;
const GAPS_LIMIT = 200;
/**
 * The pending page size. Deliberately WELL BELOW coord's 500 ceiling and below
 * its 100 default, so an `effective_limit` echo that disagrees with it is
 * positive evidence the parameter did not reach coord (see `pageSizeHonoured`).
 */
const PENDING_PAGE_SIZE = 50;

type QuestionsTab = "pending" | "answered" | "gaps";

/**
 * Who a question was addressed to. `coord.agent_questions.audience` — the
 * column that separates the ~442 rows an operator must act on from the ~23,258
 * `pr_fix` rows addressed to an agent.
 */
type QuestionAudience = "operator" | "agent";

interface QuestionsListResponse {
  questions?: AgentQuestionRow[];
}

/**
 * The truncation half of coord's list envelope.
 *
 * ⚠️ The wire names are `total` and `truncated`. `total_matching` and
 * `effective_limit` are coord's INTERNAL SQL alias and Rust field names and are
 * **not** serialized — reading them yields `undefined`, which is how this page
 * came to render 100 rows out of 23,700 with nothing saying so.
 *
 * `total` is an exact pre-`LIMIT` `COUNT(*) OVER ()`, not a bounded probe, so it
 * is rendered as the real number and never hedged to "100+".
 *
 * ⚠️⚠️ **`total` and `truncated` are OMITTED — the KEY ABSENT — when coord
 * could not observe the count**, and that is the single most important fact
 * about this envelope. `COUNT(*) OVER ()` rides on the returned rows, so a
 * window past the end of the match set returns zero rows and therefore no
 * count: coord serves `{questions: [], count: 0, shown: 0, offset: 23650}` with
 * no `total` at all. A `0` there would be a fabrication — and this page turns a
 * pending `0` into the green all-clear, "No agent is waiting on an answer",
 * with ~23,200 rows still pending. `total: 0` is a genuine zero ONLY at
 * `offset === 0`. See `pendingPastEnd` below, which is the state that renders
 * that window honestly.
 *
 * `count`, `limit`, `shown` and `offset` are ALWAYS present on a modern build.
 * `offset` is the echo `offsetIgnored` keys on: a build that honours the
 * parameter echoes it back, one that does not omits it.
 *
 * Every field is `null` when the server did not send it — a build that predates
 * these fields is UNKNOWN about its own truncation, not a confirmed "nothing was
 * dropped".
 */
interface QuestionsMeta {
  total: number | null;
  truncated: boolean | null;
  limit: number | null;
  shown: number | null;
  offset: number | null;
}

const UNREPORTED_META: QuestionsMeta = {
  total: null,
  truncated: null,
  limit: null,
  shown: null,
  offset: null,
};

/**
 * Do matching rows exist BEYOND the window we were handed?
 *
 * Three rungs, in descending order of authority:
 *
 * 1. **Coord's own `truncated`**, which is already offset-aware server-side
 *    (`total > effective_offset + shown`). Preferring it is the whole of
 *    finding 2: the previous form consulted it only when `total` was null —
 *    i.e. never against a modern build — so the server's correct answer was
 *    fetched and discarded, and the LAST page of a walk rendered *"23,650 are
 *    not on this page"* under a heading that reads "more remain".
 * 2. **`total` against `offset + onPage`.** The `offset` term is the one the
 *    old spelling was missing; without it "has more" stays true forever once
 *    the queue is larger than a page, no matter how far the operator has
 *    walked.
 * 3. **Neither reported** — UNKNOWN, and `false` here says only "nothing to
 *    announce". It is safe because it never renders an all-clear: the
 *    truncation notice is an ADDITION to the list, not a claim about it.
 */
function hasMoreBeyond(
  meta: QuestionsMeta,
  offset: number,
  onPage: number
): boolean {
  if (meta.truncated !== null) return meta.truncated;
  if (meta.total !== null) return meta.total > offset + onPage;
  return false;
}

/** Was this window cut short? `hasMoreBeyond` against the envelope's own echo. */
function metaHasMore(meta: QuestionsMeta, onPage: number): boolean {
  return hasMoreBeyond(meta, meta.offset ?? 0, onPage);
}

/**
 * The gap tab's two legs — it unions `pending?gap=true` with
 * `answered?gap=true`, so it has TWO envelopes and two page lengths. The row
 * counts travel alongside the envelopes because the merged list is filtered on
 * the POLICY_GAP marker, so `visibleGaps.length` cannot stand in for either
 * leg's page length.
 */
interface GapsMeta {
  pending: QuestionsMeta;
  answered: QuestionsMeta;
  pendingOnPage: number;
  answeredOnPage: number;
}

const UNREPORTED_GAPS_META: GapsMeta = {
  pending: UNREPORTED_META,
  answered: UNREPORTED_META,
  pendingOnPage: 0,
  answeredOnPage: 0,
};

/** Thousands separators without an ICU dependency — 23700 -> "23,700". */
function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * A row's `audience`, read defensively off the wire.
 *
 * The column exists in `coord.agent_questions` and rides the row, but
 * `AgentQuestionRow` (`components/admin/coord/questionStatus.ts`) does not
 * declare it and that file is being rewritten by an open PR — so this reads the
 * field rather than widening a type someone else owns. `null` is "this build
 * does not send it", which is UNKNOWN and never "no audience".
 */
function rowAudience(q: AgentQuestionRow): string | null {
  const v = (q as unknown as Record<string, unknown>).audience;
  return typeof v === "string" && v ? v : null;
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

/**
 * The rows AND what the server said about how many it left out.
 *
 * Throws on an unrecognised body for the same reason `extractQuestions` does —
 * the meta fields are optional, the `questions` array is not.
 */
function extractMeta(body: unknown): QuestionsMeta {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return UNREPORTED_META;
  }
  const env = body as Record<string, unknown>;
  return {
    total: numberOrNull(env.total),
    truncated: typeof env.truncated === "boolean" ? env.truncated : null,
    limit: numberOrNull(env.limit),
    shown: numberOrNull(env.shown),
    offset: numberOrNull(env.offset),
  };
}

/**
 * The pending URL.
 *
 * Every parameter here is one a coord/proxy build may not know. An unknown
 * query parameter is IGNORED by FastAPI rather than rejected, so the degraded
 * outcome is "the filter did not apply", never a 422 — which is why the page
 * reads the envelope back (`pageSizeHonoured`, `offsetIgnored`) instead of
 * assuming its request was obeyed.
 */
function pendingUrl(offset: number, audience: QuestionAudience | null): string {
  const params = new URLSearchParams();
  params.set("limit", String(PENDING_PAGE_SIZE));
  if (offset > 0) params.set("offset", String(offset));
  if (audience) params.set("audience", audience);
  return `${API}/agent-questions/pending?${params.toString()}`;
}

export default function CoordQuestionsPage() {
  const [pending, setPending] = useState<AgentQuestionRow[]>([]);
  const [answered, setAnswered] = useState<AgentQuestionRow[]>([]);
  const [gaps, setGaps] = useState<AgentQuestionRow[]>([]);
  const [handledGaps, setHandledGaps] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<QuestionsTab>("pending");
  // What the server said about the rows it did NOT return. Separate from the
  // row arrays because a failed read must leave the LAST reported meta alone
  // for exactly the same reason it leaves the last rows alone: a dropped read
  // is not a report of "nothing was truncated".
  const [pendingMeta, setPendingMeta] =
    useState<QuestionsMeta>(UNREPORTED_META);
  const [answeredMeta, setAnsweredMeta] =
    useState<QuestionsMeta>(UNREPORTED_META);
  // The gap tab's two legs, each with its own envelope. Pre-existing gap: this
  // read was issued with no `limit` at all, so it took coord's default of 100
  // and the tab said NOTHING about it — while `blockingGaps` off that page
  // drives the strip level and the "N policy gaps still blocking" headline.
  // That is the one count left on this page that was silently a page length,
  // in the file whose whole purpose is retiring exactly that.
  const [gapsMeta, setGapsMeta] = useState<GapsMeta>(UNREPORTED_GAPS_META);
  // Pending paging + filters. `audience` defaults to `operator`: of the ~23,700
  // pending rows measured 2026-09-12, 23,258 were `pr_fix` questions addressed
  // to an AGENT and only ~442 to the operator. The default is the whole point
  // of this change — the operator's own queue is two orders of magnitude
  // smaller than the one this page used to show the first 100 of.
  const [pendingOffset, setPendingOffset] = useState(0);
  const [audience, setAudience] = useState<QuestionAudience | null>("operator");
  const [query, setQuery] = useState("");
  // Set when a read does not echo back the `offset` it was asked for — see
  // `fetchPending`.
  const [offsetIgnored, setOffsetIgnored] = useState(false);
  // Set when a read filtered to one audience comes back carrying rows addressed
  // to another. The DEPLOYED coord may predate the sibling change that taught
  // `PendingQuery` to parse `audience`, and serde drops an unknown key rather
  // than refusing it — so a 200 is NOT evidence the filter applied, and this is
  // the only thing on the page that can tell the operator it did not. Do not
  // delete this on the strength of a grep of coord's SOURCE: what governs is
  // the build answering this box, and that lags main.
  const [audienceIgnored, setAudienceIgnored] = useState(false);
  // ---------------------------------------------------------------------
  // The window past the end of the queue. TWO states, because they have
  // different lifetimes and different jobs.
  //
  // `pendingPastEnd` is the LIVE verdict: the offset of a read that LANDED and
  // proved its own window sits past the end of the match set — zero rows AND no
  // `total`, which coord omits precisely because `COUNT(*) OVER ()` rides on
  // rows it did not return. The pending count is then UNKNOWN, and nothing on
  // this page may render the all-clear off it. Cleared by the next read that
  // lands anywhere else.
  //
  // The failure it closes, measured shape: the operator pages to offset 23,200
  // of 23,258, agents answer 58 rows, and the next 10s poll returns an empty
  // window. `total` collapses to absent, `pendingCount` to 0, the strip to
  // green and the headline to "No agent is waiting on an answer" with ~23,200
  // still pending. The read SUCCEEDED, so neither `pendingUnknown` nor
  // `pendingStale` covers it — it needs its own state, and this is it.
  //
  // `pastEndClamp` is the RECOVERY RECORD: the offset we bounced off, kept
  // until the operator navigates again. `fetchPending` clamps back to offset 0
  // and re-reads on the spot, which clears the live verdict within one
  // round-trip — so without this the self-healing would be invisible and the
  // operator would see the queue snap back to page 1 with no explanation.
  const [pendingPastEnd, setPendingPastEnd] = useState<number | null>(null);
  const [pastEndClamp, setPastEndClamp] = useState<number | null>(null);
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

  // The current offset/audience reach `fetchPending` through refs rather than
  // through its dependency list. Keeping its identity stable is load-bearing:
  // it is a dependency of the poll, so a closed-over `pendingOffset` would tear
  // the poll down and rebuild it on every page change.
  //
  // Written in an effect, not the render body, for the same reason `degraded`
  // is below — a concurrent render React throws away must not leave its value
  // behind in a ref.
  const pendingOffsetRef = useRef(0);
  const audienceRef = useRef<QuestionAudience | null>("operator");
  // Whether the read that triggered a past-end clamp was itself a polled one,
  // so the clamp's follow-up inherits the same retry posture (see the clamp).
  const clampWasPolled = useRef(false);
  // How many pending reads are on the wire. `fetchAll`'s `allSeq` keeps
  // `loading` true for a superseded FULL read, but it cannot see a superseded
  // LEG: an operator who changes the audience while the first full read is
  // still in flight bumps `pendingSeq`, the full read's pending leg returns
  // early without ever setting `pendingLoaded`, and `loading` clears anyway —
  // rendering "the pending inbox could not be read" over a read that is simply
  // still outstanding. That is the same sin as the count this page exists to
  // fix: reporting UNKNOWN as a verdict. While one is in flight we do not know.
  const pendingOutstanding = useRef(0);

  // `polled` is true for reads the timer issues: exactly one request each
  // (`COORD_DASHBOARD_POLL_OPTIONS`). A read an operator's click issues keeps
  // the client's default retries.
  const fetchPending = useCallback(async (polled = false) => {
    const seq = ++pendingSeq.current;
    const offset = pendingOffsetRef.current;
    pendingOutstanding.current += 1;
    try {
      const body = await httpClient.get<unknown>(
        pendingUrl(offset, audienceRef.current),
        polled ? COORD_DASHBOARD_POLL_OPTIONS : undefined
      );
      if (seq !== pendingSeq.current) return;
      const rows = extractQuestions(body);
      const meta = extractMeta(body);
      setPending(rows);
      setPendingMeta(meta);
      // `offset` is ECHOED by every build that honours it — coord's envelope
      // always carries it — so an absent or disagreeing echo at a non-zero
      // requested offset IS the witness, read off this one response.
      //
      // The first-row-id heuristic this replaced raced in BOTH directions on
      // the ordinary 10s poll. FALSE POSITIVE: the offset was honoured, but the
      // top rows got answered, so page 2 legitimately begins at page 1's old
      // first id and a red "paging is not working" banner appeared wrongly.
      // FALSE NEGATIVE: the offset was ignored, but a new question arrived, so
      // the ids differed, the warning was suppressed, and page 2 silently
      // equalled page 1. The echo has neither race and costs nothing.
      setOffsetIgnored(offset > 0 && meta.offset !== offset);
      // A window past the END of the match set, which is NOT an empty queue.
      // Coord's `total` is a `COUNT(*) OVER ()` riding on the returned rows, so
      // zero rows means no row carried the count and the key is OMITTED. Zero
      // rows + no total at a non-zero offset is exactly that window, and the
      // read succeeded — so `pendingUnknown` and `pendingStale` are both false
      // and only this flag stands between it and the green all-clear.
      const pastEnd = offset > 0 && rows.length === 0 && meta.total === null;
      setPendingPastEnd(pastEnd ? offset : null);
      if (pastEnd) {
        // Clamp back and re-read, so the operator gets a REAL total on the very
        // next round-trip rather than being stranded: the pager is gated on a
        // known total and the truncation notice on a known `truncated`, so both
        // vanish in this state and `pendingOffset` would otherwise stay put,
        // every later poll repainting the same window. The re-read is issued by
        // the paging effect, which watches `pendingOffset`.
        //
        // Carry THIS read's `polled` into that re-read. Without it a clamp the
        // TIMER triggered issued its follow-up with `polled` defaulting to
        // false, so it took the client's full retry chain (5 requests, ~7s of
        // backoff) and was not held by the single-flight latch — the exact
        // multiplication `COORD_DASHBOARD_POLL_OPTIONS` exists to remove, on a
        // path whose own invariant is "`polled` is true for reads the timer
        // issues". An operator's click still clamps with retries, unchanged.
        clampWasPolled.current = polled;
        setPastEndClamp(offset);
        setPendingOffset(0);
      }
      // Positive evidence only: a row whose audience DISAGREES with the one we
      // asked for proves the filter did not apply. Rows that carry no audience
      // at all prove nothing either way, so the flag is left where it was.
      const wanted = audienceRef.current;
      if (wanted) {
        const seen = rows
          .map(rowAudience)
          .filter((a): a is string => a !== null);
        if (seen.length > 0) setAudienceIgnored(seen.some((a) => a !== wanted));
      } else {
        setAudienceIgnored(false);
      }
      setError(null);
      setPendingLoaded(true);
    } catch (e) {
      if (seq !== pendingSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pendingOutstanding.current -= 1;
    }
  }, []);

  const fetchAnswered = useCallback(async (polled = false) => {
    const seq = ++answeredSeq.current;
    try {
      // The answered endpoint may not be wired yet on every coord build;
      // any failure (incl. 404/501) is tolerated by the catch below, which
      // leaves the answered list empty so the pending tab still works.
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/answered?limit=${ANSWERED_LIMIT}`,
        polled ? COORD_DASHBOARD_POLL_OPTIONS : undefined
      );
      if (seq !== answeredSeq.current) return;
      setAnswered(extractQuestions(body));
      setAnsweredMeta(extractMeta(body));
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
  const fetchGaps = useCallback(async (polled = false) => {
    const seq = ++gapsSeq.current;
    const options = polled ? COORD_DASHBOARD_POLL_OPTIONS : undefined;
    try {
      const [pendingBody, answeredBody] = await Promise.all([
        // The pending leg carries an EXPLICIT limit now. It used to carry
        // none, so coord applied its default of 100 and the tab rendered that
        // page length as `blockingGaps` — the number behind the strip's amber
        // and the "N policy gaps still blocking" headline — with nothing
        // saying it was a page. No `audience` here is deliberate and not an
        // oversight: a policy gap blocks whoever hit it, so narrowing the gap
        // queue to one audience would hide gaps rather than sort them.
        httpClient.get<unknown>(
          `${API}/agent-questions/pending?gap=true&limit=${GAPS_LIMIT}`,
          options
        ),
        httpClient.get<unknown>(
          `${API}/agent-questions/answered?gap=true&limit=${GAPS_LIMIT}`,
          options
        ),
      ]);
      const pendingGapRows = extractQuestions(pendingBody);
      const answeredGapRows = extractQuestions(answeredBody);
      const merged = [...pendingGapRows, ...answeredGapRows]
        .filter(isGapQuestion)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      if (seq !== gapsSeq.current) return;
      setGaps(merged);
      setGapsMeta({
        pending: extractMeta(pendingBody),
        answered: extractMeta(answeredBody),
        // The RAW leg lengths, before the POLICY_GAP filter above. They are
        // what coord's `truncated`/`total` are about; `visibleGaps.length` is a
        // filtered subset of both legs and would understate the window.
        pendingOnPage: pendingGapRows.length,
        answeredOnPage: answeredGapRows.length,
      });
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

  const fetchAll = useCallback(
    async (polled = false) => {
      const seq = ++allSeq.current;
      await Promise.all([
        fetchPending(polled),
        fetchAnswered(polled),
        fetchGaps(polled),
      ]);
      if (seq !== allSeq.current) return;
      setLoading(false);
    },
    [fetchPending, fetchAnswered, fetchGaps]
  );

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
  useEffect(() => {
    // Written in an effect, not the render body: a concurrent render that
    // React throws away must not leave its value behind in a ref.
    degraded.current = error !== null || gapsError;
  }, [error, gapsError]);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5): a
  // degraded tick is 4 logical reads, so a tick that finds the previous one
  // outstanding is skipped — which is exactly what keeps the generation races
  // above from turning routine — and none of the reads is retried by
  // `httpClient`'s 5xx backoff chain; the next tick is the retry. The FIRST
  // load holds the latch too: a tick 10s in must not supersede the initial
  // reads, whose resolutions the seq guards would then drop while `fetchAll`
  // clears `loading` anyway (the fourth state above).
  const firstReadRef = useRef(true);
  const poll = useCallback(async () => {
    const first = firstReadRef.current;
    firstReadRef.current = false;
    // Poll the pending list; the answered list is operator-driven and doesn't
    // need 10s churn — EXCEPT while a verdict-bearing read is unread, when the
    // whole point of the poll is to find out that it no longer is.
    if (first || degraded.current) await fetchAll(true);
    else await fetchPending(true);
  }, [fetchAll, fetchPending]);
  const { refresh: pollNow, tick: pollTick } = useSingleFlight(poll);

  useEffect(() => {
    setLoading(true);
    firstReadRef.current = true;
    void pollNow();
    const id = setInterval(pollTick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll, pollNow, pollTick]);

  // Paging and the audience filter re-read PENDING only — the answered and gap
  // inboxes are unaffected by either, and re-reading all three would put the
  // whole page back into skeletons to turn one page.
  //
  // Skipped on mount: the effect above already issued the first read, and the
  // refs are initialised to the same defaults this effect would write.
  const pendingParamsSettled = useRef(false);
  useEffect(() => {
    pendingOffsetRef.current = pendingOffset;
    audienceRef.current = audience;
    if (!pendingParamsSettled.current) {
      pendingParamsSettled.current = true;
      return;
    }
    // A clamp inherits the posture of the read that caused it; an operator's
    // own navigation is an unpolled read and keeps the client's retries.
    const inheritedPolled = clampWasPolled.current;
    clampWasPolled.current = false;
    void fetchPending(inheritedPolled);
  }, [pendingOffset, audience, fetchPending]);

  // Every OPERATOR-initiated move of the pending window. It retires the
  // past-end recovery notice, which otherwise persists deliberately — the
  // clamp's own re-read must not clear it (the whole point is that the
  // operator sees why the page snapped back), so only a deliberate navigation
  // does.
  const goToPendingOffset = useCallback((next: number) => {
    setPastEndClamp(null);
    setPendingOffset(next);
  }, []);

  const blockingGaps = visibleGaps.filter((g) => !g.responded_at).length;

  // ---------------------------------------------------------------------
  // What the SERVER says is there, vs what it handed us.
  //
  // `pending.length` is the length of ONE PAGE. Rendering it as the count is
  // the defect this page shipped: 100 rows out of 23,700, indistinguishable
  // from a queue of exactly 100. The badge, the tab count, the headline and
  // the strip level are all keyed on the server's `total` wherever it reports
  // one, and fall back to the page length only when it reports none — which is
  // the most an older build lets us say.
  // ---------------------------------------------------------------------
  const pendingOnPage = pending.length;
  const answeredOnPage = answered.length;
  // Hoisted out of `pendingMeta` so a `!== null` narrowing survives into the
  // pager's click handlers — TypeScript re-widens a narrowed PROPERTY inside a
  // closure, and the alternative is a `!` on the one value this whole change is
  // about.
  const pendingTotal = pendingMeta.total;
  const answeredTotal = answeredMeta.total;
  const pendingCount = pendingTotal ?? pendingOnPage;
  const answeredCount = answeredTotal ?? answeredOnPage;
  // The page size coord actually applied. When it echoes a limit other than the
  // one we asked for, the parameter did not reach it — so the pager arithmetic
  // follows the server rather than our request, and says so.
  const effectivePageSize = pendingMeta.limit ?? PENDING_PAGE_SIZE;
  const pageSizeHonoured =
    pendingMeta.limit === null || pendingMeta.limit === PENDING_PAGE_SIZE;
  // The offset coord ACTUALLY applied — the echo, which is what the range and
  // the truncation arithmetic are about. An older build echoes none, and the
  // value we requested is then the best available reading (`offsetIgnored`
  // says so loudly beside it).
  const pendingEffectiveOffset = pendingMeta.offset ?? pendingOffset;
  const answeredEffectiveOffset = answeredMeta.offset ?? 0;
  // Rows exist that are NOT on this page. Offset-aware in BOTH arms — see
  // `hasMoreBeyond`. The previous form compared `total` against the page length
  // with no offset term at all and consulted coord's own offset-aware
  // `truncated` only when `total` was null, i.e. never against a modern build.
  const pendingHasMore = hasMoreBeyond(
    pendingMeta,
    pendingEffectiveOffset,
    pendingOnPage
  );
  // The answered tab requests no offset today, so its effective offset is 0 —
  // but the form is the offset-aware one anyway, because the identical
  // offset-blind spelling was already sitting here waiting for the first
  // answered pager to make it wrong.
  const answeredHasMore = hasMoreBeyond(
    answeredMeta,
    answeredEffectiveOffset,
    answeredOnPage
  );
  // The range end is the rows we ACTUALLY got, not `offset + pageSize`. Coord
  // may answer a 50-row request with 3 (the last page, or a narrowed filter),
  // and "Showing 1–50" over three rows is the same over-claim in miniature as
  // the one this whole change exists to remove.
  const pendingRangeTo = pendingEffectiveOffset + pendingOnPage;
  const answeredRangeTo = answeredEffectiveOffset + answeredOnPage;
  // The gap tab's own truncation, one verdict per leg. Only the PENDING leg can
  // understate `blockingGaps` — the answered leg's rows are answered by
  // definition — so the "at least" qualifier on the headline keys on that one.
  const gapsPendingHasMore = metaHasMore(
    gapsMeta.pending,
    gapsMeta.pendingOnPage
  );
  const gapsAnsweredHasMore = metaHasMore(
    gapsMeta.answered,
    gapsMeta.answeredOnPage
  );
  const gapsHasMore = gapsPendingHasMore || gapsAnsweredHasMore;

  // Free-text filter. It reaches only the rows ALREADY FETCHED — there is no
  // server-side search on this route — so every surface that shows a filtered
  // list also says the filter's reach out loud. Silently searching one page of
  // 23,700 and finding nothing is the same class of defect as the truncation
  // this change exists to fix.
  const needle = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (q: AgentQuestionRow) => {
      if (!needle) return true;
      return [
        q.question,
        q.agent_id,
        q.agent_session_id,
        q.question_id,
        q.plan_phase,
        q.context,
        q.response,
      ].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
    },
    [needle]
  );
  const shownPending = useMemo(
    () => pending.filter(matchesQuery),
    [pending, matchesQuery]
  );
  const shownAnswered = useMemo(
    () => answered.filter(matchesQuery),
    [answered, matchesQuery]
  );
  const shownGaps = useMemo(
    () => visibleGaps.filter(matchesQuery),
    [visibleGaps, matchesQuery]
  );
  const shownForTab =
    tab === "pending"
      ? shownPending.length
      : tab === "answered"
        ? shownAnswered.length
        : shownGaps.length;
  const onPageForTab =
    tab === "pending"
      ? pendingOnPage
      : tab === "answered"
        ? answeredOnPage
        : visibleGaps.length;
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
    readIsUnknown(pendingLoaded, error !== null) ||
    (neverAnswered(pendingLoaded) && pendingOutstanding.current === 0);
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

  // A THIRD way the pending count can be unknown, and the only one reached by
  // a read that SUCCEEDED: the window sits past the end of the match set, so
  // coord omitted `total` and `pendingCount` fell back to a page length of 0.
  // Every surface that renders the number dashes it here, exactly as it does
  // for a read that never landed — the cause differs, the entitlement to state
  // a count does not.
  const pastEnd = pendingPastEnd !== null;
  const pendingCountUnknown = pendingUnknown || pastEnd;
  // Rides along on whichever headline arm wins, the same way the unread and
  // not-refreshed clauses do. A loud headline ("3 policy gaps still blocking")
  // that says nothing about the pending count being unknown understates what
  // is actually not known.
  const pastEndSuffix = pastEnd
    ? "; the pending count is unknown — this page starts past the end of the queue"
    : "";

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
  //
  // PAST-END disqualifies it for the third time, and for the same reason: the
  // read landed and is current, but what it landed on is a window with no rows
  // in it and no count behind it, so `pendingCount === 0` is not a measurement
  // of anything. Green there is the exact sentence this file's comment above
  // says must never render falsely, printed over a queue of ~23,200.
  const waitingNotCurrent = waitingUnknown || waitingStale;
  const level: HealthStripLevel =
    loading ||
    pastEnd ||
    (waitingNotCurrent && pendingCount === 0 && blockingGaps === 0)
      ? "amber"
      : pendingCount > 0
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
    pastEnd ? "pending count unknown — past the end of the queue" : null,
  ].filter(Boolean);
  const alsoNotCurrent = notCurrentClauses.length
    ? ` (${notCurrentClauses.join("; ")})`
    : "";
  const headline = loading
    ? "Waiting for coord…"
    : pendingCount > 0
      ? // The SERVER's count, not the page's. "100 agents are stopped waiting
        // on you" off a 100-row page of a 23,700-row queue was the headline
        // this change exists to retire.
        `${formatCount(pendingCount)} agent${
          pendingCount === 1 ? " is" : "s are"
        } stopped waiting on you${
          audience === "operator" ? " (addressed to the operator)" : ""
        }${alsoNotCurrent}`
      : blockingGaps > 0
        ? // "At least", when the gap read itself was cut short. `blockingGaps`
          // is a count of the rows on ONE page of the gap queue, and coord
          // capping that page does not make the rest stop blocking.
          `${gapsPendingHasMore ? "At least " : ""}${blockingGaps} policy gap${
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
            }${pastEndSuffix}`
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
              } not refreshed since the last good read — not clear, just not re-read${pastEndSuffix}`
            : pastEnd
              ? // The arm that stands between a succeeded read and the
                // all-clear. Nothing above it can catch this: the read landed,
                // is current, and its honest answer was "this window is empty
                // and I cannot tell you how large the queue behind it is".
                `This page starts past the end of the pending queue — how many agents are waiting is unknown, not zero`
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
            // flight: the count is 0 in both cases and means nothing in
            // either.
            label: (
              <>
                {loading || pendingCountUnknown
                  ? "–"
                  : formatCount(pendingCount)}{" "}
                pending
              </>
            ),
            tone:
              !loading && !pendingCountUnknown && pendingCount > 0
                ? "attention"
                : "muted",
            onClick: () => setTab("pending"),
            title: pendingUnknown
              ? "the pending inbox could not be read — count unknown"
              : pastEnd
                ? "this page starts past the end of the queue, so coord returned no rows and no total — the pending count is unknown, not zero"
                : pendingTotal !== null
                  ? `coord's exact pre-limit count${
                      audience ? ` for audience=${audience}` : ""
                    }; ${formatCount(pendingOnPage)} of them are on this page`
                  : "show the pending inbox — coord did not report a total, so this is the page length",
          },
          {
            key: "gaps",
            label: <>gaps {loading || gapsUnknown ? "–" : blockingGaps}</>,
            tone: !loading && blockingGaps > 0 ? "attention" : "muted",
            onClick: () => setTab("gaps"),
            title: gapsUnknown
              ? "the gap inbox could not be read — count unknown"
              : gapsPendingHasMore
                ? `coord cut the gap queue short at ${GAPS_LIMIT} rows, so this is AT LEAST how many policy gaps are still blocking an agent — not exactly`
                : "policy gaps still blocking an agent",
          },
          {
            key: "answered",
            label: (
              <>
                answered{" "}
                {loading || answeredUnknown ? "–" : formatCount(answeredCount)}
              </>
            ),
            tone: "muted",
            title: answeredUnknown
              ? "the answered inbox could not be read — count unknown"
              : answeredTotal !== null
                ? `coord's exact count; the ${formatCount(
                    answeredOnPage
                  )} most recent are listed`
                : "recently-answered questions",
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
              count: loading || pendingCountUnknown ? null : pendingCount,
              attention: !loading && !pendingCountUnknown && pendingCount > 0,
            },
            {
              id: "answered",
              label: "Answered",
              count: loading || answeredUnknown ? null : answeredCount,
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
          // The filter input `<FilterTabs>` already owns (§6.4 — a console page
          // adds no new visual vocabulary, so this page does NOT hand-roll an
          // `<Input>` beside the tabs). It filters the rows on this page only;
          // the placeholder and the scope note below both say so.
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder="Filter these rows…"
          queryTestId="coord-questions-query"
          className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0"
        />
        <RefreshButton
          onRefresh={fetchAll}
          label="Refresh agent questions"
          title="Re-reads the pending, answered and gap inboxes now, keeping your page and filters; the pending inbox also re-reads itself every 10 s"
          data-testid="coord-questions-refresh"
        />
      </div>

      {/*
        Audience — the control that turns ~23,700 pending rows into ~442.
        `FilterChips`' empty selection IS the unfiltered state (its module doc),
        which maps exactly onto "send no `audience` parameter", so the whole
        queue needs no synthetic `any` value the API has never heard of.
      */}
      <div
        className="flex items-center gap-2 flex-wrap"
        data-testid="coord-questions-audience"
      >
        <FilterChips<QuestionAudience>
          label="audience:"
          options={[
            {
              value: "operator",
              label: "operator",
              title: "questions an operator must answer",
            },
            {
              value: "agent",
              label: "agent",
              title: "questions addressed to another agent (mostly pr_fix)",
            },
          ]}
          // Single-select in practice: the audience column holds one value, so
          // toggling one option replaces the other rather than unioning them.
          selected={audience ? [audience] : []}
          onToggle={(v) => {
            goToPendingOffset(0);
            setAudience((prev) => (prev === v ? null : v));
          }}
          onClear={() => {
            goToPendingOffset(0);
            setAudience(null);
          }}
          allLabel="whole queue"
          testIdPrefix="coord-questions-audience"
        />
        <span className="text-xs text-muted-foreground">
          {audience
            ? `Pending is filtered to questions addressed to the ${audience}.`
            : "Pending shows the whole queue — every audience."}
        </span>
        {audienceIgnored && (
          <span
            className="text-xs text-destructive"
            data-testid="coord-questions-audience-ignored"
          >
            This coord build returned questions addressed to another audience,
            so the filter is NOT being applied — the list below is the whole
            queue.
          </span>
        )}
      </div>

      {needle && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-questions-query-scope"
        >
          Showing {shownForTab} of the {onPageForTab} rows on this page that
          match “{query.trim()}”. This filter never leaves the page you are
          looking at — clear it and page through to search the rest.
        </p>
      )}

      {/*
        The window that sits PAST THE END of the queue, and the clamp that
        recovers from it. Rendered off `pastEndClamp` rather than off the live
        `pendingPastEnd`, so it survives the clamped re-read that immediately
        clears the verdict — the operator has to be told why the page moved.
        The button is the way back that this state used to have none of: the
        pager is gated on a known `total` and the truncation notice on a known
        `truncated`, and coord omits both here.
      */}
      {tab === "pending" && pastEndClamp !== null && (
        <div
          className="flex items-start justify-between gap-3 text-sm text-amber-200"
          data-testid="coord-questions-pending-past-end"
        >
          <p>
            Row {formatCount(pastEndClamp + 1)} is past the end of the pending
            queue. coord answered with no rows — and its total rides on the rows
            it returns, so it reported no total either. That is UNKNOWN, not
            zero: agents may still be waiting.{" "}
            {pastEnd
              ? "This page is still showing that window."
              : "You have been returned to the first page, which re-read with a real count."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // The clamp has usually already moved the offset to 0, and then
              // the paging effect has no dependency change to react to — so
              // this would clear the notice and read nothing. Issue the read
              // directly in that case, which is the state where the operator
              // most wants one: the clamp's own re-read failed or never
              // landed, which is why they are still looking at this.
              if (pendingOffset === 0) void fetchPending();
              goToPendingOffset(0);
            }}
            data-testid="coord-questions-pending-past-end-reset"
          >
            Re-read the first page
          </Button>
        </div>
      )}

      {tab === "pending" && !loading && !pendingUnknown && pendingHasMore && (
        <p
          className="text-sm text-amber-200"
          data-testid="coord-questions-pending-truncated"
        >
          {pendingTotal !== null ? (
            <>
              Showing {formatCount(pendingEffectiveOffset + 1)}–
              {formatCount(pendingRangeTo)} of {formatCount(pendingTotal)}{" "}
              pending questions —{" "}
              {/* The rows BEYOND this window, not the rows off this page. The
                  old `total - onPage` form counted everything the operator had
                  already walked past: at the end of a 23,700-row walk it
                  announced "23,650 are not on this page" under a heading that
                  reads "more remain". */}
              {formatCount(Math.max(0, pendingTotal - pendingRangeTo))} are not
              on this page.
            </>
          ) : (
            <>
              coord cut this list short and did not say how many rows it left
              out — more pending questions exist than are shown here.
            </>
          )}{" "}
          {audience
            ? `The queue is filtered to audience=${audience}; the whole queue is larger still.`
            : "Filter by audience or page through — the list below is not the whole queue."}
        </p>
      )}

      {tab === "pending" && !pageSizeHonoured && (
        <p
          className="text-xs text-amber-200"
          data-testid="coord-questions-pagesize-ignored"
        >
          This coord build did not accept the requested page size of{" "}
          {PENDING_PAGE_SIZE} — it answered with {pendingMeta.limit}. The range
          below follows what it actually returned.
        </p>
      )}

      {tab === "pending" && offsetIgnored && (
        <p
          className="text-xs text-destructive"
          data-testid="coord-questions-offset-ignored"
        >
          Paging is not working against this coord build: a later page came back
          with the same rows as the first, so `offset` is being ignored. Use the
          audience filter to narrow the queue instead.
        </p>
      )}

      {tab === "pending" && (
        <div data-testid="coord-questions-pending-list">
          <RecordList
            items={shownPending}
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
              // The filter arm comes FIRST, and only when rows were actually
              // fetched: "No pending questions." under an active filter is a
              // claim about coord made off a claim about a text box.
              needle && pendingOnPage > 0 ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-pending-filtered-out"
                >
                  None of the {pendingOnPage} rows on this page match “
                  {query.trim()}”. Other pages are not searched.
                </p>
              ) : pendingUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-pending-unreadable"
                >
                  The pending inbox could not be read, so whether an agent is
                  waiting is unknown — not none.
                </p>
              ) : pastEnd ? (
                <p
                  className="text-sm text-amber-200 italic"
                  data-testid="coord-questions-pending-past-end-empty"
                >
                  No rows at row {formatCount((pendingPastEnd ?? 0) + 1)} — that
                  window is past the end of the queue, which is not the same
                  thing as an empty inbox. How many questions are pending is
                  unknown until a page with rows on it is read.
                </p>
              ) : pendingStale ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-pending-stale"
                >
                  No pending questions as of the last good read — this inbox has
                  not refreshed since, so a newer one would not show here.
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

      {/*
        The offset pager, the same shape `PlanLibraryList` renders against a
        server `total` — deliberately NOT the "Load more" cursor walk the
        notifications page uses. The row the operator cannot find is usually the
        OLDEST one, and walking 470 pages toward it incrementally is the defect
        with extra clicks. "Last page" is the jump; it does not claim an
        ordering coord has not promised.
      */}
      {tab === "pending" &&
        !loading &&
        pendingTotal !== null &&
        pendingTotal > effectivePageSize && (
          <div
            className="flex items-center justify-between text-xs text-muted-foreground"
            data-testid="coord-questions-pending-pager"
          >
            <span data-testid="coord-questions-pending-range">
              {formatCount(pendingEffectiveOffset + 1)}–
              {formatCount(pendingRangeTo)} of {formatCount(pendingTotal)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pendingOffset === 0 || loading}
                onClick={() =>
                  goToPendingOffset(
                    Math.max(0, pendingOffset - effectivePageSize)
                  )
                }
                data-testid="coord-questions-pending-prev"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  pendingOffset + effectivePageSize >= pendingTotal || loading
                }
                onClick={() =>
                  goToPendingOffset(pendingOffset + effectivePageSize)
                }
                data-testid="coord-questions-pending-next"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  pendingOffset + effectivePageSize >= pendingTotal || loading
                }
                onClick={() =>
                  goToPendingOffset(
                    Math.max(
                      0,
                      (Math.ceil(pendingTotal / effectivePageSize) - 1) *
                        effectivePageSize
                    )
                  )
                }
                title="jump to the end of the queue"
                data-testid="coord-questions-pending-last"
              >
                Last page
              </Button>
            </div>
          </div>
        )}

      {tab === "answered" &&
        !loading &&
        !answeredUnknown &&
        answeredHasMore && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="coord-questions-answered-truncated"
          >
            {answeredTotal !== null ? (
              <>
                Showing the {formatCount(answeredOnPage)} most recent of{" "}
                {formatCount(answeredTotal)} answered questions —{" "}
                {formatCount(Math.max(0, answeredTotal - answeredRangeTo))} are
                not listed.
              </>
            ) : (
              <>
                coord cut this list short and did not say how many rows it left
                out — more answered questions exist than are shown here.
              </>
            )}
          </p>
        )}

      {tab === "answered" && (
        <div data-testid="coord-questions-answered-list">
          <RecordList
            items={shownAnswered}
            itemKey={(q) => q.question_id}
            loaded={!loading}
            skeletonRows={5}
            empty={
              needle && answeredOnPage > 0 ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-answered-filtered-out"
                >
                  None of the {answeredOnPage} rows on this page match “
                  {query.trim()}”. Other pages are not searched.
                </p>
              ) : answeredUnknown ? (
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
                  No recently-answered questions as of the last good read — this
                  list has not refreshed since.
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

      {/*
        The gap tab's truncation notice — the honesty the other two tabs got
        and this one did not. `blockingGaps` is a count of the rows on ONE page
        of the gap queue, and it drives the strip level and the "N policy gaps
        still blocking" headline, so a capped page here under-reports the
        alarm itself. There is no pager on this tab (the queue is small enough
        that a bound plus a disclosure is the proportionate answer), so the
        notice says what the number is instead of offering a walk.
      */}
      {tab === "gaps" && !loading && !gapsUnknown && gapsHasMore && (
        <p
          className="text-sm text-amber-200"
          data-testid="coord-questions-gaps-truncated"
        >
          coord cut the gap queue short at {GAPS_LIMIT} rows per leg
          {gapsPendingHasMore && gapsMeta.pending.total !== null
            ? ` — ${formatCount(
                gapsMeta.pending.total
              )} unanswered gap questions exist`
            : ""}
          .{" "}
          {gapsPendingHasMore
            ? `The blocking count is therefore AT LEAST ${blockingGaps}, not exactly it.`
            : "Every blocking gap is listed; it is the already-answered half that was cut."}{" "}
          This tab has no pager — answer what is here and refresh, or narrow
          with the filter box.
        </p>
      )}

      {tab === "gaps" && (
        <div data-testid="coord-questions-gaps-list">
          <RecordList
            items={shownGaps}
            itemKey={(g) => g.question_id}
            loaded={!loading}
            skeletonRows={4}
            empty={
              needle && visibleGaps.length > 0 ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-gaps-filtered-out"
                >
                  None of the {visibleGaps.length} gap rows loaded match “
                  {query.trim()}”.
                </p>
              ) : gapsUnknown ? (
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
