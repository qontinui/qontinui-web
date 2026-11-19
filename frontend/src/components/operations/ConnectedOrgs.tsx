"use client";

/**
 * Connected organizations — account-level onboarding summary (P4).
 *
 * Rendered on `/admin/coord/onboarding-status` for the BARE visit (no `?code`
 * claim params and no `?repo=` deep-link). It reads the GitHub accounts bound
 * to the operator's tenant from the web-backend proxy
 * (`GET /api/v1/operations/pr-merge/onboarding/accounts` → coord
 * `GET /coord/onboarding/github-accounts`) and lists each account with its
 * enrolled repos.
 *
 * The point of this view is to close the empty-org dead-end: a freshly
 * connected org that has not enrolled any repos yet reads as SUCCESS
 * ("connected · no repositories enrolled yet"), not as an error/empty screen.
 * The per-row "Enroll / Sync repositories" button turns that success state into
 * an ACTION: an org whose App is already installed cannot enroll via the
 * Setup-URL `?code=` claim (GitHub issues no code on a re-visit), so this button
 * is its only web trigger. For an already-enrolled org it re-syncs (picks up
 * newly-added repos — a manual fallback to the `installation_repositories`
 * webhook).
 *
 * Each repo is a link to `?repo=owner/name`, which the page switches on to
 * render the existing per-repo {@link OnboardingDoctor} checklist inline.
 *
 * Two visibility gaps closed by plan
 * `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`:
 *
 * - **P2 — the resolved merge posture.** The list used to show only the raw
 *   per-repo pin, which is usually absent, so "is merge on for this repo?"
 *   had no answer here. Every enrolled row now carries an ALWAYS-present
 *   posture indicator from coord's `merge_posture` (computed coord-side by the
 *   same `resolve_merge_enabled` the doctor and merge-settings use — never
 *   re-derived here), linked to `/admin/coord/merge-settings`. The pin badge
 *   stays as the secondary "is there an override?" indicator — two labelled
 *   indicators, never one badge answering two questions.
 * - **P3 — the tombstone.** A repo that was deliberately un-enrolled leaves
 *   only a `tenant_repo_unenrollments` row, and the enroll path SKIPS it
 *   (logged coord-side, invisible in the `202`). The list used to show
 *   nothing, and the enroll poll ended on "taking longer than expected" — a
 *   timeout message for a deliberate refusal. Un-enrolled rows now render
 *   greyed with who/when/why and an admin-gated Re-enroll, and the poll's
 *   terminal message names them.
 *
 * And one from plan `2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant`
 * (Phase 7, D8): a repo of one of this tenant's orgs that a per-repo binding
 * governs from ANOTHER tenant reads "bound to <slug>" and offers no Re-enroll —
 * re-enrolling it here would contradict the binding, and the way back is an
 * unbind on the Repository tenant bindings card. The rows come from coord's
 * `bound_away[]`; a coord that does not send the field gets nothing new
 * rendered, because absent is "not reported", never "none".
 *
 * And the un-enroll, from plan
 * `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 * (Phase 8, D6): an enrolled row carries "Stop governing", beside its undo —
 * the Re-enroll on the un-enrolled rows of the same card. It goes through a
 * consent dialog with a required reason, lands in the project the sidebar has
 * selected, and is confirmed only by a re-read that LISTS the repo as
 * un-enrolled (a read-back that gives up says UNKNOWN). An un-enrolled row now
 * names its cause in words, and a row GitHub's coverage removed offers no
 * Re-enroll — it says what brings the repo back instead. Both controls render
 * only for an administrator of the ACTIVE tenant, inside `OperatorOnly`. The
 * separable half — the words, the dialog, the failure reading and the
 * un-enrollment's state (`useUnenroll`) — is `./ConnectedOrgsUnenroll.tsx`;
 * this file keeps the rows and the accounts re-read poll they share.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { absoluteTime } from "@/components/console/time";
import { UNKNOWN_AMBER } from "@/components/console";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { OperatorOnly } from "@/components/presentation";
import {
  enrollInstallation,
  fetchOnboardingAccounts,
  restoreRepo,
  type AccountRepo,
  type BoundAwayRepo,
  type ConnectedAccount,
  type MergePosture,
} from "@/lib/api/operations/prMergeOnboarding";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import {
  ActiveTenantAdminOnly,
  StopGoverningDialog,
  UnenrollOutcomeLine,
  coverageReturnHint,
  isCoveragePrincipal,
  unenrolledDetail,
  unenrolledDetailTitle,
  useUnenroll,
  type AccountsPoll,
} from "./ConnectedOrgsUnenroll";

// Poll cadence after a 202 enroll-spawn: coord enrolls off-connection, so we
// re-pull the accounts list until this row's repos appear. 3s × 20 ≈ 60s cap.
// An un-enrollment's read-back rides the same poll and cap.
const ENROLL_POLL_INTERVAL_MS = 3000;
const ENROLL_POLL_MAX_ATTEMPTS = 20;
const POLL_BUDGET_SECS =
  (ENROLL_POLL_INTERVAL_MS * ENROLL_POLL_MAX_ATTEMPTS) / 1000;

/**
 * Coord's error body from a rejected enroll/restore, as the card always read
 * it: the JSON object, or `{}` when the body is not JSON.
 */
