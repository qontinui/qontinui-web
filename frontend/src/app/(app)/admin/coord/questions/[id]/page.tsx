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
 * ## Absence is UNKNOWN, not "not found" (follow-up to #1110)
 *
 * #1110 removed the false all-clear from the INBOX and amended the style
 * guide's R6 to say a failed read needs its own flag that every derived
 * surface consults — "`RecordList`'s `empty` slot included". Its sweep was of
 * `empty=` slots, so it did not reach the shape here: a bare `: (` arm on a
 * `question === null` ternary, which is the same slot hand-rolled. That arm
 * said **"Question {id} not found."** for a read that FAILED, which is the
 * inbox's green all-clear in the singular — it tells the operator the question
 * is gone, and nothing else on the page contradicts it.
 *
 * The correction has to stop short of the opposite error. A **404 is coord
 * ANSWERING** — it holds no such row — and is the ordinary outcome of a stale
 * deep link, so it keeps the calm, definite copy. Only a read that never
 * landed is unknown. Three things follow: `extractQuestion` refuses an
 * unrecognised 200 instead of casting it into a live composer; `fetchSeq`
 * drops a superseded read so an `[id]` change cannot paint the previous
 * question under the new id; and the empty-`id` bail clears `loading` instead
 * of leaving the skeleton up forever.
 *
 * Every authored `data-testid` is carried across unchanged (D4a):
 * `coord-question-detail-page`, `coord-question-back-btn`,
 * `coord-question-meta`, `coord-question-context`, `coord-question-options`,
 * `coord-question-option-card`, `coord-question-respond`,
 * `coord-question-response-textarea`, `coord-question-submit`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  isNotFoundError,
  rowAccentProps,
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

/**
 * A 200 whose body is not a question row is UNKNOWN, not a missing question.
 *
 * The list route learned this as `extractQuestions` (#1110): `?? []` turned an
 * unrecognised 200 into a confident zero. The blind `httpClient.get<Row>` cast
 * here was the same mistake with a worse landing. A wrapper body, a `null`, or
 * a coord error envelope all pass `typeof body === "object"`, so `question`
 * became a TRUTHY object with every field `undefined` — which renders an empty
 * question heading above a LIVE composer, because `responded_at` is undefined
 * so `answered` is false. An operator can then submit an answer to a question
 * they were never shown.
 *
 * Both fields are required: `question_id` is the identity the composer posts
 * against, and `question` is the text the operator is answering. A body
 * missing either is not something to render a composer on top of.
 */
function extractQuestion(body: unknown): AgentQuestionRow {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const row = body as Partial<AgentQuestionRow>;
    if (typeof row.question_id === "string" && typeof row.question === "string") {
      return row as AgentQuestionRow;
    }
  }
  throw new Error(
    "unrecognised agent-question response: no `question_id`/`question`"
  );
}

/**
 * True when coord ANSWERED "not found" rather than failing to answer.
 *
 * Reading every failure as unknown would be the over-correction: a 404 is
 * coord stating that it holds no such row, which is real information and the
 * ordinary outcome of pasting a stale deep link. Flattening it into "could not
 * be read" trains the operator to distrust the honest message.
 *
 * `httpClient` throws a plain `Error` embedding the upstream status
 * (`GET <url> failed: 404 - …`), and the operations proxy mirrors coord's
 * status rather than collapsing it — the same detection
 * `useSessionCompliance.isRouteUnavailable` uses, and for the same reason.
 *
 * What a 404 MEANS stays genuinely ambiguous from here — "no such question",
 * or "this coord build does not serve the detail route" — so the copy reports
 * the fact and names both readings rather than picking one and stating it as
 * diagnosis. What it is NOT, either way, is a failure to reach coord.
 */
