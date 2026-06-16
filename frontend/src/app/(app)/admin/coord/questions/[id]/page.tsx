"use client";

/**
 * /admin/coord/questions/[id] — single agent-question detail + responder.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 3 (Wave 3a).
 *
 * Renders the full question, free-form context (markdown), and the
 * `options` JSONB as selectable cards. The operator can:
 *   1. Click an option card → its value is staged in the response textarea
 *   2. Edit the textarea freely
 *   3. Submit — POST /api/v1/operations/agent-questions/:id/respond with
 *      `{response, responded_by_operator}` where responded_by_operator is
 *      the current admin's email.
 *
 * On success: toast + redirect back to /admin/coord/questions. Already-
 * answered questions render in a read-only mode with the prior response
 * displayed and the submit composer disabled.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CheckCircle2,
  Inbox,
  MessageSquareWarning,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCoordIdentity } from "@/components/admin/coord/use-coord-identity";
import { isCoordMember } from "@/lib/coord-permissions";
import { cn } from "@/lib/utils";
import { httpClient } from "@/services/service-factory";
import {
  formatRelative,
  type AgentQuestionOption,
  type AgentQuestionRow,
} from "@/components/admin/coord/QuestionCard";

const API = "/api/v1/operations";

function normalizeOptions(
  raw: AgentQuestionRow["options"]
): AgentQuestionOption[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === "string") return { value: entry, label: entry };
    return entry as AgentQuestionOption;
  });
}

export default function CoordQuestionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const identity = useCoordIdentity();
  // Coord gates `POST /coord/agent-questions/:id/respond` (the route this page
  // proxies to) on tenant membership only — no role tier — so any coord member
  // may answer. (The agent_supervisor-gated `respond-sso` variant is a
  // different route the console does not use.)
  const canRespond = isCoordMember(identity);

  const id = useMemo(() => {
    const raw = params?.id;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [question, setQuestion] = useState<AgentQuestionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchOne = useCallback(async () => {
    if (!id) return;
    try {
      const body = await httpClient.get<AgentQuestionRow>(
        `${API}/agent-questions/${encodeURIComponent(id)}`
      );
      setQuestion(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchOne();
  }, [fetchOne]);

  const onSubmit = useCallback(async () => {
    if (!id || !response.trim()) return;
    setSubmitting(true);
    try {
      await httpClient.post(
        `${API}/agent-questions/${encodeURIComponent(id)}/respond`,
        {
          response: response.trim(),
          responded_by_operator: user?.email ?? "operator",
        }
      );
      toast.success("Response sent to agent");
      router.push("/admin/coord/questions");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to submit response"
      );
    } finally {
      setSubmitting(false);
    }
  }, [id, response, user?.email, router]);

  const options = normalizeOptions(question?.options ?? null);
  const answered = Boolean(question?.responded_at);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-4xl mx-auto"
      data-testid="coord-question-detail-page"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/questions")}
          data-testid="coord-question-back-btn"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Questions
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-xs">{id}</span>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !question ? (
        <Skeleton className="h-32 w-full" />
      ) : question ? (
        <>
          <Card data-testid="coord-question-meta">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {answered ? (
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <MessageSquareWarning className="h-4 w-4 text-amber-500" />
                )}
                <Badge variant={answered ? "secondary" : "default"}>
                  {answered ? "answered" : "pending"}
                </Badge>
                {question.plan_phase && (
                  <Badge variant="outline">{question.plan_phase}</Badge>
                )}
                {question.created_at && (
                  <span className="text-xs text-muted-foreground">
                    posted {formatRelative(question.created_at)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {question.agent_id && (
                  <span>
                    agent <span className="font-mono">{question.agent_id}</span>
                  </span>
                )}
                {question.agent_session_id && (
                  <span>
                    session{" "}
                    <span className="font-mono">
                      {question.agent_session_id}
                    </span>
                  </span>
                )}
                {question.device_id && (
                  <span>
                    device{" "}
                    <span className="font-mono">{question.device_id}</span>
                  </span>
                )}
              </div>
              <p className="text-base font-medium">{question.question}</p>
            </CardContent>
          </Card>

          {question.context && (
            <Card data-testid="coord-question-context">
              <CardHeader>
                <CardTitle className="text-sm">Context</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {question.context}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {canRespond && !answered && options.length > 0 && (
            <Card data-testid="coord-question-options">
              <CardHeader>
                <CardTitle className="text-sm">Suggested options</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  {options.map((opt, i) => {
                    const value =
                      opt.value ??
                      opt.label ??
                      `option-${i}`;
                    const isSelected = selectedOption === value;
                    return (
                      <button
                        type="button"
                        key={`${value}-${i}`}
                        data-testid="coord-question-option-card"
                        disabled={answered}
                        onClick={() => {
                          setSelectedOption(value);
                          setResponse(value);
                        }}
                        className={cn(
                          "text-left border rounded-md p-3 transition-colors",
                          "hover:bg-muted",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border",
                          answered && "opacity-60 cursor-not-allowed"
                        )}
                      >
                        <div className="text-sm font-medium">
                          {opt.label ?? opt.value ?? value}
                        </div>
                        {opt.description && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {opt.description}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="coord-question-respond">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Inbox className="h-4 w-4" />
                {answered
                  ? "Recorded response"
                  : canRespond
                    ? "Respond"
                    : "Response"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {answered ? (
                <>
                  <p className="text-sm whitespace-pre-wrap">
                    {question.response}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    answered{" "}
                    {formatRelative(question.responded_at ?? undefined)}
                    {question.responded_by_operator
                      ? ` by ${question.responded_by_operator}`
                      : ""}
                  </p>
                </>
              ) : !canRespond ? (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="coord-question-readonly"
                >
                  This question is awaiting an operator response. Answering
                  agent questions requires coordination-layer access (a linked
                  coord tenant membership).
                </p>
              ) : (
                <>
                  <Textarea
                    rows={5}
                    placeholder="Type a response, or click an option above to seed it."
                    value={response}
                    onChange={(e) => {
                      setResponse(e.target.value);
                      setSelectedOption(null);
                    }}
                    data-testid="coord-question-response-textarea"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={onSubmit}
                      disabled={submitting || !response.trim()}
                      data-testid="coord-question-submit"
                    >
                      {submitting ? "Sending..." : "Send response"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      responding as {user?.email ?? "(unknown operator)"}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Question {id} not found.
        </p>
      )}
    </div>
  );
}
