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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2 } from "lucide-react";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { absoluteTime } from "@/components/console/time";
import { httpClient } from "@/services/service-factory";

// Same relative base the OnboardingDoctor uses (Next.js proxies /api to the
// web backend, which forwards to coord with the operator's bearer).
const API = "/api/v1/operations";

// Poll cadence after a 202 enroll-spawn: coord enrolls off-connection, so we
// re-pull the accounts list until this row's repos appear. 3s × 20 ≈ 60s cap.
const ENROLL_POLL_INTERVAL_MS = 3000;
const ENROLL_POLL_MAX_ATTEMPTS = 20;

// ----------------------------------------------------------------------------
// Wire types — coord-owned contract (GET /coord/onboarding/github-accounts).
// `repos` may be []. Fields marked "older coord" are absent/null on a coord
// that predates plan 2026-09-05 P2/P3, and every reader here tolerates that.
// ----------------------------------------------------------------------------

/**
 * The tier that decided a repo's resolved merge posture, in coord's own
 * arm order (the onboarding doctor's): the tenant-wide pause dominates, then
 * the explicit per-repo pin, then an explicit `auto_merge_enabled = false`,
 * else the enabled default.
 */
export type MergePosture =
  | "default"
  | "pinned_on"
  | "pinned_off"
  | "tenant_paused"
  | "auto_merge_off";

interface AccountRepo {
  repo: string;
  /**
   * `"enrolled"` — a live `tenant_repos` row. `"unenrolled"` — only the
   * un-enrollment tombstone remains; the installation enroll skips this repo
   * until it is restored. Absent on an older coord, which lists enrolled rows
   * only, so absent reads as enrolled.
   */
  state?: "enrolled" | "unenrolled";
  /**
   * The RAW per-repo enablement pin: `true`/`false` = explicitly pinned,
   * `null` = inheriting the enabled default. NOT the resolved verdict — the
   * tenant-wide `merge_paused` pause dominates it and is not folded in here;
   * `merge_enabled_resolved` is. Replaced `rollout_state` when plan
   * `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`
   * Phase 5 dropped that column.
   */
  merge_enabled: boolean | null;
  /**
   * The RESOLVED verdict, computed coord-side by `resolve_merge_enabled`
   * (pause → pin → default) AND-ed with the tenant's `auto_merge_enabled` —
   * the same conjunction the doctor and `EffectiveProfile::merge_permitted`
   * apply. `null` on an un-enrolled row or an older coord.
   */
  merge_enabled_resolved?: boolean | null;
  /** The tier that decided `merge_enabled_resolved`. `null` = older coord. */
  merge_posture?: MergePosture | null;
  profile_source: string | null;
  /** Tombstone fields — set only when `state === "unenrolled"`. */
  unenrolled_at?: string | null;
  unenrolled_by?: string | null;
  unenroll_reason?: string | null;
}

interface ConnectedAccount {
  account_login: string;
  account_type: string;
  installation_id: number;
  repos: AccountRepo[];
}

