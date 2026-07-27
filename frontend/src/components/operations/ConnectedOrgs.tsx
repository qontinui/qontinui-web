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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2 } from "lucide-react";
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
// `repos` may be []; `rollout_state` / `profile_source` may be null.
// ----------------------------------------------------------------------------

interface AccountRepo {
  repo: string;
  rollout_state: string | null;
  profile_source: string | null;
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

function AccountRow({
  account,
  refetch,
}: {
  account: ConnectedAccount;
  refetch: () => Promise<void>;
}) {
  const repos = account.repos ?? [];
  const hasRepos = repos.length > 0;
  const enrolledSummary =
    repos.length === 0
      ? "connected · no repositories enrolled yet"
      : `${repos.length} ${repos.length === 1 ? "repository" : "repositories"} enrolled`;

  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);

  // Interval id for the post-spawn poll; cleared on success, cap, or unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Baseline repo count captured at click time so the poll can detect growth
  // even as the parent re-renders this row with a fresh `account` prop.
  const baselineRef = useRef<number>(repos.length);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // No leaked intervals: clear on unmount.
  useEffect(() => clearPoll, [clearPoll]);

  // Detect enrollment completion: once the row re-renders with more repos than
  // the click-time baseline, stop the spinner + poll.
  useEffect(() => {
    if (enrolling && repos.length > baselineRef.current) {
      clearPoll();
      setEnrolling(false);
      setEnrollMsg(null);
    }
  }, [repos.length, enrolling, clearPoll]);

  const onEnroll = useCallback(async () => {
    if (enrolling) return; // guard double-submit
    clearPoll();
    baselineRef.current = repos.length;
    setEnrolling(true);
    setEnrollError(null);
    setEnrollMsg("Enrolling repositories…");

    try {
      const res = await httpClient.fetch(
        `${API}/pr-merge/onboarding/installations/${account.installation_id}/enroll`,
        { method: "POST", maxRetries: 0 }
      );

      if (res.status === 202 || res.ok) {
        // Spawned. Coord returns no repo list — poll the accounts endpoint until
        // this row's repos grow, capped so a stuck enroll degrades to a soft
        // message rather than an infinite spinner.
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
            // Do NOT claim failure: coord may still be working and the op is
            // idempotent, so a re-click is safe.
            setEnrollMsg(
              "Enrollment is taking longer than expected — refresh to check."
            );
          }
        }, ENROLL_POLL_INTERVAL_MS);
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
  }, [account.installation_id, enrolling, refetch, repos.length, clearPoll]);

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
        <Button
          size="sm"
          variant={hasRepos ? "ghost" : "default"}
          className="ml-auto"
          disabled={enrolling}
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
          {repos.map((r) => (
            <li key={r.repo} className="flex items-center gap-2">
              <Link
                href={`/admin/coord/onboarding-status?repo=${encodeURIComponent(
                  r.repo
                )}`}
                className="text-sm font-mono underline underline-offset-4 hover:text-foreground"
                data-testid={`connected-org-repo-${r.repo}`}
              >
                {r.repo}
              </Link>
              {r.rollout_state && (
                <Badge variant="secondary" className="text-[10px]">
                  {r.rollout_state}
                </Badge>
              )}
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
