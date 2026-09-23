"use client";

/**
 * QuestionWithdrawalRecord — the retirement record for a withdrawn
 * `coord.agent_questions` row, rendered identically wherever it appears.
 *
 * Plan
 * `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
 * Phase 4. Two surfaces show this block — the inbox row's detail
 * (`QuestionRow`) and the detail route's terminal section
 * (`/admin/coord/questions/[id]`) — and they must not disagree about what a
 * withdrawal looks like or about what an ABSENT reason means. A status render
 * duplicated across two files is exactly what drifts, so there is one
 * component and no second copy.
 *
 * It answers the same operator question an answered row's response block
 * answers — *"what happened to this?"* — with a reason instead of a decision,
 * which is why both surfaces put it in the slot they use for that response.
 */

import { RowTime } from "@/components/console";
import type { AgentQuestionRow } from "@/components/admin/coord/questionStatus";

export function QuestionWithdrawalRecord({
  question,
  testId,
  className = "text-xs",
}: {
  question: Pick<
    AgentQuestionRow,
    "withdrawn_at" | "withdrawn_by" | "withdrawal_reason"
  >;
  /**
   * The surface's own hook. Required rather than defaulted: the two callers
   * are distinguishable in a test only if each names itself, and a shared
   * default would silently make `getByTestId` ambiguous the day both render.
   */
  testId: string;
  className?: string;
}) {
  return (
    <div className={className} data-testid={testId}>
      <span className="text-muted-foreground">Withdrawn </span>
      <RowTime at={question.withdrawn_at ?? null} verb="Withdrawn" />
      {question.withdrawn_by && (
        <span className="text-muted-foreground"> by {question.withdrawn_by}</span>
      )}
      <p className="mt-1 whitespace-pre-wrap text-foreground/90">
        {question.withdrawal_reason ? (
          question.withdrawal_reason
        ) : (
          // Coord requires a reason on the withdrawal door, so an absent one
          // is a statement about THIS read, never a withdrawal that had no
          // cause. Saying nothing here would read as the latter.
          <span className="text-muted-foreground italic">
            coord recorded no reason for this withdrawal
          </span>
        )}
      </p>
    </div>
  );
}
