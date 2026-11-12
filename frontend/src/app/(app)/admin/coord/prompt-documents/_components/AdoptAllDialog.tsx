"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ArrowDownToLine, Loader2 } from "lucide-react";
import {
  adoptEffectCounts,
  adoptEffectOf,
  adoptSequentially,
  addressOf,
  pinnedPublicationVersion,
  reconcileRow,
  summarizeAdoptRun,
  type AdoptAllCandidate,
  type AdoptOne,
  type AdoptRowOutcome,
  type AdoptRunSummary,
  type RowReconciliation,
} from "../_lib/adoptAll";
import type { PromptDocumentSummary } from "../types";

/**
 * Where the preview came from.
 *
 * - `fresh` — a re-read taken as the dialog opened, in the pinned project.
 *   The ONLY source that offers anything.
 * - `reread_failed` — that re-read failed. Nothing is offered: the rows on the
 *   page are not evidence of what this project holds.
 * - `degraded` — coord answered, but degraded: which documents have an update
 *   is UNKNOWN, so nothing is offered.
 * - `tenant_changed` — the active project is no longer the one this page was
 *   loaded in (another tab switched it), so nothing is offered.
 * - `system_tenant` — coord, asked again as the dialog opened, answered as it
 *   answers only the system tenant: adopting here would revert the
 *   publisher's own policies, so nothing is offered.
 * - `tenancy_unknown` — that re-ask got no usable answer, so whether this is
 *   the system tenant is UNKNOWN and nothing is offered.
 */
export type AdoptAllPreviewSource =
  | "fresh"
  | "reread_failed"
  | "degraded"
  | "tenant_changed"
  | "system_tenant"
  | "tenancy_unknown";

interface AdoptAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The preview, frozen when the dialog opened. Every adopt is pinned to the
   * versions on these rows. `null` means it is still being read — a different
   * fact from "no updates", and the reason this is not an empty array.
   */
  candidates: readonly AdoptAllCandidate[] | null;
  previewSource: AdoptAllPreviewSource;
  /** Coord's own reason, when `previewSource` is `degraded`. */
  degradedReason?: string | null;
  /** The project the preview was read in, named for the operator. */
  tenantLabel: string;
  /**
   * Whether the active project is still the one the preview was read in.
   * Checked before EVERY request: the HTTP client reads the active project
   * per request, so a switch in another tab would otherwise send the rest of
   * the run to a different project.
   */
  tenantUnchanged: () => boolean;
  /** The existing per-document adopt door, quiet (no toast per document). */
  onAdopt: AdoptOne;
  /**
   * Called once, after the last row settles. Resolves to the list's re-read
   * (`null` when it failed), which reconciles every row the run did not
   * confirm.
   */
  onFinished?: (
    summary: AdoptRunSummary
  ) => Promise<readonly PromptDocumentSummary[] | null>;
}

type Phase = "review" | "running" | "done";

/**
 * Adopt every available upstream update from one control — open it, confirm.
 *
 * The bulk twin of the per-row `Adopt vN` in `PromptDocumentUpstreamDialog`,
 * built the way `PublishAllDialog` is: a preview list with a checkbox per row,
 * everything pinned to the versions shown, then one outcome per row. The run is
 * a client loop over the per-document door — see `../_lib/adoptAll` for why
 * that is the design, what the pins do and do not guarantee, and why a row
 * without a 4xx from coord is "not confirmed" rather than "refused".
 *
 * ## Why rows that would overwrite local edits are included by DEFAULT
 *
 * For the reason publish-all includes its lint hits: the operator is looking
 * at the warning while they decide, and each adopt is a new version whose
 * predecessor stays in history. They are counted at the top, because a
 * per-row note in a long list is a note that gets scrolled past.
 *
 * ## Layout: the body scrolls, the footer never does
 *
 * Header and footer are `shrink-0`; only the middle is
 * `min-h-0 flex-1 overflow-y-auto`, and nothing inside it is a scroll
 * container of its own. However long the list or coord's messages get, the
 * confirm, Stop and Close controls stay on screen.
 *
 * ## Accessibility
 *
 * Row results and the summary are announced through one polite live region.
 * Confirm moves focus to Stop, and the end of the run moves it to the summary,
 * so a keyboard or screen-reader user is never left on a control that just
 * disappeared.
 */
