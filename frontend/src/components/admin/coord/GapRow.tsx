"use client";

/**
 * GapRow — render + action a single POLICY_GAP report, on one line.
 *
 * Plan `2026-07-18-policy-clause-schema-web-data-model.md` Phase 3, migrated
 * from `GapCard` onto the console primitives by
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1.
 *
 * A gap report is an `agent_questions` row whose `context` carries a
 * `POLICY_GAP` marker (see `policy-gap.ts`). The row surfaces the gap
 * category, the tier the agent auto-applied and whether it is blocking; the
 * proposed clause and the two one-click actions live in the expanded detail:
 *
 *   • Accept as clause → proposed — POST the proposed clause (status forced
 *     to `proposed`) to the Phase-2 clause-create proxy, which inserts the row
 *     and triggers coord's body recompile. On success the gap is marked handled
 *     (the underlying question is answered, when it is still pending).
 *   • Dismiss — answer the question as dismissed (when still pending) and drop
 *     it from the list.
 *
 * Blocking gaps are pending (unanswered); non-blocking gaps arrive PRE-ANSWERED
 * (coord recorded the category-default inline). coord has no gap-handled column
 * (it authors zero coord.* DDL), so for an already-answered gap the respond
 * proxy would 409 — we skip the respond call and hide it client-side instead.
 * Either way the parent is told via `onHandled` so the row leaves the list.
 *
 * **The two action buttons moved behind the click, and that is the design, not
 * a regression.** `<RecordRow>` renders the line as one `<button>` so the
 * expand affordance is keyboard-reachable, and a nested button is invalid
 * HTML — but more to the point, R5 puts actions in the detail because
 * accepting a policy clause is not a thing to do without reading the clause,
 * and the clause is what the detail shows.
 *
 * Every `data-testid` `GapCard` authored is carried across (D4a):
 * `coord-gap-card`, `coord-gap-proposed-clause`, `coord-gap-accept`,
 * `coord-gap-dismiss`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileCheck2, XCircle } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { useAuth } from "@/contexts/auth-context";
import { httpClient } from "@/services/service-factory";
import {
  QUESTION_STATUS_PALETTE,
  deriveGapStatus,
  truncate,
  type AgentQuestionRow,
} from "@/components/admin/coord/questionStatus";
import {
  parseGapContext,
  type ProposedClause,
} from "@/components/admin/coord/policy-gap";

const API = "/api/v1/operations";

/** One labelled row in the proposed-clause readout, omitted when empty. */
function ClauseField({
  label,
  value,
}: {
  label: string;
  value?: string | string[] | null;
}) {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.join(", ") : value;
  if (!text.trim()) return null;
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}

