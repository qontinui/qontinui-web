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

  // Generation guard for the polled read: an in-flight FAILING request that
  // resolves after a later successful one must not set `error` back. That was
  // survivable while `error` only drove a banner; now it drives the strip's
  // level and headline, so a lost race would paint amber over a good read.
  const pendingSeq = useRef(0);

  const fetchPending = useCallback(async () => {
    const seq = ++pendingSeq.current;
    try {
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/pending`
      );
      if (seq !== pendingSeq.current) return;
      setPending(extractQuestions(body));
      setError(null);
    } catch (e) {
      if (seq !== pendingSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const fetchAnswered = useCallback(async () => {
    try {
      // The answered endpoint may not be wired yet on every coord build;
      // any failure (incl. 404/501) is tolerated by the catch below, which
      // leaves the answered list empty so the pending tab still works.
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/answered?limit=${ANSWERED_LIMIT}`
      );
      setAnswered(extractQuestions(body));
      setAnsweredError(false);
    } catch (e) {
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
      setGaps(merged);
      setGapsError(false);
    } catch (e) {
      // The worst of the three to swallow: `gaps` at `[]` makes
      // `blockingGaps` 0, which is what turns the strip GREEN under the
      // headline "No agent is waiting on an answer". A read that never
      // happened must never produce the all-clear.
      console.warn("[coord/questions] fetchGaps failed", e);
      setGapsError(true);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchPending(), fetchAnswered(), fetchGaps()]);
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

  // `answeredError` / `gapsError` are cleared only by a full read, and only
  // `fetchPending` is polled — so without this a single transient gap failure
  // would pin the page at "could not read the gaps inbox" until someone
  // pressed refresh, while pending re-read happily every 10s. A degraded page
  // has to be able to heal itself. Read through a ref so the interval is not
  // torn down and rebuilt on every flag change.
  const degraded = useRef(false);
  degraded.current = error !== null || answeredError || gapsError;

  useEffect(() => {
    setLoading(true);
    fetchAll();
    // Poll the pending list; the answered list is operator-driven and doesn't
    // need 10s churn — EXCEPT while something is unread, when the whole point
    // of the poll is to find out that it no longer is.
    const id = setInterval(() => {
      if (degraded.current) void fetchAll();
      else void fetchPending();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll, fetchPending]);

  const blockingGaps = visibleGaps.filter((g) => !g.responded_at).length;
  // A failed read only FABRICATES when the list it left behind is empty. A
  // non-empty list retained from an earlier success is STALE, not invented —
  // blanking it would throw away real information and hide a count the
  // operator can still act on. So "unknown" is reserved for exactly the case
  // where the zero would otherwise be a claim about coord.
  //
  // EACH predicate is keyed on the quantity ITS OWN surface renders. Keying one
  // off a neighbour's count reopens the hole in a narrower window: the gaps
  // list unions `pending?gap=true` with `answered?gap=true`, so it can hold
  // rows while `blockingGaps` is 0 (every retained gap already answered) — and
  // a `visibleGaps.length`-keyed predicate would then read "known" while the
  // strip printed `gaps 0` and the green all-clear off a read that failed.
  const pendingUnknown = error !== null && pending.length === 0;
  const answeredUnknown = answeredError && answered.length === 0;
  /** For the FilterTabs count, which renders `visibleGaps.length`. */
  const gapsTabUnknown = gapsError && visibleGaps.length === 0;
  /** For the strip badge and level, which render `blockingGaps`. */
  const blockingGapsUnknown = gapsError && blockingGaps === 0;

  // "Is an agent waiting?" — the question the strip answers — is decided by
  // pending + gaps ALONE. The answered list is a read-only audit view, and
  // `fetchAnswered`'s own comment notes the endpoint may not be wired on every
  // coord build: letting it drive the level would leave such a build
  // permanently amber with the all-clear permanently hidden, which trains
  // operators to ignore amber and erodes the signal this whole change protects.
  const waitingUnreadable = [
    pendingUnknown ? "pending" : null,
    blockingGapsUnknown ? "gaps" : null,
  ].filter(Boolean);
  const allUnreadable = [
    ...waitingUnreadable,
    answeredUnknown ? "answered" : null,
  ].filter(Boolean);
  const waitingUnknown = waitingUnreadable.length > 0;
  const anyUnknown = allUnreadable.length > 0;
  // A read that failed but left a NON-empty list behind: not fabricated, but
  // not fresh either, and otherwise its only trace is a `console.warn`.
  const anyStale =
    (error !== null || answeredError || gapsError) && !anyUnknown;
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
  const level: HealthStripLevel =
    loading || (waitingUnknown && pending.length === 0 && blockingGaps === 0)
      ? "amber"
      : pending.length > 0
        ? "red"
        : blockingGaps > 0
          ? "amber"
          : "green";
  const headline = loading
    ? "Waiting for coord…"
    : pending.length > 0
      ? `${pending.length} agent${
          pending.length === 1 ? " is" : "s are"
        } stopped waiting on you`
      : blockingGaps > 0
        ? `${blockingGaps} policy gap${
            blockingGaps === 1 ? "" : "s"
          } still blocking`
        : waitingUnknown
          ? `Could not read the ${waitingUnreadable.join(" and ")} ${inboxWord(
              waitingUnreadable.length
            )} — unknown, not clear`
          : "No agent is waiting on an answer";

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-questions-page">
      <HealthStrip
        level={level}
        headline={headline}
        detail={
          loading
            ? "counts appear once the inbox arrives"
            : anyUnknown
              ? `coord did not answer for: ${allUnreadable.join(
                  ", "
                )}. Those counts are unknown — a dash, not a zero.`
              : anyStale
                ? "coord did not answer on the last read — the counts below are the last ones that landed, not current"
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
            // `blockingGapsUnknown`, not the tab's predicate: this badge
            // renders `blockingGaps`, and the two diverge whenever a retained
            // gap list holds only already-answered rows.
            label: <>gaps {loading || blockingGapsUnknown ? "–" : blockingGaps}</>,
            tone: !loading && blockingGaps > 0 ? "attention" : "muted",
            onClick: () => setTab("gaps"),
            title: blockingGapsUnknown
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
              count: loading || gapsTabUnknown ? null : visibleGaps.length,
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
              // it is the last place the failure has to reach. `items` is `[]`
              // either way; only the flag can tell the two apart.
              pendingUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-pending-unreadable"
                >
                  The pending inbox could not be read, so whether an agent is
                  waiting is unknown — not none.
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
              gapsTabUnknown ? (
                <p
                  className="text-sm text-destructive italic"
                  data-testid="coord-questions-gaps-unreadable"
                >
                  The gap inbox could not be read. Whether an agent is blocked
                  on a missing policy clause is unknown — this is not an
                  all-clear.
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
