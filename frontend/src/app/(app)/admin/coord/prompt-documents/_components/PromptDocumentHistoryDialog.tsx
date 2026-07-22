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
import { cn } from "@/lib/utils";
import { History } from "lucide-react";
import { diffLines } from "../_lib/diff";
import type {
  ListVersionsResponse,
  PromptDocumentKind,
  PromptDocumentVersion,
  PromptDocumentVersionMeta,
} from "../types";

interface PromptDocumentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document whose history is shown. `null` closes the view. */
  target: { kind: PromptDocumentKind; name: string; label: string } | null;
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
 */
export function PromptDocumentHistoryDialog({
  open,
  onOpenChange,
  target,
  currentBody,
  currentVersion,
  fetchVersions,
  fetchVersion,
}: PromptDocumentHistoryDialogProps) {
  const [versions, setVersions] = useState<PromptDocumentVersionMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<PromptDocumentVersion | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-4xl overflow-hidden"
        data-testid="prompt-document-history"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Version history{target ? ` — ${target.label}` : ""}
          </DialogTitle>
          <DialogDescription>
            Every edit is kept as an immutable version. Select one to see what
            changed between it and the current version {currentVersion}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] grid-cols-[minmax(0,14rem)_1fr] gap-4 overflow-hidden">
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
          <div className="overflow-hidden rounded-md border border-border">
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
                  className="max-h-[55vh] overflow-auto bg-background"
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

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