export function GapRow({
  question,
  onHandled,
  expanded,
  onToggle,
}: {
  question: AgentQuestionRow;
  onHandled: (questionId: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<null | "accept" | "dismiss">(null);

  const parsed = parseGapContext(question.context);
  if (!parsed) return null;

  const { gap, originalContext } = parsed;
  const category = gap.category ?? "(uncategorized)";
  const proposed: ProposedClause = gap.proposed_clause ?? {};
  const tierApplied = gap.tier_applied ?? proposed.tier ?? null;
  const answered = Boolean(question.responded_at);
  const operator = user?.email ?? "operator";
  const status = deriveGapStatus(question, category);

  /**
   * Mark the underlying question handled. A still-pending gap gets a durable
   * answer via the respond proxy; an already-answered gap (non-blocking) has
   * no coord state left to change, so we only hide it locally.
   */
  const markHandled = async (note: string) => {
    if (!answered) {
      await httpClient.post(
        `${API}/agent-questions/${encodeURIComponent(
          question.question_id
        )}/respond`,
        { response: note, responded_by_operator: operator }
      );
    }
    onHandled(question.question_id);
  };

  const onAccept = async () => {
    setBusy("accept");
    try {
      // Force status → proposed; default tier to the auto-applied tier.
      const body: ProposedClause = {
        ...proposed,
        status: "proposed",
        tier: proposed.tier ?? tierApplied ?? undefined,
        updated_by: operator,
      };
      // Phase-2 clause-create proxy (raw path — may not be in this branch's
      // OpenAPI client yet; called via the generic http helper).
      await httpClient.post(
        `${API}/coord/prompt-documents/policy/${encodeURIComponent(
          category
        )}/clauses`,
        body
      );
      await markHandled(
        `accepted as proposed clause '${proposed.clause_id ?? "(unnamed)"}' in policy/${category}`
      );
      toast.success(`Clause accepted → proposed in policy/${category}`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to accept gap as clause"
      );
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = async () => {
    setBusy("dismiss");
    try {
      await markHandled("dismissed: gap not accepted as a policy clause");
      toast.success("Gap dismissed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to dismiss gap");
    } finally {
      setBusy(null);
    }
  };

  const hasClause =
    proposed.clause_id !== undefined ||
    Boolean(proposed.trigger) ||
    Boolean(proposed.action) ||
    Boolean(proposed.bounds) ||
    Boolean(proposed.escalate_if);

  return (
    <RecordRow
      data-testid="coord-gap-card"
      rowKey={question.question_id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={category}
      label={
        <span title={question.question}>{truncate(question.question, 160)}</span>
      }
      status={
        <span className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={status} palette={QUESTION_STATUS_PALETTE} />
          {tierApplied && (
            <Badge variant="secondary" className="text-[10px]">
              tier {tierApplied}
            </Badge>
          )}
        </span>
      }
      time={<RowTime at={question.created_at ?? null} verb="Reported" />}
    >
      <RecordDetail
        why={
          <>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {question.question}
            </p>
            {answered && (
              // Ruling 2 of the Wave-1 review: a pre-answered gap is CALM in
              // the badge (nothing is blocked, nothing is lost) but a review
              // is genuinely owed, so the ask is stated HERE in words rather
              // than smuggled into the hue. Amber would have promised the row
              // clears itself, and nothing clears an unreviewed clause.
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-gap-review-owed"
              >
                Not blocking: coord already applied the category default
                inline. A review is still owed —{" "}
                {/* The second clause names BUTTONS, so it may only name the
                    ones that work. `Accept` is disabled without a
                    `clause_id` (see its own `disabled` below), and
                    `hasClause` is satisfied by `trigger`/`action`/`bounds`/
                    `escalate_if` alone — so keying this off `hasClause`
                    would still point at a dead button. Ruling 2 moved the
                    ask out of the hue and into the words, which is exactly
                    what makes the words load-bearing enough to gate. */}
                {proposed.clause_id
                  ? "accept the clause below, or dismiss it."
                  : "there is no clause here that can be accepted, so dismiss it or author one in the prompt-documents editor."}
              </p>
            )}
          </>
        }
        problems={
          hasClause ? (
            <div
              className="rounded-md border border-border bg-muted/40 p-3 space-y-1"
              data-testid="coord-gap-proposed-clause"
            >
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Proposed clause
              </div>
              <ClauseField label="clause_id" value={proposed.clause_id} />
              <ClauseField label="tier" value={proposed.tier ?? tierApplied} />
              <ClauseField label="trigger" value={proposed.trigger} />
              <ClauseField label="action" value={proposed.action} />
              <ClauseField label="bounds" value={proposed.bounds} />
              <ClauseField label="escalate_if" value={proposed.escalate_if} />
              <ClauseField
                label="anti_triggers"
                value={proposed.anti_triggers}
              />
              <ClauseField label="depends_on" value={proposed.depends_on} />
              <ClauseField label="links" value={proposed.links} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No structured clause proposed — dismiss, or author one in the
              prompt-documents editor.
            </p>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onAccept}
              disabled={busy !== null || !proposed.clause_id}
              data-testid="coord-gap-accept"
              title={
                proposed.clause_id
                  ? "Insert the proposed clause with status=proposed and recompile the policy body"
                  : "Proposed clause has no clause_id — cannot create"
              }
            >
              <FileCheck2 className="h-3.5 w-3.5 mr-1" />
              {busy === "accept" ? "Accepting…" : "Accept as clause → proposed"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDismiss}
              disabled={busy !== null}
              data-testid="coord-gap-dismiss"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
            </Button>
          </div>
        }
        history={
          originalContext ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Original context</summary>
              <p className="mt-1 whitespace-pre-wrap">{originalContext}</p>
            </details>
          ) : undefined
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            question {question.question_id} · policy/{category}
          </div>
        }
      />
    </RecordRow>
  );
}
