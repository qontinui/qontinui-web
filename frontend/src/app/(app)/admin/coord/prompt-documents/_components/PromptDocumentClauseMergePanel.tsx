"use client";

import { useMemo } from "react";
import { AlertTriangle, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DIFF_ADDED_COUNT_CLASS,
  DIFF_REMOVED_COUNT_CLASS,
  DiffTable,
  diffLines,
} from "@/components/console";
import {
  canApplyMerge,
  clauseText,
  mergeSummary,
  resolutionFor,
  resultingSide,
  unresolvedConflicts,
} from "../_lib/clauseMerge";
import type {
  ClauseConflictChoice,
  ClauseMergeEntry,
  ClauseMergePreview,
} from "../types";
import {
  CLAUSE_CONFLICT_REASON_LABEL,
  CLAUSE_MERGE_DECISION_LABEL,
  CLAUSE_MERGE_FALLBACK_LABEL,
} from "../types";

interface PromptDocumentClauseMergePanelProps {
  preview: ClauseMergePreview;
  /** The operator's choice per CONFLICTED clause name, so far. */
  resolutions: Record<string, ClauseConflictChoice>;
  onResolve: (clause: string, choice: ClauseConflictChoice) => void;
  /** True while the apply is in flight — freezes the choice controls. */
  saving?: boolean;
}

/**
 * The clause-grained three-way merge view (plan
 * `2026-09-04-cross-tenant-policy-publishing` Phase 7): one row per clause
 * NAME with what coord decided, and — for a clause that changed on both sides
 * — the choice coord refuses to make.
 *
 * ## Conflicts are asked, never defaulted
 *
 * Coord's `ClauseMergePlan::resolve` has no default arm: a conflicted clause
 * with no explicit choice fails the whole merge (`409 unresolved_conflicts`)
 * rather than quietly taking a side. This panel is built to the same rule —
 * nothing pre-selects a radio, the "after" preview of an unchosen conflict is
 * EMPTY rather than one side, and the apply control (rendered by the dialog)
 * is withheld until every conflict has a choice. Pre-selecting "upstream" for
 * convenience would be exactly the silent side-pick the design refuses.
 *
 * ## UNKNOWN base
 *
 * When coord could resolve no base (`base_known: false`) the only fact it can
 * prove is byte equality, so every non-identical clause arrives as a conflict
 * with reason `baseline_unknown`. The header says so in coord's own words,
 * because a wall of conflicts with no explanation reads as "everything
 * changed" when the truth is "nothing is provable".
 *
 * ## Whole-body fallback
 *
 * A pair that does not decompose into clauses on both sides has no clause
 * merge; coord says why and this panel relays it, pointing back at the
 * whole-body Adopt / Keep-mine pair the dialog already offers.
 */