function rejectionBody(err: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(httpBodyOf(err) ?? "");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The always-present posture label per tier; `null`/absent = older coord. */
const MERGE_POSTURE_LABEL: Record<MergePosture, string> = {
  default: "merge on (default)",
  pinned_on: "merge on (pinned)",
  pinned_off: "merge off (pinned)",
  tenant_paused: "merge paused (tenant)",
  auto_merge_off: "auto-merge off (tenant)",
};

/**
 * Label for the posture indicator. TOTAL over the wire value including the
 * older-coord `null` and any value this build does not know — both render
 * "merge posture unknown" rather than nothing, because an absent indicator
 * is exactly the gap P2 closes.
 */
export function mergePostureLabel(
  posture: MergePosture | string | null | undefined
): string {
  if (posture && posture in MERGE_POSTURE_LABEL) {
    return MERGE_POSTURE_LABEL[posture as MergePosture];
  }
  return "merge posture unknown";
}

function isUnenrolled(r: AccountRepo): boolean {
  return r.state === "unenrolled";
}

/** The `owner` half of `owner/name`, lowercased (coord's key is lowercased). */
function repoOwner(repo: string): string {
  return repo.split("/")[0]?.toLowerCase() ?? "";
}

/**
 * Split coord's `bound_away[]` by org: the entries whose owner is an account
 * on this card, keyed by lowercased login, and the ones no account owns. The
 * second list is rendered too rather than dropped — a row nobody can see is
 * the gap D8 closes.
 */
export function groupBoundAway(
  boundAway: readonly BoundAwayRepo[],
  accounts: readonly ConnectedAccount[]
): { byLogin: Map<string, BoundAwayRepo[]>; unmatched: BoundAwayRepo[] } {
  const logins = new Set(accounts.map((a) => a.account_login.toLowerCase()));
  const byLogin = new Map<string, BoundAwayRepo[]>();
  const unmatched: BoundAwayRepo[] = [];
  for (const b of boundAway) {
    const owner = repoOwner(b.repo);
    if (logins.has(owner)) {
      byLogin.set(owner, [...(byLogin.get(owner) ?? []), b]);
    } else {
      unmatched.push(b);
    }
  }
  return { byLogin, unmatched };
}

/** One "bound to <slug>" row: no link, no Re-enroll. */
function BoundAwayRow({ entry }: { entry: BoundAwayRepo }) {
  return (
    <li
      className="flex items-center gap-2 flex-wrap text-muted-foreground"
      data-testid={`connected-org-repo-bound-away-${entry.repo}`}
      data-ui-bridge-id="operations.connected-org-repo-bound-away"
    >
      <span className="text-sm font-mono">{entry.repo}</span>
      <Badge
        variant="outline"
        className="text-[10px]"
        title={`Governed by tenant ${entry.bound_tenant_slug} through a per-repo binding. Unbind it on the Repository tenant bindings card to return it here.`}
        data-testid={`bound-away-tenant-${entry.repo}`}
        data-ui-bridge-id="operations.connected-org-repo-bound-away-tenant"
      >
        bound to {entry.bound_tenant_slug}
      </Badge>
    </li>
  );
}

// Map coord's status + error code onto a human message. The enroll proxy passes
// coord's status/body through verbatim, so `res.status` + `body.error` are the
// authoritative signals. Status is the discriminator here — both 403 codes
// (`not_coord_tenant_admin` web-gate, `installation_not_owned_by_tenant` coord)
// share one message; 404 is `installation_not_mapped`.
function enrollErrorMessage(status: number, error: string | undefined): string {
  if (status === 403) {
    return "You must be an admin of the tenant this org is connected to.";
  }
  if (status === 404 || error === "installation_not_mapped") {
    return "Connect this organization first.";
  }
  return "Enrollment failed — please try again.";
}

/**
 * The restore proxy's refusals. `404 no_installation_for_owner` carries
 * `restored`, which says whether the tombstone was cleared before the enroll
 * could not find an installation — that changes what the operator does next.
 */
function restoreErrorMessage(
  status: number,
  body: { error?: string; owner?: string; restored?: boolean }
): string {
  if (status === 403) {
    return "You must be an admin of the tenant this org is connected to.";
  }
  if (status === 404 || body.error === "no_installation_for_owner") {
    const owner = body.owner ? ` for ${body.owner}` : "";
    return body.restored
      ? `The un-enrollment was cleared, but no GitHub App installation is connected${owner} — connect the organization, then sync.`
      : `No GitHub App installation is connected${owner} — connect the organization first.`;
  }
  return "Re-enroll failed — please try again.";
}

/**
 * The enroll poll's terminal message when the cap is hit without growth.
 *
 * Coord's `202` cannot report a tombstone-skipped repo, so the poll used to
 * end on the timeout copy for a deliberate refusal. The un-enrolled rows are
 * visible from the same accounts read, which makes this a pure client-side
 * distinction: when any are present at the cap, they are the skipped ones and
 * the message says so. A restore poll's timeout is its own message — the
 * un-enrolled row IS the thing being waited on there.
 */
export function pollTimeoutMessage(
  mode: "enroll" | "restore",
  unenrolledCount: number
): string {
  if (mode === "restore") {
    return "Re-enroll is taking longer than expected — refresh to check.";
  }
  if (unenrolledCount > 0) {
    const noun = unenrolledCount === 1 ? "repository is" : "repositories are";
    return `${unenrolledCount} ${noun} deliberately un-enrolled (tombstoned) and ${
      unenrolledCount === 1 ? "was" : "were"
    } skipped — re-enroll them below.`;
  }
  return "Enrollment is taking longer than expected — refresh to check.";
}

/**
 * One account row's accounts re-read poll, shared by its enroll, restore and
 * un-enroll (one at a time: starting one clears the last). Coord returns no
 * repo list from those writes, so the row re-pulls the accounts endpoint on a
 * timer until the caller sees what it waits for and clears the poll, capped
 * so a stuck write degrades to the caller's give-up message rather than an
 * infinite spinner. Single-flight: a tick that finds the previous read
 * outstanding sends nothing (plan
 * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5). No
 * leaked intervals: a start clears the running poll, and unmount clears it.
 * Exported for its own test (`ConnectedOrgs.poll.test.tsx`), because the
 * row's callers clear the poll before they start one, so the card's suite
 * cannot reach a start over a running poll.
 */
export function useAccountsPoll(
  refetch: (polled?: boolean) => Promise<void>
): AccountsPoll {
  // Interval id of the running poll; cleared on success, cap, or unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readInFlightRef = useRef(false);

  const clear = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const start = useCallback<AccountsPoll["start"]>(
    ({ immediate, onGiveUp }) => {
      // One poll at a time. A replaced interval would keep re-reading unseen:
      // its ticks return before the cap once it is no longer the current poll.
      clear();
      let attempts = 0;
      let lastReadFailed = false;
      const pollAccountsOnce = async () => {
        if (readInFlightRef.current) return;
        readInFlightRef.current = true;
        try {
          await refetch(true);
          lastReadFailed = false;
        } catch {
          // transient — keep polling until the cap
          lastReadFailed = true;
        } finally {
          readInFlightRef.current = false;
        }
      };
      const id = setInterval(async () => {
        attempts += 1;
        await pollAccountsOnce();
        // A read whose result ended the poll has already said so.
        if (pollRef.current !== id) return;
        if (attempts >= ENROLL_POLL_MAX_ATTEMPTS) {
          clear();
          onGiveUp(lastReadFailed);
        }
      }, ENROLL_POLL_INTERVAL_MS);
      pollRef.current = id;
      if (immediate) void pollAccountsOnce();
    },
    [refetch, clear]
  );

  return useMemo(
    () => ({ start, clear, budgetSecs: POLL_BUDGET_SECS }),
    [start, clear]
  );
}

/**
 * One enrolled repo: its onboarding-checklist link, the resolved merge
 * posture, the raw pin when one is set, and Stop governing.
 */
function EnrolledRepoRow({
  row,
  busy,
  stopping,
  onStopGoverning,
}: {
  row: AccountRepo;
  /** Any action on this account is in flight. */
  busy: boolean;
  /** This repo's un-enrollment is in flight. */
  stopping: boolean;
  onStopGoverning: () => void;
}) {
  return (
    <li className="flex items-center gap-2 flex-wrap">
      <Link
        href={`/admin/coord/onboarding-status?repo=${encodeURIComponent(
          row.repo
        )}`}
        className="text-sm font-mono underline underline-offset-4 hover:text-foreground"
        data-testid={`connected-org-repo-${row.repo}`}
      >
        {row.repo}
      </Link>
      {/* The RESOLVED posture — always present (P2). Coord computed it with
          the same `resolve_merge_enabled` the doctor and Merge settings use,
          so this is the answer, not a re-derivation. `null` (older coord)
          says "unknown" rather than rendering nothing — an absent indicator
          is the gap. */}
      <Link
        href="/admin/coord/merge-settings"
        title="Resolved merge posture (tenant pause → per-repo pin → tenant auto-merge → default). Open Merge settings to change it."
        data-testid={`merge-posture-${row.repo}`}
        data-posture={row.merge_posture ?? "unknown"}
      >
        <Badge
          variant={
            row.merge_posture == null
              ? "outline"
              : row.merge_enabled_resolved === false
                ? "destructive"
                : "secondary"
          }
          className="text-[10px]"
        >
          {mergePostureLabel(row.merge_posture)}
        </Badge>
      </Link>
      {/* The RAW per-repo pin, shown ONLY when one is set — the secondary "is
          there an override?" indicator. An inheriting repo (`null`) renders no
          pin badge, which is the common case and the correct one; the posture
          badge above already carries the resolved answer. */}
      {row.merge_enabled !== null && row.merge_enabled !== undefined && (
        <Badge
          variant={row.merge_enabled ? "secondary" : "destructive"}
          className="text-[10px]"
          title="Explicit per-repo pin — not the resolved merge posture (a tenant-wide pause overrides it). See Merge settings."
          data-testid={`merge-pin-${row.repo}`}
        >
          {row.merge_enabled ? "merge pinned on" : "merge pinned off"}
        </Badge>
      )}
      {/* The un-enroll, beside the repo it governs and on the same card as its
          undo (Re-enroll, on the un-enrolled rows). A write control: never
          mounted in presentation mode, and offered only to an administrator
          of the ACTIVE tenant — the question the route's
          `require_coord_tenant_admin_target` asks. */}
      <OperatorOnly>
        <ActiveTenantAdminOnly>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 px-2 text-xs"
            disabled={busy}
            aria-busy={stopping || undefined}
            // Every enrolled row carries one: the name says which.
            aria-label={
              stopping
                ? `Stopping governance of ${row.repo}`
                : `Stop governing ${row.repo}`
            }
            onClick={onStopGoverning}
            data-testid={`stop-governing-${row.repo}`}
            data-ui-bridge-id="operations.connected-org-stop-governing"
          >
            {stopping ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Stopping…
              </>
            ) : (
              "Stop governing…"
            )}
          </Button>
        </ActiveTenantAdminOnly>
      </OperatorOnly>
    </li>
  );
}