export function AdoptAllDialog({
  open,
  onOpenChange,
  candidates: preview,
  previewSource,
  degradedReason = null,
  tenantLabel,
  tenantUnchanged,
  onAdopt,
  onFinished,
}: AdoptAllDialogProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("review");
  // The rows a run is writing against, frozen when it starts: a preview that
  // changes under a run must change neither the rows on screen nor the
  // selection the run was confirmed with.
  const [frozen, setFrozen] = useState<readonly AdoptAllCandidate[] | null>(
    null
  );
  const candidates = useMemo(
    () => (phase !== "review" && frozen ? frozen : (preview ?? [])),
    [phase, frozen, preview]
  );
  const [outcomes, setOutcomes] = useState<Map<string, AdoptRowOutcome>>(
    new Map()
  );
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [summary, setSummary] = useState<AdoptRunSummary | null>(null);
  // `undefined` = the post-run re-read has not answered yet; `null` = it failed.
  const [afterRead, setAfterRead] = useState<
    readonly PromptDocumentSummary[] | null | undefined
  >(undefined);
  const [liveMessage, setLiveMessage] = useState("");
  const stopRef = useRef(false);
  const phaseRef = useRef<Phase>("review");
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const mountedRef = useRef(true);

  phaseRef.current = phase;

  // A re-open, or a new preview, starts clean — but NEVER mid-run: a preview
  // arriving while a run is writing must not wipe the outcomes it is writing
  // into, or reset the selection the run is pinned to.
  useEffect(() => {
    if (phaseRef.current === "running") return;
    setFrozen(null);
    setExcluded(new Set());
    setPhase("review");
    setOutcomes(new Map());
    setInFlight(null);
    setStopRequested(false);
    setSummary(null);
    setAfterRead(undefined);
    setLiveMessage("");
    stopRef.current = false;
  }, [open, preview]);

  // Navigating away mid-run must not leave the loop posting into a page
  // nobody is looking at: the run stops before its next request, and the
  // post-run re-read is skipped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (phase === "running") stopButtonRef.current?.focus();
    else if (phase === "done") summaryRef.current?.focus();
  }, [phase]);

  const offerable = previewSource === "fresh";
  const adoptable = useMemo(
    () => candidates.filter((c) => pinnedPublicationVersion(c) !== null),
    [candidates]
  );
  const selected = useMemo(
    () => adoptable.filter((c) => !excluded.has(addressOf(c))),
    [adoptable, excluded]
  );
  const counts = useMemo(() => adoptEffectCounts(candidates), [candidates]);
  const settledCount = outcomes.size;

  const toggle = (address: string, include: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (include) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const run = async () => {
    const batch = selected;
    setFrozen(candidates);
    stopRef.current = false;
    setStopRequested(false);
    setOutcomes(new Map());
    setAfterRead(undefined);
    setPhase("running");
    const result = await adoptSequentially(batch, onAdopt, {
      onStart: (c) => setInFlight(addressOf(c)),
      onSettled: (c, outcome) => {
        setInFlight(null);
        setOutcomes((prev) => new Map(prev).set(addressOf(c), outcome));
        setLiveMessage(announce(addressOf(c), outcome));
      },
      // The tenant first: a switched project is a reason to stop even when
      // the operator did not ask to.
      abortReason: () =>
        !tenantUnchanged()
          ? "tenant_changed"
          : stopRef.current
            ? "stopped"
            : null,
    });
    const done = summarizeAdoptRun(result.values());
    if (!mountedRef.current) return;
    setSummary(done);
    setPhase("done");
    setLiveMessage(summarySentence(done));
    const reread = onFinished ? await onFinished(done) : null;
    if (mountedRef.current) setAfterRead(reread);
  };

  // `aria-disabled`, not `disabled`: a control that disables itself while it
  // holds focus drops focus to the page, and the operator who pressed it is
  // left nowhere. It stays focusable and says what it is doing.
  const stop = () => {
    if (stopRequested) return;
    stopRef.current = true;
    setStopRequested(true);
    setLiveMessage("Stopping after the document being adopted now.");
  };

  // A running batch keeps the dialog open: closing it would hide a run that is
  // still writing. "Stop after this one" is the way out, and it says so.
  const handleOpenChange = (next: boolean) => {
    if (!next && phase === "running") return;
    onOpenChange(next);
  };

  const tenantChangedDuringRun = [...outcomes.values()].some(
    (o) => o.state === "not_attempted" && o.reason === "tenant_changed"
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[min(48rem,calc(100%-2rem))]"
        showCloseButton={phase !== "running"}
        data-testid="adopt-all-dialog"
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownToLine className="size-4" />
            Adopt all updates
          </DialogTitle>
          <DialogDescription>
            {phase === "done"
              ? "What was adopted, document by document."
              : preview === null
                ? "Reading which documents have an update…"
                : !offerable
                  ? "Nothing can be offered here right now — see below."
                  : `${candidates.length} ${
                      candidates.length === 1
                        ? "document has"
                        : "documents have"
                    } an upstream update. Each is adopted at the publication version shown here, and only while the document is still at the version shown here: one edited since this preview is refused rather than overwritten unseen. A newer publication released while this is open is not adopted by this run.`}
          </DialogDescription>
          <p
            className="text-xs text-muted-foreground"
            data-testid="adopt-all-tenant"
          >
            Project: <span className="font-medium">{tenantLabel}</span>
          </p>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
          data-testid="adopt-all-body"
        >
          {/* One polite live region for row results and the summary. */}
          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            data-testid="adopt-all-live"
          >
            {liveMessage}
          </p>

          <div
            className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm"
            data-testid="adopt-all-restorable-notice"
          >
            <p className="font-medium">Adopting is restorable.</p>
            <p className="mt-1 text-muted-foreground">
              Each adopt saves the publication as a new version of that
              document. The wording it replaces stays in version history,
              restorable from the row&apos;s History.
            </p>
          </div>

          {preview === null ? (
            <p
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              data-testid="adopt-all-previewing"
            >
              <Loader2 className="size-4 animate-spin" />
              Re-reading the documents…
            </p>
          ) : previewSource === "degraded" ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
              data-testid="adopt-all-degraded"
            >
              Coord answered the re-read in a degraded state
              {degradedReason ? ` (${degradedReason})` : ""}, so which documents
              have an update is unknown — not &ldquo;none&rdquo;. Nothing is
              offered until it can say.
            </p>
          ) : previewSource === "reread_failed" ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
              data-testid="adopt-all-reread-failed"
            >
              The documents could not be re-read in this project just now, so
              nothing is offered: the rows this page shows are not evidence of
              what it holds — they may have been read in another project. Try
              again.
            </p>
          ) : previewSource === "system_tenant" ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
              data-testid="adopt-all-system-tenant"
            >
              Coord answers this project as the publishing (system) tenant. Here
              every document shows its own publication as an update, so adopting
              them all would replace each one edited since it was published with
              the older published body. Nothing is offered; compare and adopt
              one at a time from its row instead.
            </p>
          ) : previewSource === "tenancy_unknown" ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
              data-testid="adopt-all-tenancy-unknown"
            >
              Coord could not be asked whether this is the publishing tenant, so
              that is unknown — and in the publishing tenant this would revert
              its own policies. Nothing is offered; try again, or adopt one at a
              time from its row.
            </p>
          ) : previewSource === "tenant_changed" ? (
            <p
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
              data-testid="adopt-all-tenant-changed"
            >
              The active project changed since this page loaded — most likely in
              another tab — so this page&apos;s answer about which project it is
              no longer holds. Reload the page to adopt in the project now
              selected.
            </p>
          ) : candidates.length === 0 ? (
            <p
              className="py-6 text-sm text-muted-foreground"
              data-testid="adopt-all-empty"
            >
              Nothing to adopt. Coord reports no document with an update
              available.
            </p>
          ) : (
            <>
              {phase === "done" && summary ? (
                <p
                  ref={summaryRef}
                  tabIndex={-1}
                  className="text-sm outline-none"
                  data-testid="adopt-all-summary"
                >
                  {summarySentence(summary)}
                  {tenantChangedDuringRun
                    ? " The active project changed during the run, so nothing more was sent after it did."
                    : ""}
                </p>
              ) : null}

              {phase !== "done" &&
              (counts.overwrites > 0 ||
                counts.neverAdopted > 0 ||
                counts.unknown > 0) ? (
                <div
                  className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm"
                  data-testid="adopt-all-overwrite-group"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-1">
                    {counts.overwrites > 0 ? (
                      <p
                        className="font-medium"
                        data-testid="adopt-all-count-overwrites"
                      >
                        {counts.overwrites} would overwrite local edits.
                      </p>
                    ) : null}
                    {counts.neverAdopted > 0 ? (
                      <p
                        className="font-medium"
                        data-testid="adopt-all-count-never-adopted"
                      >
                        {counts.neverAdopted}{" "}
                        {counts.neverAdopted === 1 ? "has" : "have"} never
                        adopted a publication. Coord marks such a document
                        locally modified because it cannot tell whether it was
                        edited here.
                      </p>
                    ) : null}
                    {counts.unknown > 0 ? (
                      <p
                        className="font-medium"
                        data-testid="adopt-all-count-unknown"
                      >
                        For {counts.unknown}, coord did not say whether{" "}
                        {counts.unknown === 1 ? "it was" : "they were"} edited
                        here.
                      </p>
                    ) : null}
                    <p className="text-muted-foreground">
                      A warning, not a refusal — these are{" "}
                      <strong>included</strong> below, because you are looking
                      at them and every adopt keeps the wording it replaces in
                      history. Untick any you would rather hold back, or compare
                      one first from its row.
                    </p>
                  </div>
                </div>
              ) : null}

              <ul className="space-y-2" data-testid="adopt-all-candidates">
                {candidates.map((candidate) => (
                  <AdoptAllRow
                    key={addressOf(candidate)}
                    candidate={candidate}
                    included={
                      pinnedPublicationVersion(candidate) !== null &&
                      !excluded.has(addressOf(candidate))
                    }
                    locked={phase !== "review"}
                    onToggle={(include) =>
                      toggle(addressOf(candidate), include)
                    }
                    phase={phase}
                    inFlight={inFlight === addressOf(candidate)}
                    outcome={outcomes.get(addressOf(candidate))}
                    afterRead={afterRead}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-2"
          data-testid="adopt-all-footer"
        >
          {phase === "running" ? (
            <>
              <Button
                ref={stopButtonRef}
                variant="outline"
                aria-disabled={stopRequested}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={stop}
                data-testid="adopt-all-stop"
                title="Finish the document being adopted now, then adopt nothing more."
              >
                {stopRequested
                  ? "Stopping after this one…"
                  : "Stop after this one"}
              </Button>
              <Button
                disabled
                className="gap-1.5"
                data-testid="adopt-all-confirm"
              >
                <Loader2 className="size-4 animate-spin" />
                Adopting {Math.min(settledCount + 1, selected.length)} of{" "}
                {selected.length}…
              </Button>
            </>
          ) : phase === "done" ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  preview === null || !offerable || selected.length === 0
                }
                onClick={() => void run()}
                className="gap-1.5"
                data-testid="adopt-all-confirm"
              >
                <ArrowDownToLine className="size-4" />
                Adopt {selected.length}{" "}
                {selected.length === 1 ? "document" : "documents"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The run's one summary: n adopted, m refused, and anything else that happened. */
function summarySentence(summary: AdoptRunSummary): string {
  const parts = [`${summary.adopted} adopted`, `${summary.refused} refused`];
  if (summary.unconfirmed > 0) {
    parts.push(
      `${summary.unconfirmed} not confirmed — the re-read below says what coord now holds for ${summary.unconfirmed === 1 ? "it" : "each"}`
    );
  }
  if (summary.notAttempted > 0) {
    parts.push(`${summary.notAttempted} not attempted`);
  }
  return `${parts.join(", ")}. Each document is adopted on its own, so a refusal blocked nothing else.`;
}

/** What the live region says when one row settles. */
function announce(address: string, outcome: AdoptRowOutcome): string {
  switch (outcome.state) {
    case "adopted":
      return `${address}: adopted as version ${outcome.toVersion}.`;
    case "refused":
      return outcome.by === "coord"
        ? `${address}: refused by coord.`
        : `${address}: refused, not in coord's words.`;
    case "unconfirmed":
      return `${address}: not confirmed.`;
    case "not_attempted":
      return `${address}: not attempted.`;
  }
}

interface AdoptAllRowProps {
  candidate: AdoptAllCandidate;
  included: boolean;
  locked: boolean;
  onToggle: (include: boolean) => void;
  phase: Phase;
  inFlight: boolean;
  outcome: AdoptRowOutcome | undefined;
  afterRead: readonly PromptDocumentSummary[] | null | undefined;
}

/** One document: what it is, what adopting it would replace, and what happened. */
function AdoptAllRow({
  candidate,
  included,
  locked,
  onToggle,
  phase,
  inFlight,
  outcome,
  afterRead,
}: AdoptAllRowProps) {
  const address = addressOf(candidate);
  const latest = pinnedPublicationVersion(candidate);
  const effect = adoptEffectOf(candidate);
  const tracked = candidate.upstream_publication_version;
  const testSuffix = `${candidate.kind}-${candidate.name}`;
  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
      data-testid={`adopt-all-row-${testSuffix}`}
    >
      <Checkbox
        className="mt-0.5"
        checked={included}
        disabled={locked || latest === null}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={`Include ${address}`}
        data-testid={`adopt-all-include-${testSuffix}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="text-sm font-medium">{address}</code>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            data-testid={`adopt-all-versions-${testSuffix}`}
          >
            v{candidate.current_version} → publication{" "}
            {latest === null ? "unknown" : `v${latest}`}
          </span>
          {effect === "overwrites_local_edits" ? (
            <span
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
              data-testid={`adopt-all-overwrites-${testSuffix}`}
            >
              would overwrite local edits
            </span>
          ) : effect === "never_adopted" ? (
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
              data-testid={`adopt-all-never-adopted-${testSuffix}`}
            >
              never adopted
            </span>
          ) : null}
        </div>
        {candidate.description ? (
          // Wrapped, not truncated: the full description stays readable on a
          // touch screen, where a `title` tooltip never shows.
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {candidate.description}
          </p>
        ) : null}
        <p
          className="mt-0.5 text-xs text-muted-foreground"
          data-testid={`adopt-all-effect-${testSuffix}`}
        >
          {latest === null
            ? "Coord served no publication version for this document, so it cannot be pinned here. Compare it from its row instead."
            : effect === "overwrites_local_edits"
              ? `Differs from v${tracked}, the publication it tracks. Adopting replaces those edits with v${latest}; they stay in version history.`
              : effect === "never_adopted"
                ? `Tracks no publication yet, so v${latest} would be its first. Coord reports it ${
                    candidate.local_modified === true
                      ? "locally modified — its answer when it cannot tell"
                      : candidate.local_modified === false
                        ? "not locally modified"
                        : "without saying whether it was edited"
                  }. Its current body is replaced and stays in version history.`
                : effect === "clean"
                  ? `Matches v${tracked}, the publication it tracks, so it takes v${latest} as an ordinary new version.`
                  : `Whether it was edited away from v${tracked} is unknown — coord did not say.`}
        </p>
        <RowOutcome
          testSuffix={testSuffix}
          phase={phase}
          included={included}
          inFlight={inFlight}
          outcome={outcome}
        />
        {phase === "done" &&
        outcome &&
        outcome.state !== "adopted" &&
        !(
          outcome.state === "not_attempted" &&
          outcome.reason === "no_publication_version"
        ) ? (
          <RowReread
            testSuffix={testSuffix}
            pinned={latest}
            reconciliation={
              afterRead === undefined
                ? undefined
                : reconcileRow(candidate, afterRead)
            }
          />
        ) : null}
      </div>
    </li>
  );
}

function RowOutcome({
  testSuffix,
  phase,
  included,
  inFlight,
  outcome,
}: {
  testSuffix: string;
  phase: Phase;
  included: boolean;
  inFlight: boolean;
  outcome: AdoptRowOutcome | undefined;
}) {
  if (phase === "review") return null;
  const testId = `adopt-all-outcome-${testSuffix}`;
  if (!included) {
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid={testId}>
        Held back — not adopted.
      </p>
    );
  }
  if (inFlight) {
    return (
      <p
        className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
        data-testid={testId}
      >
        <Loader2 className="size-3.5 animate-spin" />
        Adopting…
      </p>
    );
  }
  if (!outcome) {
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid={testId}>
        Waiting.
      </p>
    );
  }
  switch (outcome.state) {
    case "adopted":
      return (
        <p className="mt-1 text-xs" data-testid={testId}>
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground">
            adopted
          </span>{" "}
          as v{outcome.toVersion}
        </p>
      );
    case "not_attempted":
      return (
        <p className="mt-1 text-xs text-muted-foreground" data-testid={testId}>
          {outcome.reason === "tenant_changed"
            ? "Not attempted — the active project changed before it was sent."
            : outcome.reason === "stopped"
              ? "Not attempted — you stopped the run before it."
              : "Not attempted — there was no publication version to pin."}
        </p>
      );
    case "refused":
    case "unconfirmed":
      return (
        <div className="mt-1 text-xs" data-testid={testId}>
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {outcome.state === "refused" ? "refused" : "not confirmed"}
          </span>{" "}
          <span className="text-muted-foreground">
            {outcome.state === "refused"
              ? outcome.by === "coord"
                ? "Coord answered and declined it; nothing was adopted."
                : `Refused (HTTP ${outcome.status}), not in coord's words; nothing was adopted.`
              : outcome.cause === "server_error"
                ? "The request failed after it reached the server, which can happen after coord has already committed the adopt."
                : outcome.cause === "unrecognized_answer"
                  ? "Coord answered, but not with the version an adopt reports."
                  : outcome.cause === "unreadable_answer"
                    ? "An answer arrived but could not be read, so whether coord committed it is not known."
                    : "No answer came back, so whether coord committed it is not known."}
          </span>
          {/* Coord's (or the transport's) own words, verbatim. */}
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {outcome.detail}
          </p>
        </div>
      );
  }
}

/** What the post-run re-read shows for a row the run did not confirm. */
function RowReread({
  testSuffix,
  pinned,
  reconciliation,
}: {
  testSuffix: string;
  pinned: number | null;
  reconciliation: RowReconciliation | undefined;
}) {
  const testId = `adopt-all-reread-${testSuffix}`;
  const text = (() => {
    if (reconciliation === undefined) return "Re-reading the list…";
    switch (reconciliation.state) {
      case "unknown":
        return reconciliation.why === "read_failed"
          ? "The list could not be re-read in this run's project, so what coord now holds for this document is unknown."
          : "The re-read does not list this document, so what coord now holds for it is unknown.";
      case "tracks_publication":
        return `Re-read: now at v${reconciliation.currentVersion}, tracking publication v${reconciliation.tracked} — the adopt is in place.`;
      case "unchanged":
        return `Re-read: still at v${reconciliation.currentVersion}, unchanged — nothing landed.`;
      case "changed":
        return `Re-read: now at v${reconciliation.currentVersion}, tracking ${
          reconciliation.tracked === null
            ? "no publication"
            : `publication v${reconciliation.tracked}`
        } — it changed, but not into publication v${pinned ?? "?"}.`;
    }
  })();
  return (
    <p className="mt-1 text-xs" data-testid={testId}>
      {text}
    </p>
  );
}