export function PromptDocumentClauseMergePanel({
  preview,
  resolutions,
  onResolve,
  saving = false,
}: PromptDocumentClauseMergePanelProps) {
  const summary = useMemo(() => mergeSummary(preview), [preview]);
  const unresolved = useMemo(
    () => unresolvedConflicts(preview, resolutions),
    [preview, resolutions]
  );

  const baseCaption =
    preview.base_source === "tracked_publication"
      ? `base: publication v${preview.base_publication_version ?? preview.tracked_publication_version ?? "?"} (the one this document tracks)`
      : preview.base_source === "code_seed"
        ? "base: the compiled-in default this document was seeded from"
        : "base: none could be established";

  if (preview.mode === "whole_body") {
    return (
      <div
        className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
        data-testid="clause-merge-whole-body"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">
            This pair cannot be merged clause by clause.
          </p>
          <p>{CLAUSE_MERGE_FALLBACK_LABEL[preview.fallback.reason]}</p>
          {"detail" in preview.fallback ? (
            <p className="text-xs opacity-90">{preview.fallback.detail}</p>
          ) : null}
          <p className="text-xs opacity-90">
            Use <span className="font-medium">Adopt</span> or{" "}
            <span className="font-medium">Keep mine</span> on the comparison
            instead — those decide the whole body.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
        data-testid="clause-merge-summary"
      >
        <GitMerge className="size-3.5 text-muted-foreground" />
        <span className="font-medium">
          Publication v{preview.publication_version}, clause by clause
        </span>
        <span className="text-muted-foreground">{baseCaption}</span>
        <span className="ml-auto flex flex-wrap gap-x-3">
          <span>{summary.unchanged} unchanged</span>
          <span className={DIFF_ADDED_COUNT_CLASS}>
            {summary.takingUpstream} from upstream
          </span>
          <span>{summary.keepingLocal} yours</span>
          <span
            className={cn(
              summary.conflicts > 0 &&
                "font-medium text-amber-700 dark:text-amber-300"
            )}
          >
            {summary.conflicts} need a choice
          </span>
        </span>
      </div>

      {!preview.base_known && (
        <div
          className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="clause-merge-base-unknown"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>
            {preview.base_unknown_reason ??
              "No base could be established for this document."}{" "}
            Without a base coord cannot tell which side moved, so every clause
            that differs is yours to decide — it is not claiming that they all
            changed.
          </p>
        </div>
      )}

      {preview.noop && (
        <p
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
          data-testid="clause-merge-noop"
        >
          Every clause is already identical to the publication. There is nothing
          to merge; only the tracked version differs, which{" "}
          <span className="font-medium">Keep mine</span> records.
        </p>
      )}

      <ol
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        data-testid="clause-merge-entries"
      >
        {preview.entries.map((entry) => (
          <li key={entry.clause}>
            <ClauseMergeRow
              entry={entry}
              choice={resolutionFor(resolutions, entry.clause)}
              onResolve={onResolve}
              disabled={saving}
            />
          </li>
        ))}
      </ol>

      {unresolved.length > 0 && (
        <p
          className="shrink-0 text-xs text-muted-foreground"
          data-testid="clause-merge-unresolved"
        >
          Still needing a choice: {unresolved.join(", ")}. Coord will not pick a
          side for you.
        </p>
      )}
      {canApplyMerge(preview, resolutions) && (
        <p className="shrink-0 text-xs text-muted-foreground">
          Every clause is decided. Merging lands one new version; your current
          wording stays in history.
        </p>
      )}
    </div>
  );
}

interface ClauseMergeRowProps {
  entry: ClauseMergeEntry;
  choice: ClauseConflictChoice | undefined;
  onResolve: (clause: string, choice: ClauseConflictChoice) => void;
  disabled: boolean;
}

/**
 * One clause. A decided row folds its "before → after" diff behind a
 * disclosure; a conflicted row is open, with the two sides as radio cards
 * and the diff between them, so the operator reads what they are choosing
 * between rather than a label for it.
 */
function ClauseMergeRow({
  entry,
  choice,
  onResolve,
  disabled,
}: ClauseMergeRowProps) {
  const isConflict = entry.decision === "conflict";
  const localText = clauseText(entry.local);
  const upstreamText = clauseText(entry.upstream);
  const after = resultingSide(entry, choice);
  const changeDiff = useMemo(
    () =>
      isConflict
        ? diffLines(localText, upstreamText)
        : diffLines(localText, clauseText(after)),
    [isConflict, localText, upstreamText, after]
  );

  const tone = isConflict
    ? "border-amber-500/50"
    : entry.decision === "unchanged"
      ? "border-border opacity-80"
      : "border-border";

  return (
    <div
      className={cn("rounded-lg border", tone)}
      data-testid={`clause-merge-entry-${entry.clause}`}
      data-decision={entry.decision}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <code className="font-mono text-xs">{entry.clause}</code>
        <span
          className={cn(
            "text-xs",
            isConflict
              ? "font-medium text-amber-700 dark:text-amber-300"
              : "text-muted-foreground"
          )}
        >
          {CLAUSE_MERGE_DECISION_LABEL[entry.decision]}
        </span>
        {isConflict && entry.conflict_reason ? (
          <span className="text-xs text-muted-foreground">
            — {CLAUSE_CONFLICT_REASON_LABEL[entry.conflict_reason]}
          </span>
        ) : null}
        {!isConflict && !changeDiff.stats.identical ? (
          <span className="ml-auto flex gap-2 text-xs">
            <span className={DIFF_ADDED_COUNT_CLASS}>
              +{changeDiff.stats.added}
            </span>
            <span className={DIFF_REMOVED_COUNT_CLASS}>
              −{changeDiff.stats.removed}
            </span>
          </span>
        ) : null}
      </div>

      {isConflict ? (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={`Resolve clause ${entry.clause}`}
          >
            <ChoiceCard
              clause={entry.clause}
              value="local"
              label={entry.local ? "Keep yours" : "Keep it removed (yours)"}
              text={localText}
              selected={choice === "local"}
              disabled={disabled}
              onSelect={onResolve}
            />
            <ChoiceCard
              clause={entry.clause}
              value="upstream"
              label={
                entry.upstream ? "Take upstream" : "Take the upstream removal"
              }
              text={upstreamText}
              selected={choice === "upstream"}
              disabled={disabled}
              onSelect={onResolve}
            />
          </div>
          {!changeDiff.stats.identical && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Yours → upstream, line by line (
                <span className={DIFF_ADDED_COUNT_CLASS}>
                  +{changeDiff.stats.added}
                </span>{" "}
                <span className={DIFF_REMOVED_COUNT_CLASS}>
                  −{changeDiff.stats.removed}
                </span>
                )
              </summary>
              <div className="mt-1 overflow-hidden rounded-md border border-border">
                <DiffTable lines={changeDiff.lines} />
              </div>
            </details>
          )}
        </div>
      ) : !changeDiff.stats.identical ? (
        <details className="border-t border-border px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            What changes here
          </summary>
          <div className="mt-1 overflow-hidden rounded-md border border-border">
            <DiffTable lines={changeDiff.lines} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

interface ChoiceCardProps {
  clause: string;
  value: ClauseConflictChoice;
  label: string;
  /** The clause as text on this side; empty when the side is a removal. */
  text: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (clause: string, choice: ClauseConflictChoice) => void;
}

function ChoiceCard({
  clause,
  value,
  label,
  text,
  selected,
  disabled,
  onSelect,
}: ChoiceCardProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-md border px-2.5 py-2 text-xs transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60"
      )}
      data-testid={`clause-merge-choice-${clause}-${value}`}
    >
      <span className="flex items-center gap-2 font-medium">
        <input
          type="radio"
          name={`clause-merge-${clause}`}
          value={value}
          checked={selected}
          disabled={disabled}
          onChange={() => onSelect(clause, value)}
          className="accent-primary"
        />
        {label}
      </span>
      {text ? (
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-muted-foreground">
          {text}
        </pre>
      ) : (
        <span className="italic text-muted-foreground">
          (the clause is absent on this side)
        </span>
      )}
    </label>
  );
}