/**
 * One un-enrolled repo: its cause in words (coord's raw principal and reason
 * in the `title`), and the way back — Re-enroll for a decision, or, for a row
 * GitHub's coverage removed, what brings it back on GitHub.
 */
function UnenrolledRepoRow({
  row,
  busy,
  restoring,
  onRestore,
}: {
  row: AccountRepo;
  /** Any action on this account is in flight. */
  busy: boolean;
  /** This repo's restore is in flight. */
  restoring: boolean;
  onRestore: () => void;
}) {
  const coverage = isCoveragePrincipal(row.unenrolled_by);
  return (
    <li
      className="flex items-center gap-2 flex-wrap text-muted-foreground"
      data-testid={`connected-org-repo-unenrolled-${row.repo}`}
      data-unenroll-cause={coverage ? "coverage" : "decision"}
    >
      <span className="text-sm font-mono line-through decoration-muted-foreground/60">
        {row.repo}
      </span>
      <span
        className="text-xs"
        title={unenrolledDetailTitle(row)}
        data-testid={`unenrolled-detail-${row.repo}`}
      >
        {unenrolledDetail(row, absoluteTime(row.unenrolled_at))}
      </span>
      {coverage ? (
        // No Re-enroll: the restore clears the un-enrollment before it
        // enrolls, and a repo GitHub does not list enrolls nothing — so here
        // it would only delete the record a later re-add converges on. The
        // way back is on GitHub.
        <span
          className="text-xs"
          data-testid={`unenrolled-app-access-hint-${row.repo}`}
          data-ui-bridge-id="operations.connected-org-app-access-hint"
        >
          {coverageReturnHint(row.repo)}
        </span>
      ) : (
        // Gated like the un-enroll it undoes: the restore re-opens enrollment
        // (profile writes, a possible bootstrap PR) and its route checks admin
        // in the active tenant (`require_coord_tenant_admin`).
        <OperatorOnly>
          <ActiveTenantAdminOnly>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={busy}
              onClick={onRestore}
              data-testid={`reenroll-repo-${row.repo}`}
              data-ui-bridge-id="operations.connected-org-reenroll"
            >
              {restoring ? "Re-enrolling…" : "Re-enroll"}
            </Button>
          </ActiveTenantAdminOnly>
        </OperatorOnly>
      )}
    </li>
  );
}

