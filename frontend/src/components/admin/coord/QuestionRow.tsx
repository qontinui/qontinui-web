"use client";

/**
 * QuestionRow — one `coord.agent_questions` row, on one line, detail on click.
 *
 * Replaces `QuestionCard` on `/admin/coord/questions`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `AlertRow.tsx`, this wave's reference implementation.
 *
 * **D1 — the whole card used to be a `<Link>` to
 * `/admin/coord/questions/[id]`.** Triaging an inbox meant navigating away and
 * back for every row, losing the tab and the scroll position, to read four
 * fields. The row now expands in place; the detail route survives and is
 * reached by the explicit "Open full page ↗" action, which is also where the
 * response composer lives. The truncated question text the card showed is
 * shown in FULL in the detail — expanding is strictly more information than
 * the card gave, at a third of the collapsed height.
 *
 * `coord-question-card` is carried across onto the row (D4a).
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  QUESTION_STATUS_PALETTE,
  deriveQuestionStatus,
  optionLabels,
  questionIdentity,
  truncate,
  type AgentQuestionRow,
} from "@/components/admin/coord/questionStatus";

export type { AgentQuestionRow };

export function QuestionRow({
  question,
  expanded,
  onToggle,
}: {
  question: AgentQuestionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveQuestionStatus(question);
  const answered = Boolean(question.responded_at);
  const options = optionLabels(question);

  return (
    <RecordRow
      data-testid="coord-question-card"
      rowKey={question.question_id}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      className={answered ? "opacity-70 hover:opacity-100" : undefined}
      identity={questionIdentity(question)}
      label={<span title={question.question}>{truncate(question.question, 160)}</span>}
      status={
        <span className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={status} palette={QUESTION_STATUS_PALETTE} />
          {question.plan_phase && (
            <Badge
              variant="outline"
              className="text-[10px] hidden md:inline-flex"
            >
              {question.plan_phase}
            </Badge>
          )}
        </span>
      }
      time={
        <RowTime
          at={question.created_at ?? null}
          verb="Posted"
          absent={{
            label: "no post time",
            title: "coord recorded no created_at for this question",
          }}
        />
      }
    >
      <RecordDetail
        why={
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {question.question}
          </p>
        }
        problems={
          <>
            {options.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Options offered:
                </span>
                {options.map((o) => (
                  <Badge key={o} variant="outline" className="text-[10px]">
                    {o}
                  </Badge>
                ))}
              </div>
            )}
            {question.context && (
              <div className="text-xs">
                <span className="text-muted-foreground">Context: </span>
                <span className="whitespace-pre-wrap break-words text-foreground/90">
                  {truncate(question.context, 600)}
                </span>
              </div>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/coord/questions/${question.question_id}`}
              data-testid="coord-question-card-link"
            >
              <Button variant="outline" size="sm">
                Open full page
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
            {!answered && (
              <span className="text-xs text-muted-foreground">
                the response composer lives on the detail page
              </span>
            )}
          </div>
        }
        history={
          answered ? (
            <div className="text-xs" data-testid="coord-question-response">
              <span className="text-muted-foreground">Answered </span>
              <RowTime at={question.responded_at ?? null} verb="Answered" />
              {question.responded_by_operator && (
                <span className="text-muted-foreground">
                  {" "}
                  by {question.responded_by_operator}
                </span>
              )}
              {question.response && (
                <p className="mt-1 whitespace-pre-wrap text-foreground/90">
                  {question.response}
                </p>
              )}
            </div>
          ) : undefined
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            question {question.question_id}
            {question.agent_id ? ` · agent ${question.agent_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
