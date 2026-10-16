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
 * Keyboard (WCAG 2.1.4): the single-key shortcuts act only while the pair
 * card has focus, and the card carries a visible toggle that turns them off
 * (remembered per browser). A held key never repeats an answer.
 *
 * What it cannot show yet, and says on the card: in-situ captures need plan
 * Phase 18, so each pair is shown bare; studio's pushes start with Phase 20,
 * so the queue today is the calibration batch.
 *
 * Chrome (R9): no page title — the console shell renders it.
 */

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HealthStrip, RefreshButton } from "@/components/console";
import { Button } from "@/components/ui/button";
import type { TasteLabel, TasteReason } from "@/lib/api/taste";
import { EMPTY_DRAFT, PairCard, type PairDraft } from "./_components/PairCard";
import { RecentLabels } from "./_components/RecentLabels";
import { SetupPanel } from "./_components/SetupPanel";
import { useTasteInbox } from "./_hooks/useTasteInbox";
import {
  deriveTasteHealth,
  newestOwnLabel,
  resolveKey,
} from "./_lib/tasteInbox";

/** Where the shortcut toggle is remembered — a per-browser convenience. */
const SHORTCUTS_STORAGE_KEY = "coord-taste-shortcuts";

function readShortcutsPreference(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeShortcutsPreference(on: boolean): void {
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: the toggle still works for this visit.
  }
}

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
  const cardRef = useRef<HTMLElement>(null);

  const [shortcutsOn, setShortcutsOn] = useState(true);
  useEffect(() => setShortcutsOn(readShortcutsPreference()), []);
  const changeShortcuts = useCallback((on: boolean) => {
    setShortcutsOn(on);
    writeShortcutsPreference(on);
  }, []);

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

  /** `u`: the newest label THIS viewer gave — never a colleague's. */
  const ownLast = newestOwnLabel(inbox?.recent ?? [], inbox?.viewer_user_id);
  const undoOwnLast = useCallback(() => {
    if (ownLast && !busy) void undo(ownLast.id);
  }, [ownLast, busy, undo]);

  const onCardKey = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // A held key repeats keydown; an answer is given once per press.
      if (!canLabel || !shortcutsOn || event.repeat) return;
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
      event.preventDefault();
      switch (action.kind) {
        case "leaveField":
          // Back to the card, so the next key still reaches it.
          cardRef.current?.focus();
          break;
        case "undo":
          undoOwnLast();
          break;
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
    },
    [canLabel, shortcutsOn, vocabulary, choose, skipHead, undoOwnLast]
  );

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
          cardRef={cardRef}
          onKeyDown={onCardKey}
          shortcutsOn={shortcutsOn}
          onShortcutsChange={changeShortcuts}
          canUndoOwn={ownLast !== null}
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
          viewerUserId={inbox?.viewer_user_id ?? null}
          busy={busy}
          onUndo={(id, force) => void undo(id, force)}
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