function AccountRow({
  account,
  boundAway,
  refetch,
}: {
  account: ConnectedAccount;
  /**
   * This org's repos that a binding governs from another tenant, from coord's
   * `bound_away[]`; empty when coord reported none or did not send the field.
   */
  boundAway: readonly BoundAwayRepo[];
  /**
   * `polled` marks a read the post-enroll poll issues: one request, no 5xx
   * retry chain (the next tick is the retry). A polled read REJECTS when it
   * fails, rather than replacing the list with an error line — which would
   * unmount this row and end the poll watching it.
   */
  refetch: (polled?: boolean) => Promise<void>;
}) {
  // A bound-away repo is the binding's to govern, so it never renders as an
  // enrolled or a Re-enroll-able row here, whatever else coord lists for it.
  const boundAwayKeys = new Set(boundAway.map((b) => b.repo.toLowerCase()));
  const repos = (account.repos ?? []).filter(
    (r) => !boundAwayKeys.has(r.repo.toLowerCase())
  );
  const enrolledRepos = repos.filter((r) => !isUnenrolled(r));
  const unenrolledRepos = repos.filter(isUnenrolled);
  const hasRepos = enrolledRepos.length > 0;
  const enrolledSummary =
    enrolledRepos.length === 0
      ? "connected · no repositories enrolled yet"
      : `${enrolledRepos.length} ${enrolledRepos.length === 1 ? "repository" : "repositories"} enrolled`;

  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  // The repo whose restore is in flight (spinner + disabled button on that row).
  const [restoring, setRestoring] = useState<string | null>(null);

  const poll = useAccountsPoll(refetch);
  // Baseline ENROLLED count captured at click time so the poll can detect
  // growth even as the parent re-renders this row with a fresh `account` prop.
  const baselineRef = useRef<number>(enrolledRepos.length);
  // Latest tombstone count, read by the poll's give-up (which would otherwise
  // see the click-time value).
  const unenrolledCountRef = useRef<number>(unenrolledRepos.length);
  unenrolledCountRef.current = unenrolledRepos.length;

  const clearMessages = useCallback(() => {
    setEnrollError(null);
    setEnrollMsg(null);
  }, []);
  const rereadOnce = useCallback(() => refetch(true), [refetch]);
  const unenroll = useUnenroll({
    enrolled: enrolledRepos,
    unenrolled: unenrolledRepos,
    otherBusy: enrolling || restoring !== null,
    poll,
    rereadOnce,
    onStart: clearMessages,
  });
  const { clearOutcome } = unenroll;
  const busy = enrolling || restoring !== null || unenroll.unenrolling !== null;

  // Detect completion: once the row re-renders with more ENROLLED repos than
  // the click-time baseline, stop the spinner + poll. A restore flips one row
  // from un-enrolled to enrolled, which is the same growth.
  useEffect(() => {
    if (
      (enrolling || restoring !== null) &&
      enrolledRepos.length > baselineRef.current
    ) {
      poll.clear();
      setEnrolling(false);
      setRestoring(null);
      setEnrollMsg(null);
    }
  }, [enrolledRepos.length, enrolling, restoring, poll]);

  /** The enroll / restore poll, which ends its spinner on its own give-up. */
  const startGrowthPoll = useCallback(
    (mode: "enroll" | "restore") =>
      poll.start({
        immediate: false,
        onGiveUp: () => {
          setEnrolling(false);
          setRestoring(null);
          // Do NOT claim failure: coord may still be working and the op is
          // idempotent, so a re-click is safe.
          setEnrollMsg(pollTimeoutMessage(mode, unenrolledCountRef.current));
        },
      }),
    [poll]
  );

  const onEnroll = useCallback(async () => {
    if (busy) return; // guard double-submit
    poll.clear();
    baselineRef.current = enrolledRepos.length;
    setEnrolling(true);
    clearOutcome();
    setEnrollError(null);
    setEnrollMsg("Enrolling repositories…");

    try {
      // A 2xx (coord answers 202) means the enroll was spawned.
      await enrollInstallation(account.installation_id);
      startGrowthPoll("enroll");
    } catch (err) {
      setEnrolling(false);
      setEnrollMsg(null);
      const status = httpStatusOf(err);
      if (status === null) {
        setEnrollError("Enrollment failed — please try again.");
        return;
      }
      // Non-ok: read coord's error code and map to copy.
      const body = rejectionBody(err) as { error?: string };
      setEnrollError(enrollErrorMessage(status, body.error));
    }
  }, [
    account.installation_id,
    busy,
    enrolledRepos.length,
    poll,
    clearOutcome,
    startGrowthPoll,
  ]);

  const onRestore = useCallback(
    async (repo: string) => {
      if (busy) return; // guard double-submit
      poll.clear();
      baselineRef.current = enrolledRepos.length;
      setRestoring(repo);
      clearOutcome();
      setEnrollError(null);
      setEnrollMsg(`Re-enrolling ${repo}…`);

      try {
        await restoreRepo(repo);
        startGrowthPoll("restore");
      } catch (err) {
        setRestoring(null);
        setEnrollMsg(null);
        const status = httpStatusOf(err);
        if (status === null) {
          setEnrollError("Re-enroll failed — please try again.");
          return;
        }
        const body = rejectionBody(err) as {
          error?: string;
          owner?: string;
          restored?: boolean;
        };
        setEnrollError(restoreErrorMessage(status, body));
      }
    },
    [busy, enrolledRepos.length, poll, clearOutcome, startGrowthPoll]
  );

  return (
    <li
      className="border-b border-border pb-3 last:border-b-0 last:pb-0"
      data-testid={`connected-org-${account.account_login}`}
    >
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0" />
        <span className="font-medium font-mono">{account.account_login}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          {account.account_type}
        </span>
        <span className="text-muted-foreground">·</span>
        <span
          className="text-xs text-muted-foreground"
          data-testid={`connected-org-repo-count-${account.account_login}`}
        >
          {enrolledSummary}
        </span>
        {unenrolledRepos.length > 0 && (
          <>
            <span className="text-muted-foreground">·</span>
            <span
              className="text-xs text-muted-foreground"
              data-testid={`connected-org-unenrolled-count-${account.account_login}`}
            >
              {unenrolledRepos.length} un-enrolled
            </span>
          </>
        )}
        <Button
          size="sm"
          variant={hasRepos ? "ghost" : "default"}
          className="ml-auto"
          disabled={busy}
          onClick={onEnroll}
          data-testid={`enroll-repos-${account.account_login}`}
        >
          {enrolling
            ? "Enrolling…"
            : hasRepos
              ? "Sync repositories"
              : "Enroll repositories"}
        </Button>
      </div>
      {enrollMsg && (
        <p
          className="mt-1 pl-6 text-xs text-muted-foreground"
          data-testid={`enroll-status-${account.account_login}`}
        >
          {enrollMsg}
        </p>
      )}
      {enrollError && (
        <p
          className="mt-1 pl-6 text-xs text-destructive"
          data-testid={`enroll-error-${account.account_login}`}
        >
          {enrollError}
        </p>
      )}
      {unenroll.outcome && (
        <UnenrollOutcomeLine
          outcome={unenroll.outcome}
          data-testid={`unenroll-outcome-${account.account_login}`}
        />
      )}
      {(repos.length > 0 || boundAway.length > 0) && (
        <ul className="mt-2 space-y-1 pl-6">
          {enrolledRepos.map((r) => (
            <EnrolledRepoRow
              key={r.repo}
              row={r}
              busy={busy}
              stopping={unenroll.unenrolling === r.repo}
              onStopGoverning={() => unenroll.openDialog(r.repo)}
            />
          ))}
          {unenrolledRepos.map((r) => (
            <UnenrolledRepoRow
              key={r.repo}
              row={r}
              busy={busy}
              restoring={restoring === r.repo}
              onRestore={() => onRestore(r.repo)}
            />
          ))}
          {boundAway.map((b) => (
            <BoundAwayRow key={b.repo} entry={b} />
          ))}
        </ul>
      )}
      {unenroll.dialogRepo !== null && (
        <OperatorOnly>
          <StopGoverningDialog
            key={unenroll.dialogRepo}
            repo={unenroll.dialogRepo}
            onCancel={unenroll.closeDialog}
            onConfirm={(repo, reason, tenantId) =>
              void unenroll.confirm(repo, reason, tenantId)
            }
          />
        </OperatorOnly>
      )}
    </li>
  );
}

