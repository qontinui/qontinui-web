"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import {
  PUBLICATION_LINT_CATEGORY_LABEL,
  type PublishAllArmedResponse,
  type PublishAllCandidate,
} from "../types";

/** `kind/name` — the key every map and checkbox in this dialog is keyed on. */
function addressOf(c: { kind: string; name: string }): string {
  return `${c.kind}/${c.name}`;
}

/**
 * The change notes since the last publication, as one line.
 *
 * Coord serves `versions_since_publication` as VERSION ROWS, not as notes —
 * `[{version_number, change_note, edited_by, created_at, loosening?}]`. The
 * note is one nullable field of each row, so the mapping is explicit here
 * rather than a `join` over the array: a row saved without a note is ordinary,
 * and joining the raw objects (or their nulls) would print `[object Object]`
 * or the word "null" in the one place an operator reads what they are about to
 * send to every tenant.
 */
function changeNotesOf(candidate: PublishAllCandidate): string {
  return (candidate.versions_since_publication ?? [])
    .map((v) => v.change_note)
    .filter((note): note is string => typeof note === "string" && note !== "")
    .join(" · ");
}

interface PublishAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The dry run's answer, verbatim. Never re-derived from the document list.
   *
   * `null` means no preview has been taken yet — a different fact from "no
   * candidates", and the reason this is not an empty array: an empty list would
   * render "nothing has changed" over a request still in flight.
   */
  candidates: readonly PublishAllCandidate[] | null;
  /** True while the dry run is in flight. */
  previewing: boolean;
  publishing: boolean;
  /**
   * Arm the run for the chosen candidates. Takes the CANDIDATES, not their
   * addresses, so the `expected_version` travelling with each item is the one
   * the dry run returned and the operator was shown.
   */
  onPublishAll: (
    selected: readonly PublishAllCandidate[],
    releaseNote: string
  ) => Promise<PublishAllArmedResponse | null>;
}

/**
 * Publish every changed document into the fleet channel, in one click.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D1. Two phases in one
 * dialog, exactly as `PromptDocumentPublishDialog` has: review what is about to
 * ship, then read what did.
 *
 * ## The guarantee this dialog is built around
 *
 * **Each item is armed at the version the DRY RUN returned, not at whatever the
 * document list says now.** That is why `candidates` comes in as coord's own
 * objects and goes back out as the same objects: there is no point in this
 * component where a `current_version` is looked up a second time. A document
 * edited between this preview and the confirm click fails `version_conflict`,
 * per item, with the others still publishing — instead of publishing a body
 * nobody in this dialog has seen. It is the same guarantee single-document
 * publishing already gives; the batch does not weaken it.
 *
 * ## Why the lint hits are grouped at the TOP and included by DEFAULT
 *
 * They are grouped at the top because they are the single cheapest signal that
 * a document naming this fleet's repos, paths or ports is about to be handed to
 * every other tenant, and a batch of 26 rows is exactly where a per-row warning
 * gets scrolled past.
 *
 * They are included by default because the lint is ADVISORY under the
 * 2026-09-04 plan's D2 — "it never blocks: the operator may have a good reason,
 * and a blocking lint on a judgement call becomes a lint people learn to route
 * around" — and because the operator is looking at the hits while they decide.
 * Excluding them by default would turn an advisory signal into a gate the
 * operator has to fight, which is the same failure by a different route. Each
 * row carries a checkbox to leave that document out.
 *
 * ## One confirm button, and what it says before it is pressed
 *
 * *A publication is immutable and is distributed on save.* The same sentence
 * the single-document dialog says, for the same reason: a tenant may already
 * have adopted it, so there is nothing to withdraw it from, and an operator who
 * learns that afterwards learns it at the only moment it cannot help them. In a
 * batch it matters more — this is N publications at once.
 */
