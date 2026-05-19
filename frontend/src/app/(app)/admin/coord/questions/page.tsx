"use client";

/**
 * /admin/coord/questions — agent question inbox.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 3 (Wave 3a).
 *
 * Tabs: pending (default) vs answered. The pending tab polls every 10s
 * so freshly-posted questions appear without a manual refresh. Clicking
 * a row routes to `/admin/coord/questions/[id]` for the detail +
 * response composer.
 *
 * Endpoints (proxied via `/api/v1/operations/agent-questions/*`):
 *   GET /agent-questions/pending      — pending rows
 *   GET /agent-questions/answered     — recently-answered rows
 *
 * Both backed by coord; both admin-gated.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Inbox, RefreshCw } from "lucide-react";
import {
  QuestionCard,
  type AgentQuestionRow,
} from "@/components/admin/coord/QuestionCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 10_000;
const ANSWERED_LIMIT = 50;

interface QuestionsListResponse {
  questions?: AgentQuestionRow[];
}

export default function CoordQuestionsPage() {
  const [pending, setPending] = useState<AgentQuestionRow[]>([]);
  const [answered, setAnswered] = useState<AgentQuestionRow[]>([]);
  const [tab, setTab] = useState<"pending" | "answered">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agent-questions/pending`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (Array.isArray(body)) {
        setPending(body as AgentQuestionRow[]);
      } else {
        setPending(
          ((body as QuestionsListResponse).questions ??
            []) as AgentQuestionRow[]
        );
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const fetchAnswered = useCallback(async () => {
    try {
      const res = await fetch(
        `${API}/agent-questions/answered?limit=${ANSWERED_LIMIT}`
      );
      if (!res.ok) {
        // Answered endpoint may not be wired yet on every coord build;
        // tolerate a 404/501 silently so the pending tab still works.
        if (res.status === 404 || res.status === 501) {
          setAnswered([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      if (Array.isArray(body)) {
        setAnswered(body as AgentQuestionRow[]);
      } else {
        setAnswered(
          ((body as QuestionsListResponse).questions ??
            []) as AgentQuestionRow[]
        );
      }
    } catch (e) {
      // Don't clobber a pending-tab error; just leave answered empty.
      // Operators see the pending tab as the load-bearing view.
      console.warn("[coord/questions] fetchAnswered failed", e);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchPending(), fetchAnswered()]);
    setLoading(false);
  }, [fetchPending, fetchAnswered]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
    // Poll only the pending list; the answered list is operator-driven
    // and doesn't need 10s churn.
    const id = setInterval(fetchPending, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll, fetchPending]);

  return (
    <div className="p-6 space-y-4" data-testid="coord-questions-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4" />
            Agent questions
            <Badge
              variant="outline"
              className="ml-2"
              data-testid="coord-questions-pending-count"
            >
              {pending.length} pending
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={fetchAll}
              data-testid="coord-questions-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="text-sm text-destructive">
              Failed to load: {error}
            </p>
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "pending" | "answered")}
          >
            <TabsList data-testid="coord-questions-tabs">
              <TabsTrigger
                value="pending"
                data-testid="coord-questions-tab-pending"
              >
                Pending ({pending.length})
              </TabsTrigger>
              <TabsTrigger
                value="answered"
                data-testid="coord-questions-tab-answered"
              >
                Answered ({answered.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="mt-3">
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : pending.length > 0 ? (
                <div
                  className="space-y-2"
                  data-testid="coord-questions-pending-list"
                >
                  {pending.map((q) => (
                    <QuestionCard key={q.question_id} question={q} />
                  ))}
                </div>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-pending-empty"
                >
                  No pending questions. Agents will queue them here when they
                  need an operator decision.
                </p>
              )}
            </TabsContent>

            <TabsContent value="answered" className="mt-3">
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : answered.length > 0 ? (
                <div
                  className="space-y-2"
                  data-testid="coord-questions-answered-list"
                >
                  {answered.map((q) => (
                    <QuestionCard key={q.question_id} question={q} />
                  ))}
                </div>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-questions-answered-empty"
                >
                  No recently-answered questions.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
