"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import type {
  PromptDocumentSummary,
  PublicationLintHit,
  PublishResponse,
} from "../types";
import { PUBLICATION_LINT_CATEGORY_LABEL } from "../types";

interface PromptDocumentPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document being published. `null` closes the view. */
  doc: PromptDocumentSummary | null;
  publishing: boolean;
  /**
   * Promote `doc`'s current body into the next publication. Resolves to coord's
   * response — publication plus advisory lint — or `null` on a refusal the hook
   * has already reported.
   */
  onPublish: (
    doc: PromptDocumentSummary,
    releaseNote: string
  ) => Promise<PublishResponse | null>;
}

/**
 * Publish one document into the fleet-wide publication channel.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D2. Two phases in one
 * dialog: compose the release note, then read what shipped.
 *
 * ## The sentence this dialog exists to say BEFORE the click
 *
 * *A publication is immutable and is distributed on save; a mistake is
 * corrected by publishing again, not by withdrawing.*
 *
 * The plan lists that under Risks with an instruction attached — "the dialog
 * must say so before the operator clicks, not after" — because the reason is
 * not tidiness: a publication may already have been adopted by tenants, and
 * certainly by an offline one, so there is nothing to withdraw it from. An
 * operator who learns that afterwards learns it at the only moment it cannot
 * help them.
 *
 * ## The lint is a WARNING and arrives AFTER
 *
 * Coord runs the lint on the body it ACTUALLY published and returns the hits in
 * the 200 (D2 — "It never blocks: the operator may have a good reason, and a
 * blocking lint on a judgement call becomes a lint people learn to route
 * around"). So the hits describe what shipped, and the remedy this dialog names
 * is the only real one: publish again. Presenting them as a pre-flight check
 * the operator could have failed would misdescribe both the mechanism and the
 * fix.
 *
 * The hits are still worth showing prominently — they are the single cheapest
 * signal that a document naming this fleet's repos, paths or ports has just
 * been handed to every other tenant.
 */
export function PromptDocumentPublishDialog({
  open,
  onOpenChange,
  doc,
  publishing,
  onPublish,
}: PromptDocumentPublishDialogProps) {
  const [releaseNote, setReleaseNote] = useState("");
  const [result, setResult] = useState<PublishResponse | null>(null);

  // A new document — or a re-open of the same one — starts clean. A release
  // note left over from the previous publication would be attached to this one
  // silently, and it is the only prose a receiving tenant ever gets.
  useEffect(() => {
    setReleaseNote("");
    setResult(null);
  }, [open, doc]);

  const doPublish = async () => {
    if (!doc) return;
    const res = await onPublish(doc, releaseNote);
    if (res) setResult(res);
  };

  const label = doc ? (doc.description ?? doc.name) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden"
        data-testid="prompt-document-publish"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" />
            Publish{doc ? ` — ${label}` : ""}
          </DialogTitle>
          <DialogDescription>
            {doc
              ? `Promote version ${doc.current_version} of ${doc.kind}/${doc.name} into the fleet-wide publication channel, where every other tenant can be offered it.`
              : "Select a document to publish."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/*
            Before the click, not after. See the module docs — a publication
            cannot be withdrawn because a tenant may already have adopted it,
            and an offline one certainly has.
          */}
          <div
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
            data-testid="publish-immutability-notice"
          >
            <p className="font-medium">
              A publication is immutable and is distributed on save.
            </p>
            <p className="mt-1">
              There is no withdraw: a tenant may already have adopted it, and an
              offline one certainly has. A mistake is corrected by{" "}
              <strong>publishing again</strong> — the next publication
              supersedes this one, and this one stays on the record.
            </p>
          </div>

          {result === null ? (
            <div className="space-y-1.5">
              <Label htmlFor="publish-release-note">
                Release note{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="publish-release-note"
                rows={4}
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
                placeholder="What changed, and why another tenant would want it."
                data-testid="publish-release-note"
              />
              <p className="text-xs text-muted-foreground">
                This is the only prose a receiving tenant gets. It is shown
                beside the update when they decide whether to take it.
              </p>
            </div>
          ) : (
            <PublishResult result={result} />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result === null ? "Cancel" : "Close"}
          </Button>
          {result === null && (
            <Button
              disabled={publishing || !doc}
              onClick={doPublish}
              className="gap-1.5"
              data-testid="publish-confirm"
            >
              {publishing && <Loader2 className="size-4 animate-spin" />}
              {doc ? `Publish version ${doc.current_version}` : "Publish"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What actually shipped: the publication's number, and the advisory lint. */
function PublishResult({ result }: { result: PublishResponse }) {
  const { publication, lint } = result;
  return (
    <div className="space-y-4" data-testid="publish-result">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
        <p>
          Published as{" "}
          <span className="font-medium">
            publication v{publication.publication_version}
          </span>{" "}
          of {publication.kind}/{publication.name}, from document version{" "}
          {publication.source_version}.
        </p>
        {publication.release_note ? (
          <p className="mt-1 italic text-muted-foreground">
            {publication.release_note}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            No release note was recorded. Receiving tenants see the version
            number and nothing else — publish again with a note if that matters.
          </p>
        )}
      </div>

      {lint.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="publish-lint-clean"
        >
          The publish-time check found no fleet-specific tokens — no repository
          names, workspace paths, schema identifiers or port literals.
        </p>
      ) : (
        <div className="space-y-2" data-testid="publish-lint-hits">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-medium">
                {lint.length} fleet-specific{" "}
                {lint.length === 1 ? "token" : "tokens"} in the published body.
              </p>
              {/*
                Said plainly, because the ORDER of events is the thing an
                operator will otherwise get wrong: this ran on the body that
                shipped, so it is a description, not a gate they failed. It
                never blocks — D2 — and the fix is the same fix as any other
                mistake here.
              */}
              <p className="text-muted-foreground">
                This is a warning, not a refusal — the publication went out.
                Each of these describes THIS fleet rather than a general rule,
                so a tenant reading it may not be able to act on it. If that is
                wrong, publish a corrected body as the next version.
              </p>
            </div>
          </div>
          <ul className="space-y-1.5">
            {lint.map((hit, i) => (
              <LintRow
                key={`${hit.category}-${hit.token}-${hit.line}-${i}`}
                hit={hit}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LintRow({ hit }: { hit: PublicationLintHit }) {
  // An unknown category renders as ITSELF: coord may add one in a release this
  // console predates, and a blank label would hide the hit's only classifier.
  const label = PUBLICATION_LINT_CATEGORY_LABEL[hit.category] ?? hit.category;
  return (
    <li className="rounded-md border border-border px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <code className="font-mono">{hit.token}</code>
        <span className="text-muted-foreground">line {hit.line}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{hit.reason}</p>
    </li>
  );
}
