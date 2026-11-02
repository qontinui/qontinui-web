"use client";

/**
 * PrHoldControl — the operator's coord hold / release control for one PR.
 *
 * Replaces `PrDraftStateControl` (plan
 * `2026-10-04-coord-pr-hold-without-github-drafts`, Phase 4). A hold is coord
 * state (`coord.pr_holds`), so it works on every repo, including GitHub Free
 * private repos, which have no draft PRs. Shared by both admin surfaces that
 * render a PR's actions:
 *   - `/admin/coord/pipeline` → `MergePipeline`'s per-row action group
 *   - `/admin/coord/prs`      → `PrsTable`'s actions cell
 *
 * The prop contract is deliberately PRIMITIVE plus the row's two hold fields:
 * neither `PrRow` nor `PipelineRow` appears here, because the two row types are
 * unrelated and must stay so.
 *
 * ## What it shows
 *
 * - Held: who placed it, the reason, when, and the kind — plus Release.
 * - Not held: Hold, which asks for a REQUIRED reason (coord refuses a hold
 *   without one; "a hold is not allowed to sit silently").
 * - Unknown (coord's read failed, or a coord build that serves no `hold`
 *   field): an amber `–`, never "not held" (style guide R3). Hold is still
 *   offered — holding only ever stops a merge, so it is safe without knowing.
 * - A GitHub draft with no coord hold: a "GitHub draft" badge and no Release.
 *   coord treats a draft as a hold (plan D1) but cannot undraft; drafts still
 *   exist on public repos, and the console no longer has an undraft action.
 *
 * ## Direction asymmetry (deliberate)
 *
 * RELEASE gets a confirm: it hands the PR back to an auto-lander with no
 * further review step. HOLD asks only for its reason.
 *
 * ## Wire path
 *
 * `httpClient` → the web backend's `POST /api/v1/operations/prs/{owner}/
 * {repo}/{n}/hold` proxy → coord's
 * `POST /coord/repos/{owner}/{repo}/pull-requests/{n}/hold`, body
 * `{held, reason?}`. coord re-evaluates the PR on every place and release, so
 * the merge-gate check run reads "Held by …" (D6). No optimistic UI: success
 * fires `onActed`, which callers wire to a FORCED refetch.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Hand, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  StatusBadge,
  absoluteTime,
  attentionOf,
  relativeTime,
} from "@/components/console";
import { setPrHold } from "@/lib/api/operations/prMerge";
import {
  canOfferRelease,
  describeHoldError,
  holdKindLabel,
  holdViewOf,
  holderLabel,
  splitOwnerRepo,
  type PrHoldFields,
} from "./prHold";
import {
  PR_HOLD_ATTENTION_BY_KIND,
  PR_HOLD_STATUS_PALETTE,
  type PrHoldBadgeKind,
} from "./prHoldStatus";

const log = createLogger("PrHoldControl");

export function PrHoldControl({
  repo,
  prNumber,
  prState,
  hold,
  hasActiveProposal,
  onActed,
}: {
  /** `owner/name`. Anything else renders nothing. */
  repo: string;
  /** Null for a row that has no PR yet (a branch-only pipeline row). */
  prNumber: number | null;
  /** coord's `pr_state`. Only `open` and `draft` render a control. */
  prState: string | null | undefined;
  /**
   * The row's `hold` / `hold_unknown` fields, passed through untouched so an
   * ABSENT `hold` key stays distinguishable from `hold: null`.
   */
  hold: PrHoldFields;
  /** True when a NON-TERMINAL merge proposal exists for this PR. */
  hasActiveProposal: boolean;
  /** Forced refetch after a successful place or release. */
  onActed?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const owner = useMemo(() => splitOwnerRepo(repo), [repo]);
  const view = holdViewOf(hold);
  const repoShort = owner ? owner[1] : repo;

  const submit = useCallback(
    async (held: boolean, why: string | null) => {
      if (owner === null || prNumber === null) return;
      const [ownerName, repoName] = owner;
      setBusy(true);
      try {
        try {
          await setPrHold(ownerName, repoName, prNumber, held, why);
        } catch (err) {
          const status = httpStatusOf(err);
          if (status === null) throw err;
          const text = httpBodyOf(err) ?? "";
          log.warn("hold action failed", status, text);
          toast.error(
            held
              ? `Couldn't hold #${prNumber}`
              : `Couldn't release #${prNumber}`,
            { description: describeHoldError(status, text) }
          );
          return;
        }
        toast.success(
          held
            ? `#${prNumber} held — coord will not land it until the hold is released.`
            : `#${prNumber} released — back in the merge train; coord lands it once nothing else blocks it.`
        );
        setHoldOpen(false);
        setReleaseOpen(false);
        setReason("");
        onActed?.();
      } catch (err) {
        log.warn("hold action threw", err);
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [prNumber, owner, onActed]
  );

  if (owner === null || prNumber === null) return null;
  if (prState !== "open" && prState !== "draft") return null;

  const trimmed = reason.trim();
  // A GitHub draft is a hold signal coord honours (plan D1), but coord cannot
  // undraft, so it gets a badge and no Release. Shown when no coord hold is
  // the one on display.
  const showDraft = prState === "draft" && view.state !== "held";

  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="pr-hold-control"
    >
      {view.state === "unknown" && (
        <span data-testid="pr-hold-unknown" data-hold-state="unknown">
          <HoldBadge
            kind="unknown"
            label="–"
            reason={`hold state unknown: ${view.why}. Do not read this as "not held"`}
          />
        </span>
      )}
      {showDraft && (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="pr-hold-github-draft"
          data-hold-state="github_draft"
        >
          <HoldBadge
            kind="github_draft"
            label="GitHub draft"
            reason="coord treats a draft as a hold; mark it ready for review on GitHub to release it"
          />
          <span>held by GitHub — release it on GitHub</span>
        </span>
      )}
      {view.state === "held" && (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground max-w-[26rem]"
          data-testid="pr-hold-summary"
          data-hold-state="held"
          title={[
            `Held by ${holderLabel(view.hold.held_by)}`,
            view.foreign ? null : `Reason: ${view.hold.reason}`,
            view.foreign ? null : `Kind: ${holdKindLabel(view.hold.kind)}`,
            view.hold.since ? `Since ${absoluteTime(view.hold.since)}` : null,
          ]
            .filter(Boolean)
            .join("\n")}
        >
          <HoldBadge kind="held" label="Held" />
          <span className="truncate">
            by {holderLabel(view.hold.held_by)}
            {!view.foreign && (
              <>
                {" "}
                ({holdKindLabel(view.hold.kind)}) — {view.hold.reason}
              </>
            )}
            {view.hold.since && <> · {relativeTime(view.hold.since)}</>}
          </span>
        </span>
      )}

      <CoordAdminOnly>
        {view.state === "held" ? (
          canOfferRelease(view) && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setReleaseOpen(true)}
                data-testid="pr-hold-release"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Release
              </Button>
              <AlertDialog open={releaseOpen} onOpenChange={setReleaseOpen}>
                <AlertDialogContent data-testid="pr-hold-release-dialog">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Release the hold on #{prNumber}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {repoShort}#{prNumber} is held by{" "}
                      {holderLabel(view.hold.held_by)}: “{view.hold.reason}”.
                      Releasing it returns the PR to the merge train, and coord
                      lands it automatically once nothing else blocks it (CI,
                      its dependencies, a GitHub draft) — there is no further
                      review step.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      onClick={(e) => {
                        e.preventDefault();
                        void submit(false, null);
                      }}
                      data-testid="pr-hold-release-confirm"
                    >
                      Release to merge train
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setHoldOpen(true)}
              data-testid="pr-hold-place"
            >
              <Hand className="h-3.5 w-3.5" />
              Hold
            </Button>
            <AlertDialog open={holdOpen} onOpenChange={setHoldOpen}>
              <AlertDialogContent data-testid="pr-hold-place-dialog">
                <AlertDialogHeader>
                  <AlertDialogTitle>Hold #{prNumber}</AlertDialogTitle>
                  <AlertDialogDescription>
                    coord will not land {repoShort}#{prNumber} while it is held.
                    Say why, so whoever meets the hold knows what releases it.
                    {hasActiveProposal && (
                      <>
                        <br />
                        <br />A merge attempt is already in flight for this PR.
                        coord voids its queued merge proposal when the hold is
                        placed, but one already landing cannot be recalled.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this PR held?"
                  aria-label="Hold reason"
                  data-testid="pr-hold-reason"
                  disabled={busy}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy || trimmed === ""}
                    onClick={(e) => {
                      e.preventDefault();
                      if (trimmed === "") return;
                      void submit(true, trimmed);
                    }}
                    data-testid="pr-hold-place-confirm"
                  >
                    Hold
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CoordAdminOnly>
    </span>
  );
}

/** One hold badge, through the console's audited palette (style guide R3). */
function HoldBadge({
  kind,
  label,
  reason,
}: {
  kind: PrHoldBadgeKind;
  label: string;
  reason?: string;
}) {
  return (
    <StatusBadge
      status={{
        kind,
        label,
        reason,
        attention: attentionOf(PR_HOLD_ATTENTION_BY_KIND, kind),
      }}
      palette={PR_HOLD_STATUS_PALETTE}
    />
  );
}