interface AccountsResponse {
  accounts: ConnectedAccount[];
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

function AccountRow({
  account,
  refetch,
}: {
  account: ConnectedAccount;
  refetch: () => Promise<void>;
}) {
  const repos = account.repos ?? [];
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

  // Interval id for the post-spawn poll; cleared on success, cap, or unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Baseline ENROLLED count captured at click time so the poll can detect
  // growth even as the parent re-renders this row with a fresh `account` prop.
  const baselineRef = useRef<number>(enrolledRepos.length);
  // Latest tombstone count, read by the poll's timeout closure (which would
  // otherwise see the click-time value).
  const unenrolledCountRef = useRef<number>(unenrolledRepos.length);
  unenrolledCountRef.current = unenrolledRepos.length;

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // No leaked intervals: clear on unmount.
  useEffect(() => clearPoll, [clearPoll]);

  // Detect completion: once the row re-renders with more ENROLLED repos than
  // the click-time baseline, stop the spinner + poll. A restore flips one row
  // from un-enrolled to enrolled, which is the same growth.
  useEffect(() => {
    if (
      (enrolling || restoring !== null) &&
      enrolledRepos.length > baselineRef.current
    ) {
      clearPoll();
      setEnrolling(false);
      setRestoring(null);
      setEnrollMsg(null);
    }
  }, [enrolledRepos.length, enrolling, restoring, clearPoll]);

  /**
   * Start the post-`202` poll. Coord returns no repo list — re-pull the
   * accounts endpoint until this row's enrolled repos grow, capped so a stuck
   * enroll degrades to a soft message rather than an infinite spinner.
   */
  const startPoll = useCallback(
    (mode: "enroll" | "restore") => {
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          await refetch();
        } catch {
          // transient — keep polling until the cap
        }
        if (attempts >= ENROLL_POLL_MAX_ATTEMPTS) {
          clearPoll();
          setEnrolling(false);
          setRestoring(null);
          // Do NOT claim failure: coord may still be working and the op is
          // idempotent, so a re-click is safe.
          setEnrollMsg(pollTimeoutMessage(mode, unenrolledCountRef.current));
        }
      }, ENROLL_POLL_INTERVAL_MS);
    },
    [refetch, clearPoll]
  );

  const onEnroll = useCallback(async () => {
    if (enrolling || restoring !== null) return; // guard double-submit
    clearPoll();
    baselineRef.current = enrolledRepos.length;
    setEnrolling(true);
    setEnrollError(null);
    setEnrollMsg("Enrolling repositories…");

    try {
      const res = await httpClient.fetch(
        `${API}/pr-merge/onboarding/installations/${account.installation_id}/enroll`,
        { method: "POST", maxRetries: 0 }
      );

      if (res.status === 202 || res.ok) {
        startPoll("enroll");
        return;
      }

      // Non-ok: read coord's error code and map to copy.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setEnrolling(false);
      setEnrollMsg(null);
      setEnrollError(enrollErrorMessage(res.status, body.error));
    } catch {
      setEnrolling(false);
      setEnrollMsg(null);
      setEnrollError("Enrollment failed — please try again.");
    }
  }, [
    account.installation_id,
    enrolling,
    restoring,
    enrolledRepos.length,
    clearPoll,
    startPoll,
  ]);

  const onRestore = useCallback(
    async (repo: string) => {
      if (enrolling || restoring !== null) return; // guard double-submit
      clearPoll();
      baselineRef.current = enrolledRepos.length;
      setRestoring(repo);
      setEnrollError(null);
      setEnrollMsg(`Re-enrolling ${repo}…`);

      try {
        const res = await httpClient.fetch(
          `${API}/pr-merge/onboarding/repos/${repo}/restore`,
          { method: "POST", maxRetries: 0 }
        );

        if (res.status === 202 || res.ok) {
          startPoll("restore");
          return;
        }

        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          owner?: string;
          restored?: boolean;
        };
        setRestoring(null);
        setEnrollMsg(null);
        setEnrollError(restoreErrorMessage(res.status, body));
      } catch {
        setRestoring(null);
        setEnrollMsg(null);
        setEnrollError("Re-enroll failed — please try again.");
      }
    },
    [enrolling, restoring, enrolledRepos.length, clearPoll, startPoll]
  );

  const busy = enrolling || restoring !== null;

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
      {repos.length > 0 && (
        <ul className="mt-2 space-y-1 pl-6">
          {enrolledRepos.map((r) => (
            <li key={r.repo} className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/admin/coord/onboarding-status?repo=${encodeURIComponent(
                  r.repo
                )}`}
                className="text-sm font-mono underline underline-offset-4 hover:text-foreground"
                data-testid={`connected-org-repo-${r.repo}`}
              >
                {r.repo}
              </Link>
              {/* The RESOLVED posture — always present (P2). Coord computed
                  it with the same `resolve_merge_enabled` the doctor and
                  Merge settings use, so this is the answer, not a
                  re-derivation. `null` (older coord) says "unknown" rather
                  than rendering nothing — an absent indicator is the gap. */}
              <Link
                href="/admin/coord/merge-settings"
                title="Resolved merge posture (tenant pause → per-repo pin → tenant auto-merge → default). Open Merge settings to change it."
                data-testid={`merge-posture-${r.repo}`}
                data-posture={r.merge_posture ?? "unknown"}
              >
                <Badge
                  variant={
                    r.merge_posture == null
                      ? "outline"
                      : r.merge_enabled_resolved === false
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px]"
                >
                  {mergePostureLabel(r.merge_posture)}
                </Badge>
              </Link>
              {/* The RAW per-repo pin, shown ONLY when one is set — the
                  secondary "is there an override?" indicator. An inheriting
                  repo (`null`) renders no pin badge, which is the common case
                  and the correct one; the posture badge above already carries
                  the resolved answer. */}
              {r.merge_enabled !== null && r.merge_enabled !== undefined && (
                <Badge
                  variant={r.merge_enabled ? "secondary" : "destructive"}
                  className="text-[10px]"
                  title="Explicit per-repo pin — not the resolved merge posture (a tenant-wide pause overrides it). See Merge settings."
                  data-testid={`merge-pin-${r.repo}`}
                >
                  {r.merge_enabled ? "merge pinned on" : "merge pinned off"}
                </Badge>
              )}
            </li>
          ))}
          {unenrolledRepos.map((r) => (
            <li
              key={r.repo}
              className="flex items-center gap-2 flex-wrap text-muted-foreground"
              data-testid={`connected-org-repo-unenrolled-${r.repo}`}
            >
              <span className="text-sm font-mono line-through decoration-muted-foreground/60">
                {r.repo}
              </span>
              <span
                className="text-xs"
                data-testid={`unenrolled-detail-${r.repo}`}
              >
                removed {absoluteTime(r.unenrolled_at)} by{" "}
                {r.unenrolled_by || "unknown"}: {r.unenroll_reason || "no reason recorded"}
              </span>
              {/* Admin-gated like every other mutation on this surface: the
                  restore re-opens enrollment (profile writes, a possible
                  bootstrap PR). The backend gate is `require_coord_tenant_admin`;
                  this is the UX layer that keeps the surface honest. */}
              <CoordAdminOnly>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  disabled={busy}
                  onClick={() => onRestore(r.repo)}
                  data-testid={`reenroll-repo-${r.repo}`}
                >
                  {restoring === r.repo ? "Re-enrolling…" : "Re-enroll"}
                </Button>
              </CoordAdminOnly>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ConnectedOrgs() {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const body = await httpClient.get<AccountsResponse>(
        `${API}/pr-merge/onboarding/accounts`
      );
      setAccounts(body.accounts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
      </CardContent>
    </Card>
  );
}