export function PublishAllDialog({
  open,
  onOpenChange,
  candidates: preview,
  previewing,
  publishing,
  onPublishAll,
}: PublishAllDialogProps) {
  const [releaseNote, setReleaseNote] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<PublishAllArmedResponse | null>(null);
  const candidates = useMemo(() => preview ?? [], [preview]);

  // A re-open starts clean. A release note left over from the previous batch
  // would be attached to every publication in this one silently, and it is the
  // only prose a receiving tenant ever gets. The exclusions reset for the
  // sharper reason: they were decisions about a DIFFERENT preview.
  useEffect(() => {
    setReleaseNote("");
    setExcluded(new Set());
    setArmed(null);
  }, [open, candidates]);

  const withLint = useMemo(
    () => candidates.filter((c) => (c.lint ?? []).length > 0),
    [candidates]
  );

  const selected = useMemo(
    () => candidates.filter((c) => !excluded.has(addressOf(c))),
    [candidates, excluded]
  );

  const toggle = (address: string, include: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (include) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const confirm = async () => {
    const res = await onPublishAll(selected, releaseNote);
    if (res) setArmed(res);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
        data-testid="publish-all-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" />
            Publish all changed
          </DialogTitle>
          <DialogDescription>
            {armed !== null
              ? "What shipped, item by item."
              : preview === null
                ? "Reading which documents have changed…"
                : `${candidates.length} ${
                    candidates.length === 1 ? "document has" : "documents have"
                  } a body that differs from what the fleet currently holds. Each is published at the version shown here, so anything edited since this preview fails rather than publishing a body you have not seen.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/*
            Before the click, not after — and in a batch this is N publications
            at once, which is why it leads rather than sits at the bottom.
          */}
          <div
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
            data-testid="publish-all-immutability-notice"
          >
            <p className="font-medium">
              A publication is immutable and is distributed on save.
            </p>
            <p className="mt-1">
              There is no withdraw: a tenant may already have adopted it, and an
              offline one certainly has. A mistake is corrected by{" "}
              <strong>publishing again</strong>.
            </p>
          </div>

          {armed !== null ? (
            <PublishAllResults armed={armed} />
          ) : preview === null ? (
            <p
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              data-testid="publish-all-previewing"
            >
              <Loader2 className="size-4 animate-spin" />
              Asking coord which documents have changed…
            </p>
          ) : candidates.length === 0 ? (
            <p
              className="py-6 text-sm text-muted-foreground"
              data-testid="publish-all-empty"
            >
              Nothing has changed since the last publication. Every publishable
              document&apos;s body matches what the fleet already holds, or is
              set to <span className="font-mono">never</span>.
            </p>
          ) : (
            <>
              {/*
                Grouped at the top, because a per-row warning inside a list of
                26 is a warning that gets scrolled past.
              */}
              {withLint.length > 0 ? (
                <div
                  className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
                  data-testid="publish-all-lint-group"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="text-sm">
                      <p className="font-medium">
                        {withLint.length} of these{" "}
                        {withLint.length === 1 ? "names" : "name"} something
                        specific to this fleet.
                      </p>
                      <p className="text-muted-foreground">
                        A warning, not a refusal — these are{" "}
                        <strong>included</strong> below, because you are looking
                        at the hits and the lint has never been a gate. Untick
                        any you would rather hold back.
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {withLint.map((candidate) =>
                      (candidate.lint ?? []).map((hit, i) => (
                        <li
                          key={`${addressOf(candidate)}-${hit.category}-${hit.token}-${i}`}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                          data-testid={`publish-all-lint-${candidate.kind}-${candidate.name}`}
                        >
                          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground">
                            {PUBLICATION_LINT_CATEGORY_LABEL[hit.category] ??
                              hit.category}
                          </span>
                          <code className="font-mono">{hit.token}</code>
                          <span className="text-muted-foreground">
                            in {addressOf(candidate)}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}

              <ul className="space-y-2" data-testid="publish-all-candidates">
                {candidates.map((candidate) => {
                  const address = addressOf(candidate);
                  const hits = candidate.lint ?? [];
                  const included = !excluded.has(address);
                  return (
                    <li
                      key={address}
                      className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                      data-testid={`publish-all-row-${candidate.kind}-${candidate.name}`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={included}
                        onCheckedChange={(v) => toggle(address, v === true)}
                        aria-label={`Include ${address}`}
                        data-testid={`publish-all-include-${candidate.kind}-${candidate.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <code className="text-sm font-medium">{address}</code>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            v{candidate.current_version} → publication v
                            {candidate.next_publication_version}
                          </span>
                          {candidate.direction === "loosening" ? (
                            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                              loosening
                            </span>
                          ) : null}
                          {hits.length > 0 ? (
                            <span
                              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
                              data-testid={`publish-all-row-lint-${candidate.kind}-${candidate.name}`}
                            >
                              {hits.length}{" "}
                              {hits.length === 1 ? "token" : "tokens"}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          edited by {candidate.edited_by ?? "unknown"}
                          {candidate.publish_mode
                            ? ` · mode ${candidate.publish_mode}`
                            : " · mode undecided"}
                        </p>
                        {changeNotesOf(candidate) ? (
                          <p className="mt-0.5 truncate text-xs italic text-muted-foreground">
                            {changeNotesOf(candidate)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="space-y-1.5">
                <Label htmlFor="publish-all-release-note">
                  Release note{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="publish-all-release-note"
                  rows={3}
                  value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  placeholder="What changed across these documents, and why another tenant would want them."
                  data-testid="publish-all-release-note"
                />
                <p className="text-xs text-muted-foreground">
                  One note for the whole batch — it is the only prose a
                  receiving tenant gets. Leave it empty and each publication
                  carries its own change notes instead.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {armed === null ? "Cancel" : "Close"}
          </Button>
          {armed === null && (
            <Button
              disabled={publishing || previewing || selected.length === 0}
              onClick={confirm}
              className="gap-1.5"
              data-testid="publish-all-confirm"
            >
              {publishing && <Loader2 className="size-4 animate-spin" />}
              Publish {selected.length}{" "}
              {selected.length === 1 ? "document" : "documents"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One outcome per item, because each item was published independently.
 *
 * A batch summary would hide the case this whole design exists for: a
 * `version_conflict` on one document while the other twenty-five published. The
 * outcomes are coord's own vocabulary and an unrecognized one renders as
 * itself — a release that adds an outcome must not show as blank.
 */
function PublishAllResults({ armed }: { armed: PublishAllArmedResponse }) {
  const results = armed.results ?? [];
  const published = results.filter((r) => r.outcome === "published");
  const failed = results.filter((r) => r.outcome !== "published");
  return (
    <div className="space-y-3" data-testid="publish-all-results">
      <p className="text-sm">
        <span className="font-medium">{published.length}</span> published
        {failed.length > 0 ? (
          <>
            , <span className="font-medium">{failed.length}</span> did not. Each
            item is published on its own, so a failure here blocked nothing
            else.
          </>
        ) : (
          "."
        )}
      </p>
      {/*
        Whether the fleet fan-out started. A batch that published nothing and a
        batch whose fan-out was lost look identical from outside — and the lost
        one logs nothing at all, which is the gap the daily recovery reconcile
        exists to close. Saying which happened costs one line.
      */}
      {armed.fan_out ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="publish-all-fan-out"
        >
          {armed.fan_out === "spawned"
            ? "Distribution to the fleet has started. Each tenant takes the publication, is offered it, or queues it as a proposal, by its own upstream dial."
            : armed.fan_out === "skipped_nothing_published"
              ? "No fan-out ran, because nothing published. That is the expected answer here, not a lost distribution."
              : `Fan-out: ${armed.fan_out}.`}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {results.map((result) => (
          <li
            key={`${result.kind}/${result.name}`}
            className="rounded-md border border-border px-2.5 py-2 text-xs"
            data-testid={`publish-all-result-${result.kind}-${result.name}`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <code className="font-mono">
                {result.kind}/{result.name}
              </code>
              <span
                className={
                  result.outcome === "published"
                    ? "rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground"
                    : "rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
                }
              >
                {result.outcome}
              </span>
              {result.outcome === "published" && result.publication_version ? (
                <span className="text-muted-foreground">
                  publication v{result.publication_version}
                </span>
              ) : null}
            </div>
            {result.outcome === "version_conflict" ? (
              <p className="mt-1 text-muted-foreground">
                You published v{result.expected ?? "?"}; coord holds v
                {result.actual ?? "?"}. Somebody edited it between this preview
                and the click, so nothing was published for it — which is the
                point. Reopen this dialog to publish the current body.
              </p>
            ) : null}
            {result.detail ? (
              <p className="mt-1 text-muted-foreground">{result.detail}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
