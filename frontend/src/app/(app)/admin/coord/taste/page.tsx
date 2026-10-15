"use client";

/**
 * /admin/coord/taste — the taste inbox.
 *
 * Phase 23 of plan `2026-10-13-image-generation-and-visual-judgment`. Taste is
 * bootstrapped asynchronously (decision D3): nothing waits on the operator.
 * He answers pairwise questions — which of two images is better, or both bad
 * — with reason chips, a comment and an edit, keyboard first; the taste twin
 * (Phase 24) learns from the answers.
 *
 * Authz: like every `/admin/coord` page, any tenant member may VIEW it; label
 * writes, skips, the budget and the calibration build are gated by
 * coord-tenant admin on the backend (`require_coord_tenant_admin_target`),
 * and only reflected here via the inbox's `can_label`.
 *
 * What it cannot show yet, and says on the card: in-situ captures need plan
 * Phase 18, so each pair is shown bare; studio's pushes start with Phase 20,
 * so the queue today is the calibration batch.
 *
 * Chrome (R9): no page title — the console shell renders it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HealthStrip, RefreshButton } from "@/components/console";
import { Button } from "@/components/ui/button";
import type { TasteLabel, TasteReason } from "@/lib/api/taste";
import { EMPTY_DRAFT, PairCard, type PairDraft } from "./_components/PairCard";
import { RecentLabels } from "./_components/RecentLabels";
import { SetupPanel } from "./_components/SetupPanel";
import { useTasteInbox } from "./_hooks/useTasteInbox";
import { deriveTasteHealth, resolveKey } from "./_lib/tasteInbox";

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    (target.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit", "file"].includes(
        (target as HTMLInputElement).type
      ))
  );
}

export default function TasteInboxPage() {
  const {
    inbox,
    readError,
    busy,
    overBudget,
    setOverBudget,
    refresh,
    label,
    skip,
    undo,
    buildBatch,
    setBudget,
    uploadReferences,
  } = useTasteInbox();

  const head = inbox?.pairs[0] ?? null;
  const canLabel = inbox?.can_label === true;
  const vocabulary: readonly TasteReason[] = useMemo(
    () => inbox?.reason_vocabulary ?? [],
    [inbox]
  );
  const health = useMemo(
    () => deriveTasteHealth(inbox, readError),
    [inbox, readError]
  );

  // The draft belongs to the pair on the card: a new head starts clean.
  const [draft, setDraft] = useState<PairDraft>(EMPTY_DRAFT);
  const headId = head?.id ?? null;
  useEffect(() => setDraft(EMPTY_DRAFT), [headId]);

  const commentRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const choose = useCallback(
    (choice: TasteLabel) => {
      if (!head || busy) return;
      void label(head.id, {
        choice,
        reasons: draft.reasons,
        comment: draft.comment.trim() || null,
        edit_note: draft.editNote.trim() || null,
        relabel: false,
      });
    },
    [head, busy, label, draft]
  );

  const skipHead = useCallback(() => {
    if (head && !busy) void skip(head.id);
  }, [head, busy, skip]);

  const undoLast = useCallback(() => {
    const last = inbox?.recent[0];
    if (last && !busy) void undo(last.id);
  }, [inbox, busy, undo]);

  useEffect(() => {
    if (!canLabel) return;
    const onKey = (event: KeyboardEvent) => {
      const action = resolveKey(
        {
          key: event.key,
          inTextField: isTextField(event.target),
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
        vocabulary
      );
      if (!action) return;
      if (action.kind === "leaveField") {
        (event.target as HTMLElement).blur();
        return;
      }
      // Focus moves and undo work with or without a pair on the card; the
      // rest act on the head pair only.
      if (action.kind === "undo") {
        event.preventDefault();
        undoLast();
        return;
      }
      if (!head) return;
      event.preventDefault();
      switch (action.kind) {
        case "choose":
          choose(action.choice);
          break;
        case "skip":
          skipHead();
          break;
        case "toggleReason":
          setDraft((d) => ({
            ...d,
            reasons: d.reasons.includes(action.reason)
              ? d.reasons.filter((r) => r !== action.reason)
              : [...d.reasons, action.reason],
          }));
          break;
        case "focusComment":
          commentRef.current?.focus();
          break;
        case "focusEdit":
          editRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canLabel, vocabulary, head, choose, skipHead, undoLast]);

  const budgetSpent =
    inbox !== null &&
    inbox.budget.remaining === 0 &&
    inbox.pending_total > 0 &&
    !overBudget;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-taste-page">
      <div className="flex items-center gap-2">
        <HealthStrip
          level={health.level}
          headline={health.headline}
          detail={health.detail}
          badges={health.badges}
          className="flex-1"
          data-testid="taste-health"
        />
        <RefreshButton
          onRefresh={refresh}
          label="Refresh the taste inbox"
          title="Re-reads the queue, the budget and the recent labels"
          data-testid="taste-refresh"
        />
      </div>

      {head ? (
        <PairCard
          pair={head}
          canLabel={canLabel}
          busy={busy}
          vocabulary={vocabulary}
          draft={draft}
          onDraft={setDraft}
          onChoose={choose}
          onSkip={skipHead}
          commentRef={commentRef}
          editRef={editRef}
        />
      ) : budgetSpent ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/30 p-3 text-sm"
          data-testid="taste-budget-spent"
        >
          <span>
            This week&apos;s budget of {inbox?.budget.weekly_budget} labels is
            given. {inbox?.pending_total} more{" "}
            {inbox?.pending_total === 1 ? "pair waits" : "pairs wait"}; nothing
            blocks on them.
          </span>
          {canLabel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOverBudget(true)}
              data-testid="taste-keep-going"
            >
              Keep labelling anyway
            </Button>
          )}
        </div>
      ) : inbox ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="taste-queue-empty"
        >
          No pair is waiting. Studio adds pairs where its judges disagree once
          the judge panel ships (plan Phase 20); until then the queue is the
          calibration batch below.
        </p>
      ) : null}

      <section className="space-y-2" aria-label="Recent labels">
        <h2 className="text-sm font-semibold">Recent labels</h2>
        <RecentLabels
          recent={inbox?.recent ?? []}
          loaded={inbox !== null}
          canLabel={canLabel}
          busy={busy}
          onUndo={(id) => void undo(id)}
        />
      </section>

      <SetupPanel
        pool={inbox?.pool ?? null}
        budget={inbox?.budget ?? null}
        canLabel={canLabel}
        busy={busy}
        onBuild={(size) => void buildBatch(size)}
        onUpload={(files) => void uploadReferences(files)}
        onBudget={(weekly) => void setBudget(weekly)}
      />
    </div>
  );
}
