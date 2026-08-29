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
 *
 * ## Console style (Phase 3 Wave 3)
 *
 * The ROUTE survives (D1 — this page is a workspace: it has its own actions,
 * its own composer, and a deep link operators paste). What changed is chrome,
 * per `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the four `<Card><CardHeader><CardTitle>` section wrappers are
 *   gone. None of them was a page title, but each cost ~72px of header to
 *   label a section a one-line heading labels just as well, and four of them
 *   stacked pushed the composer — the thing the operator came here to use —
 *   below the fold on a laptop.
 * - **R3/R4** — the question's state is now a `<StatusBadge>` off
 *   `deriveQuestionStatus`, the SAME derivation `/questions` renders, with the
 *   matching left-edge accent. It used to be a hand-rolled
 *   `answered ? "secondary" : "default"` badge saying "pending", which is the
 *   one state R3 files as red: an unanswered question is an agent that has
 *   STOPPED, and nothing but this page clears it. The list said so; the detail
 *   route did not.
 * - **R7** — free-form `Context` is supporting material, so it collapses. It
 *   opens by default (you usually need it to answer) and its open/closed
 *   choice persists.
 *
 * Every authored `data-testid` is carried across unchanged (D4a):
 * `coord-question-detail-page`, `coord-question-back-btn`,
 * `coord-question-meta`, `coord-question-context`, `coord-question-options`,
 * `coord-question-option-card`, `coord-question-respond`,
 * `coord-question-response-textarea`, `coord-question-submit`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, FileText, Inbox } from "lucide-react";
import {
  CollapsiblePanel,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { httpClient } from "@/services/service-factory";
import {
  QUESTION_STATUS_PALETTE,
  deriveQuestionStatus,
  formatRelative,
  type AgentQuestionOption,
  type AgentQuestionRow,
} from "@/components/admin/coord/questionStatus";

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
  // R3 — the SAME derivation the inbox renders, so the two surfaces cannot
  // disagree about whether an agent is stopped on this question. `question`
  // may be null while the first read is in flight; the block that consumes
  // this only renders once it is not.
  const status = deriveQuestionStatus(question ?? {});

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
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {loading && !question ? (
        <Skeleton className="h-32 w-full" />
      ) : question ? (
        <>
          {/* R9/R4 — the meta block is one bordered strip, not a Card with a
              header. `rowAccentClass` gives an unanswered question the same
              red left edge it carries in the inbox, so the two surfaces agree
              at a glance about whether an agent is stopped. */}
          <div
            data-testid="coord-question-meta"
            className={[
              "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-2",
              rowAccentClass(status),
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} palette={QUESTION_STATUS_PALETTE} />
              {question.plan_phase && (
                <Badge variant="outline">{question.plan_phase}</Badge>
              )}
              {question.created_at && (
                <RowTime at={question.created_at} verb="Posted" />
              )}
            </div>
            <p className="text-base font-medium">{question.question}</p>
            {/* R8 — the raw coord ids live at the bottom, muted and mono, not
                beside the question they are support material for. */}
            <div className="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted-foreground/60 break-all">
              {question.agent_id && <span>agent {question.agent_id}</span>}
              {question.agent_session_id && (
                <span>session {question.agent_session_id}</span>
              )}
              {question.device_id && <span>device {question.device_id}</span>}
            </div>
          </div>

          {question.context && (
            /* R7 — supporting material collapses. It opens by default because
               you usually need it to answer, and the choice persists. */
            <CollapsiblePanel
              titleAs="h2"
              className="p-3"
              defaultOpen
              storageKey="coord-question-context"
              icon={<FileText className="h-3.5 w-3.5" />}
              title="Context"
              data-testid="coord-question-context"
            >
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {question.context}
                </ReactMarkdown>
              </div>
            </CollapsiblePanel>
          )}

          {options.length > 0 && (
            <section
              data-testid="coord-question-options"
              className="space-y-2"
            >
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Suggested options
              </h2>
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
            </section>
          )}

          <section
            data-testid="coord-question-respond"
            className="space-y-3 rounded-lg border border-border bg-card/30 px-4 py-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Inbox className="h-4 w-4" />
              {answered ? "Recorded response" : "Respond"}
            </h2>
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
          </section>
        </>
      ) : error ? (
        // R6 — a read that failed supports no claim about coord's corpus. This
        // route is where an operator lands to unblock a stopped agent, so
        // "not found" here reads as "that agent's question is gone".
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-question-detail-unknown"
        >
          Could not read question {id} — whether it exists is unknown, not no.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-question-detail-missing"
        >
          Question {id} not found.
        </p>
      )}
    </div>
  );
}
