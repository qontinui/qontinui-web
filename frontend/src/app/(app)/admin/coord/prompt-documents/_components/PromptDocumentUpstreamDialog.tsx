"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDownToLine,
  CloudDownload,
  Hand,
} from "lucide-react";
import {
  DIFF_ADDED_COUNT_CLASS,
  DIFF_REMOVED_COUNT_CLASS,
  DiffTable,
  diffLines,
} from "@/components/console";
import type { Publication, PromptDocument, PromptDocumentKind } from "../types";

/**
 * Which pair of the three-way the diff pane is showing.
 *
 * The three panes are the three-way view. `upstream_change` is what the
 * publisher did, `local_change` is what this tenant did, and `adopt_effect` is
 * what pressing Adopt would do here — the only one of the three that is always
 * computable, because it needs no base.
 */
type ThreeWayPane = "upstream_change" | "local_change" | "adopt_effect";

interface PaneSpec {
  id: ThreeWayPane;
  label: string;
  /** What the left-hand side of this diff is, in one clause. */
  caption: string;
}

interface PromptDocumentUpstreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document WITH its body — the "ours" side. `null` closes the view. */
  doc: PromptDocument | null;
  /** True while the parent is fetching that body. */
  loadingBody: boolean;
  fetchPublication: (
    kind: PromptDocumentKind,
    name: string,
    version: number
  ) => Promise<Publication | null>;
  /**
   * Replace this tenant's body with the new publication and advance the tracked
   * version.
   *
   * **Optional, and its absence FAILS CLOSED** — the same convention
   * `PromptDocumentHistoryDialog` uses for `onRestoreVersion`. When it is
   * absent the control renders disabled with the reason in its place rather
   * than being hidden: a decision surface with the decision quietly missing is
   * how an operator concludes they have already decided.
   */
  onAdoptUpstream?: (
    doc: PromptDocument,
    publication: Publication
  ) => Promise<boolean>;
  /**
   * Record "reviewed publication N, declined": advance the tracked version
   * WITHOUT touching the body.
   *
   * Not a no-op, and the plan is explicit about why (Risks): "The badge becomes
   * noise if `Keep mine` is not recorded... `Keep mine` advancing the tracked
   * version without touching the body is the mechanism that prevents it, and it
   * is not optional." Same fail-closed absence as above.
   */
  onKeepMine?: (
    doc: PromptDocument,
    publication: Publication
  ) => Promise<boolean>;
  /** True while either decision is in flight. */
  saving?: boolean;
}

/**
 * The upstream-update decision surface: a three-way view of one document
 * against the publication channel, and the two decisions that resolve it.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D4, Phase 6.
 *
 * ## It reuses the history dialog's differ, deliberately
 *
 * `diffLines` + `DiffTable` from `@/components/console` — the same pair
 * `PromptDocumentHistoryDialog` renders, and the same pair the console style
 * guide names as the shared version-diff primitive. A second differ on this
 * page would be two renderings of the same thing that drift: line numbering,
 * truncation behaviour on a large body, and the added/removed palette are all
 * decisions already made once here.
 *
 * ## Three panes, because a three-way view is three comparisons
 *
 * | Pane | Left | Right | Answers |
 * |---|---|---|---|
 * | What upstream changed | tracked publication | new publication | "is this update worth taking?" |
 * | Your local edits | tracked publication | this tenant's body | "what would I be giving up?" |
 * | What adopting would change | this tenant's body | new publication | "what happens if I press Adopt?" |
 *
 * The first two need a BASE — the publication this document currently tracks —
 * and a document whose `upstream_publication_version` is null has none. That is
 * UNKNOWN, not "no local edits": D3 says such a row is hand-authored or was
 * seeded from a compiled constant before any publication existed. Those panes
 * say so rather than rendering an empty diff, which would read as "nothing
 * differs".
 *
 * ## Why both decisions can be absent
 *
 * They are wired by their props, and this dialog neither invents them nor
 * simulates them. Adopting must replace the body AND advance the tracked
 * version in one act; declining must advance the tracked version WITHOUT
 * touching the body. Neither is expressible as an ordinary document edit — an
 * edit moves the body and leaves the tracking where it was, which would clear
 * nothing and leave the badge up. So when a prop is absent the control is
 * disabled and says what is missing, and the operator is not offered a button
 * that would half-do the thing it names.
 *
 * ## Why there is no `Merge clauses` button
 *
 * The plan lists a third action for `kind = "policy"` — a clause-grained
 * three-way merge — and parks it in Phase 7. It is deliberately absent rather
 * than present-and-disabled: the two actions above are already disabled
 * wherever their props are unwired, and a third permanently-dead control beside
 * them stops reading as "not yet" and starts reading as a broken dialog. It
 * belongs here when it can do something, in the phase that builds it.
 */