function coordSaidNotFound(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return / failed: 404 /.test(text);
}

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
  /** The read failed with coord's own 404 — it answered, and the answer was
   *  "no such question". See `isNotFoundError`. Separate from `error` because
   *  the two absences are different facts: coord ANSWERED and holds no such
   *  row, versus coord did not answer at all. Only the second is unknown, and
   *  collapsing them either way misinforms. */
  const [notFound, setNotFound] = useState(false);

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Generation guard, for the same reason #1110 put one on each of the three
  // list reads — and here it is not only a rendering concern. App Router keeps
  // this component MOUNTED across an `[id]` change, so navigating A -> B while
  // A's read is slow lands `setQuestion(A)` after B's. The page would then
  // render question A's text under B's id, and `onSubmit` posts to `id` — B.
  // The operator answers the wrong agent, having read the wrong question.
  const fetchSeq = useRef(0);

  const fetchOne = useCallback(async () => {
    const seq = ++fetchSeq.current;
    if (!id) {
      // Bailing here used to skip the `finally`, so `loading` stayed true and
      // the page rendered its skeleton forever — no error, no explanation, and
      // indistinguishable from a read that is merely slow.
      setError("no question id in the route");
      setLoading(false);
      return;
    }
    setNotFound(false);
    try {
      const body = await httpClient.get<unknown>(
        `${API}/agent-questions/${encodeURIComponent(id)}`
      );
      if (seq !== fetchSeq.current) return;
      setQuestion(extractQuestion(body));
      setError(null);
      setNotFound(false);
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setNotFound(coordSaidNotFound(e));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Drop the previous id's question first: the catch never nulls
    // `question`, so a 404 after a successful load would render the OLD
    // question under the new id — and both arms below sit behind
    // `question === null`, so neither could be reached. `fetchOne` keys on
    // `id`, and this route does not poll.
    setQuestion(null);
    setError(null);
    setNotFound(false);
    setLoading(true);
    // Drop the previous question when the id changes. #1110's rule is that a
    // retained list is STALE-but-real and worth keeping; that rule turns on the
    // retained rows still being about the same thing. Here they are not — a
    // different `[id]` is a different question, and holding A's text under B's
    // id beside a live composer that posts to B is the wrong-question hazard
    // the generation guard exists to close, arriving by the other door.
    setQuestion(null);
    setError(null);
    setNotFound(false);
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

      {error && !notFound && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {loading && !question ? (
        <Skeleton className="h-32 w-full" />
      ) : question ? (
        <>
          {/* R9/R4 — the meta block is one bordered strip, not a Card with a
              header. `rowAccentProps` gives an unanswered question the same
              red left edge it carries in the inbox, so the two surfaces agree
              at a glance about whether an agent is stopped — and declares that
              attention in `data-attention`, so a style rule can check the
              agreement rather than a reader having to. */}
          <div
            data-testid="coord-question-meta"
            {...rowAccentProps(
              status,
              "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-2"
            )}
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
      ) : notFound ? (
        /* Coord answered. Keep the calm, definite copy — this is the ordinary
           outcome of a stale deep link — but name the other reading rather
           than diagnosing, as `useSessionCompliance` does for the same status.
           Muted, not destructive: nothing here failed. */
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-question-not-found"
        >
          Question {id} not found — coord holds no such question. (A coord build
          that does not serve the question-detail route answers the same way;
          this page cannot tell the two apart.)
        </p>
      ) : (
        /* The absence claim is made HERE, in words — the last place a failed
           read has to reach, exactly as the style guide's R6 note (added by
           #1110) says. `question` is null for two unrelated reasons, and this
           is the arm where coord did NOT answer. Saying "not found" here tells
           the operator the question is gone — the one sentence that makes them
           stop looking — off a read that never landed. Same class as the GREEN
           all-clear #1110 removed from the inbox, one directory down. */
        <p
          className="text-sm text-destructive italic"
          data-testid="coord-question-unreadable"
        >
          Question {id} could not be read, so whether it exists — and whether an
          agent is still stopped on it — is unknown. This is not &ldquo;no such
          question&rdquo;.
        </p>
      )}
    </div>
  );
}
