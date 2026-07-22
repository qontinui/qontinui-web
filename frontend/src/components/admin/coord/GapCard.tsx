"use client";

/**
 * GapCard — render + action a single POLICY_GAP report.
 *
 * Plan `2026-07-18-policy-clause-schema-web-data-model.md` Phase 3.
 *
 * A gap report is an `agent_questions` row whose `context` carries a
 * `POLICY_GAP` marker (see `policy-gap.ts`). The card surfaces the gap
 * category, the tier the agent auto-applied, the proposed clause (rendered
 * readably), and two one-click actions:
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
 */

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileCheck2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { httpClient } from "@/services/service-factory";
import {
  formatRelative,
  type AgentQuestionRow,
} from "@/components/admin/coord/QuestionCard";
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

export function GapCard({
  question,
  onHandled,
}: {
  question: AgentQuestionRow;
  onHandled: (questionId: string) => void;
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

  return (
    <Card data-testid="coord-gap-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="default">gap</Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {category}
          </Badge>
          {tierApplied && (
            <Badge variant="secondary" className="text-xs">
              tier {tierApplied}
            </Badge>
          )}
          {answered ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              pre-answered
            </span>
          ) : (
            <span className="text-xs text-amber-500">blocking</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatRelative(question.created_at)}
          </span>
        </div>

        <p className="text-sm text-foreground">{question.question}</p>

        {proposed.clause_id !== undefined ||
        proposed.trigger ||
        proposed.action ||
        proposed.bounds ||
        proposed.escalate_if ? (
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
            <ClauseField label="anti_triggers" value={proposed.anti_triggers} />
            <ClauseField label="depends_on" value={proposed.depends_on} />
            <ClauseField label="links" value={proposed.links} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No structured clause proposed — dismiss, or author one in the
            prompt-documents editor.
          </p>
        )}

        {originalContext && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Original context</summary>
            <p className="mt-1 whitespace-pre-wrap">{originalContext}</p>
          </details>
        )}

        <div className="flex items-center gap-2 pt-1">
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
      </CardContent>
    </Card>
  );
}