export function PromptDocumentUpstreamDialog({
  open,
  onOpenChange,
  doc,
  loadingBody,
  fetchPublication,
  onAdoptUpstream,
  onKeepMine,
  saving = false,
}: PromptDocumentUpstreamDialogProps) {
  const [incoming, setIncoming] = useState<Publication | null>(null);
  const [base, setBase] = useState<Publication | null>(null);
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [pane, setPane] = useState<ThreeWayPane>("upstream_change");

  const tracked = doc?.upstream_publication_version ?? null;
  const latest = doc?.latest_publication_version ?? null;

  // Load the two publications this view compares: the one being offered, and
  // the one this document currently tracks. Both are body-bearing reads, so
  // they happen here rather than in the list.
  useEffect(() => {
    if (!open || !doc || latest === null) {
      setIncoming(null);
      setBase(null);
      return;
    }
    let cancelled = false;
    setLoadingPublications(true);
    // A TUPLE, not an array: `Promise.all` over a `Promise<T>[]` destructures
    // to `T | undefined` under this project's index checks, and widening the
    // two publications to `undefined` would put a third meaning on a field
    // whose `null` already means something specific.
    const wanted: [Promise<Publication | null>, Promise<Publication | null>] = [
      fetchPublication(doc.kind, doc.name, latest),
      tracked === null || tracked === latest
        ? Promise.resolve(null)
        : fetchPublication(doc.kind, doc.name, tracked),
    ];
    Promise.all(wanted)
      .then((results) => {
        if (cancelled) return;
        const [newest, previous] = results;
        setIncoming(newest);
        // When the tracked version IS the latest there is nothing separate to
        // fetch; the base and the incoming are the same row.
        setBase(tracked !== null && tracked === latest ? newest : previous);
      })
      .finally(() => {
        if (!cancelled) setLoadingPublications(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, doc, latest, tracked, fetchPublication]);

  // A document change resets the pane: "what upstream changed" is the question
  // an operator opens this for, and carrying a pane over from the last document
  // would answer a different one.
  useEffect(() => {
    setPane("upstream_change");
  }, [open, doc]);

  const ours = doc?.body ?? "";

  const diff = useMemo(() => {
    if (!incoming) return null;
    switch (pane) {
      case "upstream_change":
        return base ? diffLines(base.body, incoming.body) : null;
      case "local_change":
        return base ? diffLines(base.body, ours) : null;
      case "adopt_effect":
        return diffLines(ours, incoming.body);
    }
  }, [pane, base, incoming, ours]);

  const panes: PaneSpec[] = [
    {
      id: "upstream_change",
      label: "What upstream changed",
      caption:
        base && incoming
          ? `publication v${base.publication_version} → v${incoming.publication_version}`
          : "needs the publication this document tracks",
    },
    {
      id: "local_change",
      label: "Your local edits",
      caption: base
        ? `publication v${base.publication_version} → this tenant's version ${doc?.current_version ?? "?"}`
        : "needs the publication this document tracks",
    },
    {
      id: "adopt_effect",
      label: "What adopting would change",
      caption: incoming
        ? `this tenant's version ${doc?.current_version ?? "?"} → publication v${incoming.publication_version}`
        : "",
    },
  ];

  const decisionsWired = onAdoptUpstream != null && onKeepMine != null;
  const canDecide =
    decisionsWired &&
    doc != null &&
    incoming != null &&
    !saving &&
    !loadingBody;

  const label = doc ? (doc.description ?? doc.name) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden"
        data-testid="prompt-document-upstream"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="size-4" />
            Upstream update{doc ? ` — ${label}` : ""}
          </DialogTitle>
          <DialogDescription>
            {incoming ? (
              <>
                Publication v{incoming.publication_version} is available.{" "}
                {tracked === null
                  ? "This document tracks no publication yet, so this would be its first."
                  : `This document tracks v${tracked}.`}
              </>
            ) : (
              "Comparing this document against the fleet-wide publication channel."
            )}
          </DialogDescription>
        </DialogHeader>

        {incoming?.release_note ? (
          <div
            className="shrink-0 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
            data-testid="upstream-release-note"
          >
            <span className="text-muted-foreground">
              Release note for v{incoming.publication_version}:
            </span>{" "}
            <span className="italic">{incoming.release_note}</span>
          </div>
        ) : null}

        {/* Pane selector — the three comparisons of the three-way view. */}
        <div
          className="flex shrink-0 flex-wrap gap-1"
          role="tablist"
          aria-label="Three-way comparison"
        >
          {panes.map((p) => {
            const unavailable = p.id !== "adopt_effect" && base === null;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                disabled={unavailable}
                onClick={() => setPane(p.id)}
                data-testid={`upstream-pane-${p.id}`}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                  pane === p.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50",
                  unavailable && "cursor-not-allowed opacity-50"
                )}
              >
                <span className="block font-medium">{p.label}</span>
                <span className="block text-muted-foreground">{p.caption}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          {loadingBody || loadingPublications ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Loading the comparison…
            </p>
          ) : !incoming ? (
            <p
              className="py-12 text-center text-sm text-muted-foreground"
              data-testid="upstream-no-publication"
            >
              No publication could be read for this document. That is unknown,
              not &ldquo;nothing published&rdquo; — the channel may be
              unreachable from here.
            </p>
          ) : diff === null ? (
            <p
              className="py-12 text-center text-sm text-muted-foreground"
              data-testid="upstream-no-base"
            >
              This document tracks no publication, so there is no base to
              compare against. It was written here, or seeded before any
              publication for it existed — either way, what it would have
              diverged FROM is unknown rather than identical. &ldquo;What
              adopting would change&rdquo; is still exact.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-3 py-2 text-xs">
                <span className="font-medium">
                  {panes.find((p) => p.id === pane)?.caption}
                </span>
                {diff.stats.identical ? (
                  <span className="text-muted-foreground">
                    Identical — these two are the same text.
                  </span>
                ) : (
                  <>
                    <span className={DIFF_ADDED_COUNT_CLASS}>
                      +{diff.stats.added}
                    </span>
                    <span className={DIFF_REMOVED_COUNT_CLASS}>
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
              <DiffTable lines={diff.lines} data-testid="upstream-diff" />
            </>
          )}
        </div>

        {/*
          The decisions are wired by props. When they are absent this says so
          instead of leaving two dead buttons to be read as "already decided" —
          and it names WHY neither can be simulated from the document write path
          that IS available here.
        */}
        {!decisionsWired && (
          <div
            className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
            data-testid="upstream-decisions-unwired"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              This view compares; it cannot yet decide. Both decisions move the
              version this document tracks — adopting replaces the body and
              advances it, keeping yours advances it and leaves the body alone —
              and an ordinary edit cannot do either: it moves the body and
              leaves the tracking where it was, which would clear no badge.
              Until coord serves those two operations, comparing here and
              editing in the editor is the honest path.
            </p>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            variant="outline"
            className="mr-auto gap-1.5"
            disabled={!canDecide}
            title={
              decisionsWired
                ? "Record that you reviewed this publication and are keeping your own wording. Your body is not touched; the badge clears."
                : "Not available yet — see the note above."
            }
            onClick={() => {
              if (doc && incoming && onKeepMine) void onKeepMine(doc, incoming);
            }}
            data-testid="upstream-keep-mine"
          >
            <Hand className="size-4" />
            Keep mine
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            className="gap-1.5"
            disabled={!canDecide}
            title={
              decisionsWired
                ? "Replace this document's body with the publication. Your current wording stays in version history and is restorable in one click."
                : "Not available yet — see the note above."
            }
            onClick={() => {
              if (doc && incoming && onAdoptUpstream)
                void onAdoptUpstream(doc, incoming);
            }}
            data-testid="upstream-adopt"
          >
            <ArrowDownToLine className="size-4" />
            {incoming
              ? `Adopt v${incoming.publication_version}`
              : "Adopt upstream"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
