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
 *
 * Each repo is a link to `?repo=owner/name`, which the page switches on to
 * render the existing per-repo {@link OnboardingDoctor} checklist inline.
 */

import { useEffect, useState } from "react";
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

function AccountRow({ account }: { account: ConnectedAccount }) {
  const repos = account.repos ?? [];
  const enrolledSummary =
    repos.length === 0
      ? "connected · no repositories enrolled yet"
      : `${repos.length} ${repos.length === 1 ? "repository" : "repositories"} enrolled`;

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
      </div>
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    httpClient
      .get<AccountsResponse>(`${API}/pr-merge/onboarding/accounts`)
      .then((body) => {
        if (cancelled) return;
        setAccounts(body.accounts ?? []);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
