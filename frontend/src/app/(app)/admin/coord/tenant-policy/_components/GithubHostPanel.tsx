"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Github, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTenantGithubHost } from "../_hooks/useTenantGithubHost";

/**
 * The tenant's GitHub host — github.com, or a GitHub Enterprise Server /
 * GHE.com instance (plan `2026-10-10-spec-front-end-phase-9-generic-boundary`
 * Phase 3; parent `2026-10-09-spec-front-end-of-the-software-factory` Phase 9
 * item 4). Reads and writes the tenant's row in `coord.tenant_github_hosts`
 * through `/operations/tenant/github-host`.
 *
 * The states kept apart:
 *
 * * `configured: false` — no row; coord uses github.com.
 * * `configured: null` or a failed first read — UNKNOWN, never github.com.
 * * a refused write — coord's reason, and for
 *   `repos_registered_on_another_host` the repos that block the change.
 *
 * Coord changes which host the tenant's URLs and API calls name; it never
 * redirects the GitHub App's token, so the copy says the App must be
 * installed on the configured host.
 */
export function GithubHostPanel() {
  const { host, loading, saving, error, writeError, reload, save, reset } =
    useTenantGithubHost();
  const [apiBase, setApiBase] = useState("");
  const [webBase, setWebBase] = useState("");

  // Seed the form from what coord stores — only a configured host, so the
  // github.com default is never offered as an edit of itself.
  useEffect(() => {
    if (host?.configured) {
      setApiBase(host.api_base ?? "");
      setWebBase(host.web_base ?? "");
    }
  }, [host]);

  const canEdit = host?.can_edit === true;
  const configured = host?.configured ?? null;
  const dirty =
    apiBase.trim() !== (host?.configured ? (host.api_base ?? "") : "") ||
    webBase.trim() !== (host?.configured ? (host.web_base ?? "") : "");
  const canSave =
    canEdit &&
    !saving &&
    apiBase.trim() !== "" &&
    webBase.trim() !== "" &&
    dirty;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="github-host-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Github className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">GitHub host</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Where this tenant&apos;s repositories live: github.com, or a
              GitHub Enterprise Server or GHE.com instance. Coord sends its
              GitHub API calls and builds its repository, clone and pull request
              links against this host.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              The Qontinui GitHub App must be installed on the host you set
              here. Coord never sends the App&apos;s github.com token to another
              host, so without an installation every GitHub operation for this
              tenant fails.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="github-host-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !host ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Coord uses</span>
            <Badge
              variant={configured ? "default" : "outline"}
              data-testid="github-host-effective"
            >
              {host?.web_base ?? "unknown"}
            </Badge>
            <span data-testid="github-host-source">
              {configured === true
                ? "— set for this tenant."
                : configured === false
                  ? "— the default; no host is set for this tenant."
                  : "— whether this tenant sets its own host is unknown."}
            </span>
          </div>

          {configured && host?.api_base && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="github-host-api"
            >
              API: <code>{host.api_base}</code>
              {host.graphql_url && (
                <>
                  {" "}
                  · GraphQL: <code>{host.graphql_url}</code>
                </>
              )}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="github-host-web-base" className="text-xs">
                Web base
              </Label>
              <Input
                id="github-host-web-base"
                value={webBase}
                onChange={(e) => setWebBase(e.target.value)}
                placeholder="https://ghe.example.com"
                disabled={!canEdit || saving}
                data-testid="github-host-web-base"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="github-host-api-base" className="text-xs">
                API base
              </Label>
              <Input
                id="github-host-api-base"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder="https://ghe.example.com/api/v3"
                disabled={!canEdit || saving}
                data-testid="github-host-api-base"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canSave}
              onClick={() =>
                void save({
                  api_base: apiBase.trim(),
                  web_base: webBase.trim(),
                })
              }
              data-testid="github-host-save"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save host
            </Button>
            {configured === true && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || saving}
                onClick={() => {
                  // Clear only once coord accepted: a refused reset (409)
                  // leaves the host configured, so the form keeps it.
                  void reset().then((ok) => {
                    if (ok) {
                      setApiBase("");
                      setWebBase("");
                    }
                  });
                }}
                data-testid="github-host-reset"
              >
                Reset to github.com
              </Button>
            )}
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="github-host-readonly"
            >
              {host
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {writeError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="github-host-write-error"
              data-refusal={writeError.code ?? undefined}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-xs text-amber-800 dark:text-amber-200">
                <p>{writeError.message}.</p>
                {writeError.repos && writeError.repos.length > 0 && (
                  <ul
                    className="mt-1 list-disc pl-4"
                    data-testid="github-host-blocking-repos"
                  >
                    {writeError.repos.map((r) => (
                      <li key={r.repo}>
                        <code>{r.repo}</code> — {r.github_remote}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="github-host-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the GitHub host: {error}.{" "}
                {host
                  ? "Showing the last value read, which may be out of date."
                  : "The current host is unknown."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
