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

import { useCallback, useEffect, useMemo, useState } from "react";
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

function extractQuestions(body: unknown): AgentQuestionRow[] {
  if (Array.isArray(body)) return body as AgentQuestionRow[];
  return ((body as QuestionsListResponse).questions ?? []) as AgentQuestionRow[];
}

export default function CoordQuestionsPage() {
  const [pending, setPending] = useState<AgentQuestionRow[]>([]);
  const [answered, setAnswered] = useState<AgentQuestionRow[]>([]);
  const [gaps, setGaps] = useState<AgentQuestionRow[]>([]);
  const [handledGaps, setHandledGaps] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<QuestionsTab>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/pending`
      );
      setPending(extractQuestions(body));
      setError(null);
    } catch (e) {
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
    } catch (e) {
      // Don't clobber a pending-tab error; just leave answered empty.
      // Operators see the pending tab as the load-bearing view.
      console.warn("[coord/questions] fetchAnswered failed", e);
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
    } catch (e) {
      console.warn("[coord/questions] fetchGaps failed", e);
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

  useEffect(() => {
    setLoading(true);
    fetchAll();
    // Poll only the pending list; the answered list is operator-driven
    // and doesn't need 10s churn.
    const id = setInterval(fetchPending, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll, fetchPending]);

  const blockingGaps = visibleGaps.filter((g) => !g.responded_at).length;
  // R1 — derived from the three lists already on the page, never a second
  // fetch. `loading` is what makes a count UNKNOWN rather than zero.
  const level: HealthStripLevel = loading
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
        : "No agent is waiting on an answer";

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-questions-page">
      <HealthStrip
        level={level}
        headline={headline}
        detail={
          loading
            ? "counts appear once the inbox arrives"
            : "an unanswered question is an agent that has stopped — nothing else clears it"
        }
        badges={[
          {
            key: "pending",
            // The frozen `coord-questions-pending-count` testid
            // (`admin-coord-questions.spec.ts`) rides the badge that now
            // carries that number.
            "data-testid": "coord-questions-pending-count",
            label: <>{loading ? "–" : pending.length} pending</>,
            tone: !loading && pending.length > 0 ? "attention" : "muted",
            onClick: () => setTab("pending"),
            title: "show the pending inbox",
          },
          {
            key: "gaps",
            label: <>gaps {loading ? "–" : blockingGaps}</>,
            tone: !loading && blockingGaps > 0 ? "attention" : "muted",
            onClick: () => setTab("gaps"),
            title: "policy gaps still blocking an agent",
          },
          {
            key: "answered",
            label: <>answered {loading ? "–" : answered.length}</>,
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
            {
              id: "pending",
              label: "Pending",
              count: loading ? null : pending.length,
              attention: !loading && pending.length > 0,
            },
            {
              id: "answered",
              label: "Answered",
              count: loading ? null : answered.length,
            },
            {
              id: "gaps",
              label: "Gaps",
              count: loading ? null : visibleGaps.length,
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
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-questions-pending-empty"
              >
                No pending questions. Agents will queue them here when they need
                an operator decision.
              </p>
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
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-questions-answered-empty"
              >
                No recently-answered questions.
              </p>
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
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-questions-gaps-empty"
              >
                No policy gaps reported. Agents queue a gap here when no policy
                clause covers a decision — accept the proposed clause or dismiss
                it.
              </p>
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
