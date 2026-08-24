"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { History, Loader2, Undo2 } from "lucide-react";
import { diffLines } from "../_lib/diff";
import { validateBodyForKind } from "../_lib/sessionBriefingBody";
import type {
  ListVersionsResponse,
  PromptDocumentKind,
  PromptDocumentVersion,
  PromptDocumentVersionMeta,
} from "../types";

interface PromptDocumentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The document whose history is shown. `null` closes the view.
   *
   * `hasDefault` is the document's `default_source != null` — carried here
   * only so a BLOCKED restore can say whether the one door coord leaves open
   * exists for this document. See `restoreBlockedByContent` below.
   *
   * Optional, and its absence FAILS CLOSED: an omitted value suppresses the
   * sentence rather than asserting a control that may not be there. Naming a
   * missing button to an operator who has just been refused would be a second
   * dead end, which is the exact thing that sentence exists to remove.
   */
  target: {
    kind: PromptDocumentKind;
    name: string;
    label: string;
    hasDefault?: boolean;
  } | null;
  /** The document's CURRENT body — the right-hand side of every diff. */
  currentBody: string;
  currentVersion: number;
  fetchVersions: (
    kind: PromptDocumentKind,
    name: string
  ) => Promise<ListVersionsResponse | null>;
  fetchVersion: (
    kind: PromptDocumentKind,
    name: string,
    version: number
  ) => Promise<PromptDocumentVersion | null>;
  /** True while a restore is in flight (the parent's shared saving flag). */
  saving?: boolean;
  /**
   * Roll the document back to `version`. Resolves `true` on success, at which
   * point the parent has re-fetched the document, so this dialog re-renders
   * against the new current version.
   */
  onRestoreVersion?: (
    kind: PromptDocumentKind,
    name: string,
    version: number,
    changeNote: string
  ) => Promise<boolean>;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Version history for one prompt document: the version list on the left, and a
 * line diff of the selected version against the CURRENT body on the right.
 *
 * Reversibility + honesty: every prior wording stays readable, each tagged with
 * who edited it and when, so an edit is never a one-way door. The diff is
 * computed client-side (`_lib/diff.ts`) — both sides are already in memory and
 * prompt documents are prose-sized, so there is no round-trip and no new
 * dependency.
 *
 * The diff is also what makes the Restore action safe to offer here rather than
 * from the list: you decide to roll back while looking at exactly what rolling
 * back would change.
 */
