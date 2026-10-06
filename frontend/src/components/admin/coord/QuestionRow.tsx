"use client";

/**
 * QuestionRow — one `coord.agent_questions` row, on one line, detail on click.
 *
 * Replaces `QuestionCard` on `/admin/coord/questions`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `AlertRow.tsx`, this wave's reference implementation — since retired with
 * the alerts page; `PlanRow.tsx` is the live reference.
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
 *
 * **Three terminal shapes, not two.** Plan
 * `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
 * Phase 4 adds `withdrawn`: a question retired because its premise died rather
 * than because anyone decided anything. It dims like an answered row and shows
 * its `withdrawal_reason` in the same detail slot an answered row shows its
 * response (`coord-question-withdrawal`, beside `coord-question-response`), so
 * a retirement is legible instead of a silent disappearance. That block is
 * `QuestionWithdrawalRecord`, shared with the detail route — the two surfaces
 * must not drift about what a withdrawal looks like.
 *
 * **Decision effects.** Plan
 * `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
 * Phases 2–3: a row whose `effect_kind` is not `none` mirrors a decision
 * another table owns (an `operator_approval` gate, a policy proposal). It
 * carries a `<QuestionEffectChip>` in the status slot, and its expanded detail
 * links to the effect's own page. A row with no effect — every row from a coord
 * build that predates the columns — renders exactly as before.
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
} from "@/components/console";
import {
  QUESTION_STATUS_PALETTE,
  QUESTION_TERMINAL_KINDS,
  deriveQuestionStatus,
  optionLabels,
  questionIdentity,
  truncate,
  type AgentQuestionRow,
} from "@/components/admin/coord/questionStatus";
import { QuestionWithdrawalRecord } from "@/components/admin/coord/QuestionWithdrawalRecord";
import { QuestionEffectChip } from "@/components/admin/coord/QuestionEffectChip";
import {
  deriveQuestionEffect,
  effectDecisionsFor,
} from "@/components/admin/coord/questionEffect";

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
  // Read the classification off the derivation, never off the raw columns.
  // `status.kind` already IS the answer — a withdrawn row keeps `responded_at`
  // NULL, and `deriveQuestionStatus` tests `withdrawn_at` first, so a row that
  // somehow carried both stamps is withdrawn to every consumer at once. Two
  // booleans over `question.*` would re-derive the same thing beside it, which
  // is exactly how this file and the detail route came apart in review: the
  // derivation went three-valued while a sibling predicate stayed two-valued.
  const withdrawn = status.kind === "withdrawn";
  const answered = status.kind === "answered";
  // Both terminal states dim the row: nobody is waiting on either. Membership
  // in the audited table rather than `withdrawn || answered`, so a sixth kind's
  // terminality is decided once, at `QUESTION_TERMINAL_KINDS`, instead of
  // re-inferred here and in the detail route.
  const terminal = QUESTION_TERMINAL_KINDS.has(status.kind);
  const options = optionLabels(question);
  const effect = deriveQuestionEffect(question);
  // The same decision gate the detail page applies: only a row whose own
  // options match the known vocabulary is described as button-decidable.
  const { decisions } = effectDecisionsFor(effect, question.options ?? null);

  return (
    <RecordRow
      data-testid="coord-question-card"
      rowKey={question.question_id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      className={terminal ? "opacity-70 hover:opacity-100" : undefined}
      identity={questionIdentity(question)}
      label={<span title={question.question}>{truncate(question.question, 160)}</span>}
      status={
        <span className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={status} palette={QUESTION_STATUS_PALETTE} />
          {/* Unlinked here: the collapsed row is one <button>, and a link
              inside it would be nested interactive content. The expanded
              detail's actions carry the link. */}
          <QuestionEffectChip effect={effect} />
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
            {effect?.href && (
              <Link
                href={effect.href}
                data-testid="coord-question-effect-link"
                title={effect.title}
              >
                <Button variant="outline" size="sm">
                  Open {effect.label}
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            )}
            {!terminal && (
              <span className="text-xs text-muted-foreground">
                {decisions
                  ? `decide it (${decisions.map((d) => d.value).join(" / ")}) on the detail page`
                  : "the response composer lives on the detail page"}
              </span>
            )}
          </div>
        }
        history={
          withdrawn ? (
            // The retirement record, in the slot the answered row uses for its
            // response — because it answers the same operator question ("what
            // happened to this?"), just with a reason instead of a decision.
            // Shared with the detail route rather than copied: see
            // `QuestionWithdrawalRecord`.
            <QuestionWithdrawalRecord
              question={question}
              testId="coord-question-withdrawal"
            />
          ) : answered ? (
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
