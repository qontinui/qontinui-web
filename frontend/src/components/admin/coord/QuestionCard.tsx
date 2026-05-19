"use client";

/**
 * QuestionCard — render a single `coord.agent_questions` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 3 (Wave 3a).
 *
 * Used by the inbox list view at `/admin/coord/questions`. Each card is
 * clickable and routes to `/admin/coord/questions/[id]` for the full
 * detail + response composer. The card surfaces the minimum the operator
 * needs to triage: agent_id (short), plan_phase, the question (truncated),
 * created_at as a relative timestamp, and an answered indicator when the
 * row has already been responded to.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";

export interface AgentQuestionOption {
  value?: string;
  label?: string;
  description?: string;
}

export interface AgentQuestionRow {
  question_id: string;
  agent_id?: string | null;
  agent_session_id?: string | null;
  device_id?: string | null;
  plan_phase?: string | null;
  question: string;
  // `options` is JSONB on the coord side — tolerate both shapes
  // (array of objects with {value,label} OR array of bare strings).
  options?: AgentQuestionOption[] | string[] | null;
  context?: string | null;
  created_at?: string;
  responded_at?: string | null;
  response?: string | null;
  responded_by_operator?: string | null;
}

/**
 * Format a timestamp as a short relative span (e.g. "3m", "2h", "5d").
 * Falls back to the raw ISO if parsing fails — never throws.
 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export function QuestionCard({ question }: { question: AgentQuestionRow }) {
  const answered = Boolean(question.responded_at);
  const agentShort = question.agent_id
    ? question.agent_id.slice(0, 8)
    : "(unknown)";

  return (
    <Link
      href={`/admin/coord/questions/${question.question_id}`}
      data-testid="coord-question-card"
      className="block"
    >
      <Card className={answered ? "opacity-70 hover:opacity-100" : ""}>
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {answered ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <MessageSquareWarning className="h-3.5 w-3.5 text-amber-500" />
            )}
            <Badge variant={answered ? "secondary" : "default"}>
              {answered ? "answered" : "pending"}
            </Badge>
            {question.plan_phase && (
              <Badge variant="outline" className="text-xs">
                {question.plan_phase}
              </Badge>
            )}
            <span className="font-mono text-xs text-muted-foreground">
              agent {agentShort}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatRelative(question.created_at)}
            </span>
          </div>
          <p className="text-sm text-foreground">
            {truncate(question.question, 200)}
          </p>
          {answered && question.response && (
            <p className="text-xs text-muted-foreground italic">
              → {truncate(question.response, 140)}
              {question.responded_by_operator
                ? ` (${question.responded_by_operator})`
                : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
