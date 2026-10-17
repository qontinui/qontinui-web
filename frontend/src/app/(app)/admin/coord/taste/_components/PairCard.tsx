"use client";

import type { KeyboardEvent, RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TasteLabel, TastePair, TasteReason } from "@/lib/api/taste";
import {
  REASON_LABEL,
  SOURCE_LABEL,
  bareNote,
  pairContext,
  reasonKey,
} from "../_lib/tasteInbox";
import { TasteImageView } from "./TasteImageView";

export interface PairDraft {
  reasons: TasteReason[];
  comment: string;
  editNote: string;
}

export const EMPTY_DRAFT: PairDraft = {
  reasons: [],
  comment: "",
  editNote: "",
};

/** A keyboard hint, rendered beside the control it names. */
function Key({ children }: { children: string }) {
  return (
    <kbd className="ml-1.5 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/**
 * The pair at the head of the queue: A and B side by side, the reason chips,
 * the comment and the edit, and the four answers. Presentational — the page
 * owns the draft and the keyboard, so a key and a click do exactly the same
 * thing. The keys act only while this card has focus (it is focusable
 * itself), and only while the page's "Keyboard shortcuts" toggle is on; the
 * key hints show only while they would work.
 *
 * A viewer who may not label sees the pair and is told why there are no
 * controls, rather than meeting buttons that would 403.
 */
export function PairCard({
  pair,
  canLabel,
  busy,
  vocabulary,
  draft,
  onDraft,
  onChoose,
  onSkip,
  commentRef,
  editRef,
  cardRef,
  onKeyDown,
  shortcutsOn,
}: {
  pair: TastePair;
  canLabel: boolean;
  busy: boolean;
  vocabulary: readonly TasteReason[];
  draft: PairDraft;
  onDraft: (next: PairDraft) => void;
  onChoose: (choice: TasteLabel) => void;
  onSkip: () => void;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  editRef: RefObject<HTMLTextAreaElement | null>;
  cardRef: RefObject<HTMLElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** The page's shortcut toggle (rendered by the page's ShortcutsBar). */
  shortcutsOn: boolean;
}) {
  const keys = canLabel && shortcutsOn;
  const bare = bareNote(pair);
  const toggle = (reason: TasteReason) =>
    onDraft({
      ...draft,
      reasons: draft.reasons.includes(reason)
        ? draft.reasons.filter((r) => r !== reason)
        : [...draft.reasons, reason],
    });

  return (
    <section
      ref={cardRef}
      tabIndex={canLabel ? 0 : undefined}
      onKeyDown={canLabel ? onKeyDown : undefined}
      className="space-y-3 rounded-md border border-border bg-card/30 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      data-testid="taste-pair-card"
      data-pair-id={pair.id}
      aria-label="The pair to label"
      aria-keyshortcuts={
        keys ? "a b x s c e u 1 2 3 4 5 6 7 8 9 0 Escape" : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className="font-mono text-[11px]">
          {SOURCE_LABEL[pair.source]}
        </Badge>
        <span className="truncate text-muted-foreground">
          {pairContext(pair)}
        </span>
        {pair.skip_count > 0 && (
          <Badge
            variant="outline"
            className="font-mono text-[11px] text-muted-foreground"
            data-testid="taste-pair-skipped"
          >
            skipped {pair.skip_count}×
          </Badge>
        )}
      </div>

      {bare && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="taste-bare-notice"
        >
          {bare}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TasteImageView side="A" image={pair.asset_a} />
        <TasteImageView side="B" image={pair.asset_b} />
      </div>

      {canLabel ? (
        <>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Reasons"
            data-testid="taste-reasons"
          >
            {vocabulary.map((reason, i) => {
              const on = draft.reasons.includes(reason);
              const key = reasonKey(i);
              return (
                <Button
                  key={reason}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  onClick={() => toggle(reason)}
                  data-testid={`taste-reason-${reason}`}
                >
                  {REASON_LABEL[reason]}
                  {keys && key && <Key>{key}</Key>}
                </Button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Comment {keys && <Key>c</Key>}</span>
              <Textarea
                ref={commentRef}
                value={draft.comment}
                maxLength={2000}
                rows={2}
                onChange={(e) => onDraft({ ...draft, comment: e.target.value })}
                placeholder="Why — in your words (optional)"
                data-testid="taste-comment"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>What you would change {keys && <Key>e</Key>}</span>
              <Textarea
                ref={editRef}
                value={draft.editNote}
                maxLength={2000}
                rows={2}
                onChange={(e) =>
                  onDraft({ ...draft, editNote: e.target.value })
                }
                placeholder="An edit beats a rating — crop, palette, subject (optional)"
                data-testid="taste-edit"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => onChoose("a")}
              data-testid="taste-choose-a"
            >
              A is better {keys && <Key>a / ←</Key>}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => onChoose("b")}
              data-testid="taste-choose-b"
            >
              B is better {keys && <Key>b / →</Key>}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onChoose("both_bad")}
              data-testid="taste-choose-both-bad"
            >
              Both bad {keys && <Key>x</Key>}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onSkip}
              data-testid="taste-skip"
            >
              Skip {keys && <Key>s</Key>}
            </Button>
          </div>
        </>
      ) : (
        <p
          className="text-xs text-muted-foreground"
          data-testid="taste-view-only"
        >
          View only: a coord admin of this project gives the labels.
        </p>
      )}
    </section>
  );
}
