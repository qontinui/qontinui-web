"use client";

/**
 * PrDraftStateControl — the operator's draft/ready toggle for a single PR.
 *
 * Shared by both admin surfaces that render a PR's draft state:
 *   - `/admin/coord/fleet`  → `MergePipeline`'s per-row action group
 *   - `/admin/coord/prs`    → `PrsTable`'s actions cell
 *
 * Extracted from `MergePipeline.tsx` (plan
 * `2026-08-01-admin-ui-pr-draft-state-control`) so the second consumer reuses
 * the logic rather than forking it. The prop contract is deliberately
 * PRIMITIVE — neither `PrRow` nor `PipelineRow` appears here, because the two
 * row types are unrelated and must stay so.
 *
 * ## Why draft is a real control and not cosmetic
 *
 * coord's readiness sweep selects `pr_state = 'open'`, NOT `IN ('open','draft')`
 * (`qontinui-coord/src/merge_scheduler.rs`, `recover_absent_proposals_with`), so
 * a draft PR never enters the merge train while still presenting as `DRAFT
 * CLEAN` — the merge-train equivalent of a parked handbrake. This control is the
 * release valve.
 *
 * ## Direction asymmetry (deliberate — do not "simplify" it)
 *
 * RELEASE (`draft:false`) is the direction that gets a confirm: it hands the PR
 * to an auto-lander with no further review step, and a landed commit is not
 * undoable from this UI. HOLD (`draft:true`) is the reversible direction and is
 * one click — EXCEPT when the PR has a live merge proposal, where it gets its
 * own confirm because drafting does NOT stop that proposal (see below).
 *
 * ## The in-flight-proposal hazard
 *
 * Converting a PR to draft does **not** cancel an already-cut merge proposal.
 * Verified end-to-end: the draft-state route writes no coord state beyond
 * GitHub, the `converted_to_draft` webhook only reconciles
 * `coord.repo_branches.pr_state`, and coord states outright that "no writer in
 * the tree terminalizes a proposal off the PR's state". So when a proposal is
 * live, the hold dialog says so and names the real stop lever rather than
 * letting the toggle imply "drafting = stop".
 *
 * ## Wire path
 *
 * `httpClient` → the web backend's `POST /api/v1/operations/prs/{owner}/{repo}/
 * {n}/draft-state` proxy → coord's
 * `POST /coord/repos/{owner}/{repo}/pull-requests/{n}/draft-state`. The frontend
 * never talks to coord directly; the proxy is where the operator bearer and
 * tenant scope are enforced.
 *
 * No optimistic UI: coord's `pr_state` only reconciles when the
 * `ready_for_review` / `converted_to_draft` webhook lands, so success fires
 * `onActed` (which callers wire to a FORCED refetch) rather than mutating local
 * state.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { PenLine, Send } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { prDraftStateUrl } from "./utils";

const log = createLogger("PrDraftStateControl");

/**
 * Split `owner/name` into its two halves. Returns null for anything that isn't
 * a two-part slug, so a malformed repo string renders no control rather than
 * POSTing to a nonsense path.
 */
export function splitOwnerRepo(repo: string): [string, string] | null {
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash >= repo.length - 1) return null;
  return [repo.slice(0, slash), repo.slice(slash + 1)];
}

/**
 * Turn a failed draft-state response into a human line.
 *
 * The proxy returns coord's `{error, message}` body verbatim, and the two 404s
 * mean genuinely different things (`pr_not_found` vs
 * `repo_not_registered_to_tenant`), so collapsing everything into
 * `HTTP <status>` — which the pre-extraction code did — makes an operator
 * unable to tell "wrong repo" from "wrong PR number" from "you are not an
 * admin". A 429 additionally carries `retry_after_secs`, which is the only
 * field that tells the operator what to do next.
 *
 * Falls back to the raw body, then to the bare status, so an unparseable or
 * empty response still says something true.
 */
export function describeDraftStateError(status: number, body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  const rec = parsed as Record<string, unknown>;
  // The proxy nests coord's body under `detail` for some error classes; unwrap
  // one level so the code/message below are found either way.
  const inner =
    typeof rec.detail === "object" && rec.detail !== null
      ? (rec.detail as Record<string, unknown>)
      : rec;

  const code = typeof inner.error === "string" ? inner.error : null;
  const message =
    typeof inner.message === "string"
      ? inner.message
      : typeof inner.detail === "string"
        ? inner.detail
        : null;
  const retryAfter =
    typeof inner.retry_after_secs === "number" ? inner.retry_after_secs : null;

  const parts: string[] = [`HTTP ${status}`];
  if (code) parts.push(code);
  if (message) parts.push(message);
  if (retryAfter !== null) parts.push(`retry after ${retryAfter}s`);
  return parts.join(" — ");
}