/**
 * The repos no listed org owns, under their own heading. Rendered beside the
 * account list AND beside the empty state: a bound-away repo whose org has no
 * row here is still one nobody could otherwise see (D8).
 */
function UnmatchedBoundAway({
  entries,
}: {
  entries: readonly BoundAwayRepo[];
}) {
  if (entries.length === 0) return null;
  return (
    <div
      data-testid="connected-orgs-bound-away-unmatched"
      data-ui-bridge-id="operations.connected-orgs-bound-away-unmatched"
    >
      <p className="text-xs text-muted-foreground">
        Bound to another tenant (organization not listed above)
      </p>
      <ul className="mt-1 space-y-1 pl-6">
        {entries.map((b) => (
          <BoundAwayRow key={b.repo} entry={b} />
        ))}
      </ul>
    </div>
  );
}

export interface ConnectedOrgsProps {
  /**
   * Bumped by the page whenever a per-repo binding is written (the Repository
   * tenant bindings card's bind / unbind). Each change re-reads the accounts
   * IN PLACE — the card is never remounted for it, which would cancel an
   * in-flight enroll poll — so the "bound to <slug>" rows follow the binding.
   */
  bindingsVersion?: number;
}

export function ConnectedOrgs({ bindingsVersion }: ConnectedOrgsProps = {}) {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  // `undefined` = coord did not send `bound_away` (an older coord): render
  // nothing new. `[]` = coord measured none.
  const [boundAway, setBoundAway] = useState<BoundAwayRepo[] | undefined>(
    undefined
  );
  // coord's `bindings_error`: it has the field but could not read the
  // bindings, so the bound-away repos are UNKNOWN — not "none", and not
  // listed under their org either (their `tenant_repos` rows moved away).
  const [bindingsError, setBindingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (polled = false) => {
    try {
      const body = await fetchOnboardingAccounts(
        polled ? COORD_DASHBOARD_POLL_OPTIONS : undefined
      );
      setAccounts(body.accounts ?? []);
      setBoundAway(
        Array.isArray(body.bound_away) ? body.bound_away : undefined
      );
      setBindingsError(
        Array.isArray(body.bound_away)
          ? null
          : typeof body.bindings_error === "string"
            ? body.bindings_error.trim() || "coord gave no reason"
            : null
      );
      setError(null);
    } catch (e) {
      // A poll tick's failure belongs to the poll that issued it: the next
      // tick is the retry, and an un-enrollment's read-back ends in UNKNOWN
      // rather than in a guess. Replacing the list with an error line would
      // unmount the very row that is polling, and its outcome with it.
      if (polled) throw e;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const grouped = useMemo(
    () => groupBoundAway(boundAway ?? [], accounts ?? []),
    [boundAway, accounts]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  // A binding written elsewhere on the page: re-read silently (no skeleton),
  // like the enroll poll does. The mount value is skipped — the effect above
  // already reads once on mount.
  const seenBindingsVersion = useRef(bindingsVersion);
  useEffect(() => {
    if (bindingsVersion === seenBindingsVersion.current) return;
    seenBindingsVersion.current = bindingsVersion;
    void refetch();
  }, [bindingsVersion, refetch]);

  return (
    <Card data-testid="connected-orgs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Connected organizations
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          GitHub accounts connected to your workspace and the repositories
          enrolled for merge orchestration. Select a repository to open its
          onboarding checklist.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p
            className="text-sm text-destructive"
            data-testid="connected-orgs-error"
          >
            {error}
          </p>
        ) : accounts && accounts.length > 0 ? (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <AccountRow
                key={a.installation_id || a.account_login}
                account={a}
                boundAway={
                  grouped.byLogin.get(a.account_login.toLowerCase()) ?? []
                }
                refetch={refetch}
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-2" data-testid="connected-orgs-empty">
            <p className="text-sm text-muted-foreground">
              No GitHub organizations connected yet.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/coord/onboarding">
                Connect your GitHub organization
              </Link>
            </Button>
          </div>
        )}
        {!loading && !error && bindingsError && (
          <p
            className={`rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
            role="status"
            title={bindingsError}
            data-testid="connected-orgs-bindings-unknown"
            data-ui-bridge-id="operations.connected-orgs-bindings-unknown"
          >
            Repositories bound to other tenants: UNKNOWN — coord could not read
            the per-repo bindings, so a repository bound elsewhere is not shown
            here.
          </p>
        )}
        {!loading && !error && (
          <UnmatchedBoundAway entries={grouped.unmatched} />
        )}
      </CardContent>
    </Card>
  );
}