export function PromptDocumentHistoryDialog({
  open,
  onOpenChange,
  target,
  currentBody,
  currentVersion,
  fetchVersions,
  fetchVersion,
  saving = false,
  onRestoreVersion,
}: PromptDocumentHistoryDialogProps) {
  const [versions, setVersions] = useState<PromptDocumentVersionMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<PromptDocumentVersion | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoreNote, setRestoreNote] = useState("");

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoadingList(true);
    setSelected(null);
    setSnapshot(null);
    fetchVersions(target.kind, target.name)
      .then((data) => {
        if (cancelled) return;
        const rows = data?.versions ?? [];
        setVersions(rows);
        // Default to the newest version that is NOT the current one — the most
        // useful diff is "what did my last edit change".
        const prior = rows.find((v) => v.version_number !== currentVersion);
        setSelected(prior?.version_number ?? rows[0]?.version_number ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target, currentVersion, fetchVersions]);

  // Any change of document, version selection, or close abandons a half-started
  // restore — a confirmation left standing over a different version than the
  // one it was opened for would restore something the operator never looked at.
  useEffect(() => {
    setConfirmingRestore(false);
  }, [open, target, selected]);

  const loadSnapshot = useCallback(
    async (version: number) => {
      if (!target) return;
      setLoadingSnapshot(true);
      const data = await fetchVersion(target.kind, target.name, version);
      setSnapshot(data);
      setLoadingSnapshot(false);
    },
    [target, fetchVersion]
  );

  useEffect(() => {
    if (!open || selected === null) return;
    loadSnapshot(selected);
  }, [open, selected, loadSnapshot]);

  const diff = useMemo(
    () => (snapshot ? diffLines(snapshot.body, currentBody) : null),
    [snapshot, currentBody]
  );

  /**
   * A stored snapshot that today's content rules would refuse.
   *
   * Coord re-validates the SNAPSHOT on restore (`restore_version` calls
   * `validate_body_for_kind`), and does so deliberately: the body was vetted
   * against the rules as they stood when it was written, and rules tighten — a
   * lowered cap, a retired placeholder, a new identity shape. Restore-version
   * is exactly the door an operator reaches for after a bad edit, so without
   * that check it would be the legal path back to a body coord now refuses.
   *
   * Which means a restore CAN fail on a body the operator did not author and
   * is looking straight at in the diff. The snapshot is already in memory by
   * the time the control is offered, so the reason belongs next to the button
   * rather than in a toast after the round-trip.
   */
  const snapshotError = useMemo(
    () =>
      target && snapshot
        ? validateBodyForKind(target.kind, snapshot.body)
        : null,
    [target, snapshot]
  );

  /**
   * Restoring the version that is ALREADY current is a no-op that would still
   * burn a version number, so it is offered only for a genuinely prior one —
   * and only once its snapshot is loaded, so the diff above is describing the
   * change being confirmed.
   */
  const restoreOfferable =
    onRestoreVersion != null &&
    target != null &&
    selected != null &&
    selected !== currentVersion &&
    snapshot != null &&
    !loadingSnapshot;

  const canRestore = restoreOfferable && snapshotError === null;

  /**
   * Split from `canRestore` so the explanation appears ONLY where the control
   * would otherwise have been. Every other reason the control is absent —
   * the selected version is already current, the dialog is read-only, the
   * snapshot is still loading — is self-evident from the list, and explaining
   * a button nobody expected would be noise on the common path.
   */
  const restoreBlockedByContent = restoreOfferable && snapshotError !== null;

  const startRestore = () => {
    setRestoreNote(`Restored from version ${selected}`);
    setConfirmingRestore(true);
  };

  const doRestore = async () => {
    if (!canRestore || !target || selected == null || !onRestoreVersion) return;
    const ok = await onRestoreVersion(
      target.kind,
      target.name,
      selected,
      restoreNote.trim() || `Restored from version ${selected}`
    );
    if (ok) setConfirmingRestore(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        A COLUMN, not the base component's grid, and every child below sized
        against it.

        This dialog previously capped itself at 90vh with `overflow-hidden`
        while stacking a header, a 65vh-tall diff region, the restore
        confirmation and the action row inside it. Past roughly 90vh the
        remainder was simply clipped — and because the cap was
        `overflow-hidden` rather than `overflow-y-auto`, there was no scrolling
        to it either. On a shorter viewport that put the restore
        confirmation's own Cancel and Restore buttons off the bottom of a
        dialog that could not be scrolled: the operator was shown a
        confirmation they could read and could not answer.

        So the diff region flexes and shrinks (`min-h-0 flex-1`) while the
        confirmation and the action row are `shrink-0`. A control that
        confirms a write must never be the thing that gets pushed out of view.
      */}
      <DialogContent
        className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden"
        data-testid="prompt-document-history"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Version history{target ? ` — ${target.label}` : ""}
          </DialogTitle>
          <DialogDescription>
            Every edit is kept as an immutable version. Select one to see what
            changed between it and the current version {currentVersion}
            {onRestoreVersion
              ? " — and restore it if that's the wording you want back."
              : "."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,14rem)_1fr] gap-4 overflow-hidden">
          {/* Version list */}
          <div className="overflow-y-auto pr-1" data-testid="version-list">
            {loadingList ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading versions…
              </p>
            ) : versions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No versions recorded yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(v.version_number)}
                      data-testid={`version-${v.version_number}`}
                      className={cn(
                        "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                        selected === v.version_number
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          v{v.version_number}
                        </span>
                        {v.version_number === currentVersion && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {v.edited_by ?? "unknown editor"}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatWhen(v.created_at)}
                      </p>
                      {v.description ? (
                        <p className="mt-1 truncate text-xs italic text-muted-foreground">
                          {v.description}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Diff pane */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
            {loadingSnapshot ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Loading version…
              </p>
            ) : !snapshot || !diff ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Select a version to compare.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-3 py-2 text-xs">
                  <span className="font-medium">
                    v{snapshot.version_number} → current (v{currentVersion})
                  </span>
                  {diff.stats.identical ? (
                    <span className="text-muted-foreground">
                      Identical — no changes since this version.
                    </span>
                  ) : (
                    <>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{diff.stats.added}
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        −{diff.stats.removed}
                      </span>
                      {diff.stats.truncated && (
                        <span className="text-muted-foreground">
                          Document too large for a line-by-line diff — showing a
                          full replacement.
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div
                  className="min-h-0 flex-1 overflow-auto bg-background"
                  data-testid="version-diff"
                >
                  <table className="w-full border-collapse font-mono text-xs">
                    <tbody>
                      {diff.lines.map((line, idx) => (
                        <tr
                          key={idx}
                          className={cn(
                            line.type === "added" &&
                              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                            line.type === "removed" &&
                              "bg-red-500/10 text-red-700 dark:text-red-300"
                          )}
                        >
                          <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-muted-foreground">
                            {line.oldNumber ?? ""}
                          </td>
                          <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-muted-foreground">
                            {line.newNumber ?? ""}
                          </td>
                          <td className="w-5 select-none px-1 align-top text-muted-foreground">
                            {line.type === "added"
                              ? "+"
                              : line.type === "removed"
                                ? "−"
                                : ""}
                          </td>
                          <td className="whitespace-pre-wrap break-words px-1 align-top">
                            {line.text === "" ? " " : line.text}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Restore — offered only next to the diff that justifies it. */}
        {confirmingRestore && canRestore && (
          <div
            className="shrink-0 space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3"
            data-testid="restore-version-confirm"
          >
            <p className="text-sm">
              Restore version {selected} as the current version of{" "}
              <span className="font-medium">{target?.label}</span>?
            </p>
            <p className="text-sm text-muted-foreground">
              This is an ordinary edit, not a rewind: version {selected}&apos;s
              text is copied forward as a <strong>new version</strong> (v
              {currentVersion + 1}). Nothing is deleted — version{" "}
              {currentVersion} stays in this history exactly as it is, so you can
              undo the restore the same way you made it.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="restore-change-note">
                Note recorded on the new version
              </Label>
              <Input
                id="restore-change-note"
                value={restoreNote}
                onChange={(e) => setRestoreNote(e.target.value)}
                data-testid="restore-change-note"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmingRestore(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={doRestore}
                data-testid="restore-version-confirm-button"
              >
                {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                Restore version {selected}
              </Button>
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
          {/*
            The Restore control is hidden whenever it is not offerable, which is
            right for "this version is already current" — self-evident from the
            list — and wrong for a snapshot today's rules refuse. There the
            absence looks like a missing feature, so the reason takes the
            control's place instead of leaving a gap.
          */}
          {restoreBlockedByContent && !confirmingRestore && (
            <p
              className="mr-auto text-xs text-destructive"
              data-testid="restore-blocked-reason"
            >
              Version {selected} can&apos;t be restored: coord re-checks a
              stored snapshot against today&apos;s content rules, and this one
              no longer passes. {snapshotError}
              {/*
                A blocked restore is a dead end unless the operator is told what
                is left, and one door genuinely is: coord's restore-to-DEFAULT
                is the single write path it deliberately does not content-check
                (`post_restore_default` re-seeds a built-in body its own test
                pins as valid), precisely so a refused restore-version is not
                the end of the line. Offered only where it exists — a
                hand-authored document has no default to fall back to, and
                naming a control that is not there would be a second dead end.
              */}
              {target?.hasDefault ? (
                <>
                  {" "}
                  &ldquo;Restore to default&rdquo; in the editor is still open:
                  coord does not content-check that door, because the body it
                  re-seeds is its own.
                </>
              ) : null}
            </p>
          )}
          {canRestore && !confirmingRestore && (
            <Button
              variant="outline"
              className="mr-auto gap-1.5"
              onClick={startRestore}
              disabled={saving}
              data-testid="restore-version"
            >
              <Undo2 className="size-4" />
              Restore this version
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