export function PrDraftStateControl({
  repo,
  prNumber,
  prState,
  hasActiveProposal,
  onActed,
}: {
  /** `owner/name`. Anything else renders nothing. */
  repo: string;
  /** Null for a row that has no PR yet (a branch-only pipeline row). */
  prNumber: number | null;
  /** coord's `pr_state`. Only `draft` and `open` render a control. */
  prState: string | null | undefined;
  /**
   * True when a NON-TERMINAL merge proposal exists for this PR. Drives the
   * hold-direction hazard warning — drafting will not stop it.
   */
  hasActiveProposal: boolean;
  /** Forced refetch after a successful flip (coord is the source of truth). */
  onActed?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);

  // Memoized because it feeds `submit`'s dependency array — a fresh array
  // literal every render would rebuild the callback on every render and make
  // the `useCallback` pure overhead.
  const owner = useMemo(() => splitOwnerRepo(repo), [repo]);
  const repoShort = owner ? owner[1] : repo;

  const submit = useCallback(
    async (draft: boolean) => {
      if (owner === null || prNumber === null) return;
      const [ownerName, repoName] = owner;
      setBusy(true);
      try {
        const res = await httpClient.fetch(
          prDraftStateUrl(ownerName, repoName, prNumber),
          { method: "POST", body: JSON.stringify({ draft }) }
        );
        if (!res.ok) {
          const text = await res.text();
          log.warn("draft-state action failed", res.status, text);
          toast.error(
            draft
              ? `Couldn't convert #${prNumber} to draft`
              : `Couldn't release #${prNumber}`,
            { description: describeDraftStateError(res.status, text) }
          );
          return;
        }
        toast.success(
          draft
            ? `#${prNumber} converted to draft — held out of the merge train.`
            : `#${prNumber} marked ready for review — coord will land it once CI is green.`
        );
        onActed?.();
      } catch (err) {
        log.warn("draft-state action threw", err);
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [prNumber, owner, onActed]
  );

  // Only surface the toggle when we can act: a real PR number, a splittable
  // `owner/name`, and a draft/open state (never merged/closed/unknown).
  if (owner === null || prNumber === null) return null;
  if (prState !== "draft" && prState !== "open") return null;

  if (prState === "draft") {
    return (
      <CoordAdminOnly>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setReleaseOpen(true)}
          data-testid="pr-ready-for-review"
        >
          <Send className="h-3.5 w-3.5" />
          Ready for review
        </Button>
        <AlertDialog open={releaseOpen} onOpenChange={setReleaseOpen}>
          <AlertDialogContent data-testid="pr-release-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Release #{prNumber} to the merge train?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Marking {repoShort}#{prNumber} ready for review removes the
                draft hold. Once CI is green, coord will land it automatically —
                there is no further review step.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => void submit(false)}
              >
                Release to merge train
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CoordAdminOnly>
    );
  }

  // prState === "open" — the HOLD direction.
  return (
    <CoordAdminOnly>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          // One click normally; a confirm only when a live proposal makes the
          // action mean less than it looks like it means.
          if (hasActiveProposal) setHoldOpen(true);
          else void submit(true);
        }}
        data-testid="pr-convert-to-draft"
      >
        <PenLine className="h-3.5 w-3.5" />
        Convert to draft
      </Button>
      <AlertDialog open={holdOpen} onOpenChange={setHoldOpen}>
        <AlertDialogContent data-testid="pr-hold-hazard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drafting #{prNumber} will not stop its merge attempt
            </AlertDialogTitle>
            <AlertDialogDescription>
              coord has already cut a merge proposal for {repoShort}#{prNumber},
              and converting the PR to draft does <strong>not</strong> cancel
              it — its CI keeps running, and a proposal already landing may
              still push. Drafting only keeps coord from cutting a{" "}
              <em>new</em> proposal later.
              <br />
              <br />
              To actually stop the in-flight attempt, cancel the proposal from
              the{" "}
              <Link href="/admin/coord/fleet" className="underline">
                fleet page
              </Link>{" "}
              — its recovery card carries the proposal id the cancel needs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void submit(true)}>
              Convert to draft anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CoordAdminOnly>
  );
}
