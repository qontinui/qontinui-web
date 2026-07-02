"use client";

/**
 * Onboarding doctor — zero-touch onboarding status checklist (P4).
 *
 * Renders the per-repo onboarding checklist from coord's onboarding-doctor
 * endpoint (proxied at `GET /api/v1/operations/pr-merge/onboarding/doctor`):
 * eight fixed checks (tenant_mapped / repo_enrolled / profile_present /
 * rollout_state / config_yaml / bootstrap_pr / ci_workflow / ruleset_bypass),
 * each `pass | warn | fail | skip`, plus a `ready_to_land` headline badge.
 *
 * This page is the GitHub App's post-install Setup URL target, so it
 * tolerates GitHub's `?installation_id=…&setup_action=…` params (ignored)
 * and seeds from `?repo=owner/name` when present (auto-running the check).
 *
 * Quick-picks come from the tenant's already-enrolled repos
 * (`GET /pr-merge/repos` → coord.tenant_repos) — best-effort; a failure
 * just hides the buttons and leaves the free-text input.
 *
 * Sibling of {@link MergeOrchestrationOnboarding} (the enrollment wizard);
 * this page only READS state and points the operator at remediation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";

// ----------------------------------------------------------------------------
// Wire types — FROZEN contract with coord's onboarding doctor (P4).
// ----------------------------------------------------------------------------

type DoctorStatus = "pass" | "warn" | "fail" | "skip";

interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  remediation: string | null;
}

interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  ready_to_land: boolean;
}

interface DoctorResponse {
  repo: string;
  checks: DoctorCheck[];
  summary: DoctorSummary;
}

/** Subset of the `GET /pr-merge/repos` row we need for quick-picks. */
interface TenantRepoRow {
  repo: string;
}

interface TenantReposResponse {
  repos: TenantRepoRow[];
  total: number;
}

/** Mirrors the backend proxy's owner/name validation (422 otherwise). */
const OWNER_REPO_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ----------------------------------------------------------------------------
// Per-status presentation
// ----------------------------------------------------------------------------

function StatusIcon({ status }: { status: DoctorStatus }) {
  switch (status) {
    case "pass":
      return (
        <CheckCircle2
          className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0"
          aria-label="pass"
        />
      );
    case "warn":
      return (
        <AlertTriangle
          className="h-4 w-4 text-amber-500 shrink-0"
          aria-label="warn"
        />
      );
    case "fail":
      return (
        <XCircle
          className="h-4 w-4 text-destructive shrink-0"
          aria-label="fail"
        />
      );
    case "skip":
    default:
      return (
        <Minus
          className="h-4 w-4 text-muted-foreground shrink-0"
          aria-label="skip"
        />
      );
  }
}

function CheckRow({ check }: { check: DoctorCheck }) {
  return (
    <li
      className="flex items-start gap-2 py-2 border-b border-border last:border-b-0"
      data-testid={`onboarding-doctor-check-${check.id}`}
      data-status={check.status}
    >
      <span className="mt-0.5">
        <StatusIcon status={check.status} />
      </span>
      <div className="min-w-0">
        <p
          className={
            check.status === "skip"
              ? "text-sm font-medium text-muted-foreground"
              : "text-sm font-medium"
          }
        >
          {check.label}
        </p>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
        {check.remediation && check.status !== "pass" && (
          <p
            className={
              check.status === "fail"
                ? "text-xs text-destructive mt-0.5"
                : "text-xs text-amber-600 dark:text-amber-500 mt-0.5"
            }
            data-testid={`onboarding-doctor-remediation-${check.id}`}
          >
            → {check.remediation}
          </p>
        )}
      </div>
    </li>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export function OnboardingDoctor() {
  // GitHub's post-install redirect appends `?installation_id=…&setup_action=…`
  // — deliberately NOT read; only `?repo=` seeds the check.
  const searchParams = useSearchParams();
  const initialRepo = searchParams?.get("repo") ?? "";

  const [repo, setRepo] = useState(initialRepo);
  const [result, setResult] = useState<DoctorResponse | null>(null);
  const [checkedRepo, setCheckedRepo] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolledRepos, setEnrolledRepos] = useState<string[]>([]);

  const runCheck = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!OWNER_REPO_RE.test(trimmed)) {
      setError("Enter a repository as owner/name.");
      setResult(null);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const body = await httpClient.get<DoctorResponse>(
        `${API}/pr-merge/onboarding/doctor?repo=${encodeURIComponent(trimmed)}`
      );
      setResult(body);
      setCheckedRepo(trimmed);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  // Quick-picks: best-effort read of the tenant's enrolled repos. A failure
  // (e.g. no coord operator row yet) just hides the buttons.
  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<TenantReposResponse>(`${API}/pr-merge/repos`)
      .then((body) => {
        if (!cancelled) {
          setEnrolledRepos((body.repos ?? []).map((r) => r.repo));
        }
      })
      .catch(() => {
        /* quick-picks are optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `?repo=` deep-link (the App's Setup URL target) auto-runs exactly once.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (initialRepo && OWNER_REPO_RE.test(initialRepo)) {
      void runCheck(initialRepo);
    }
  }, [initialRepo, runCheck]);

  const summary = result?.summary;

  return (
    <Card data-testid="onboarding-doctor">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4" />
          Onboarding status
          {summary && (
            <Badge
              variant={summary.ready_to_land ? "default" : "secondary"}
              className="ml-2"
              data-testid="onboarding-doctor-ready-badge"
            >
              {summary.ready_to_land ? "Ready to land ✓" : "Not ready yet"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Zero-touch onboarding checklist for a repository: enrollment, profile,
          bootstrap PR, CI workflow, and merge-bypass configuration — with
          remediation hints for anything that is not green.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex items-center gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck(repo);
          }}
        >
          <Input
            placeholder="owner/name"
            value={repo}
            onChange={(e) => setRepo(e.target.value.trim())}
            className="max-w-xs font-mono text-xs"
            data-testid="onboarding-doctor-repo-input"
          />
          <Button
            type="submit"
            size="sm"
            disabled={checking}
            data-testid="onboarding-doctor-check-button"
          >
            {checking ? "Checking…" : "Check"}
          </Button>
        </form>

        {enrolledRepos.length > 0 && (
          <div
            className="flex items-center gap-1.5 flex-wrap"
            data-testid="onboarding-doctor-quick-picks"
          >
            <span className="text-xs text-muted-foreground">Enrolled:</span>
            {enrolledRepos.map((r) => (
              <Button
                key={r}
                variant="outline"
                size="sm"
                className="h-6 px-2 font-mono text-xs"
                onClick={() => {
                  setRepo(r);
                  void runCheck(r);
                }}
                data-testid={`onboarding-doctor-quick-pick-${r}`}
              >
                {r}
              </Button>
            ))}
          </div>
        )}

        {error && (
          <p
            className="text-sm text-destructive"
            data-testid="onboarding-doctor-error"
          >
            {error}
          </p>
        )}

        {checking && !result ? (
          <Skeleton className="h-48 w-full" />
        ) : result ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <span className="font-mono">{checkedRepo}</span>
              {summary && (
                <span data-testid="onboarding-doctor-summary-counts">
                  {summary.pass} pass · {summary.warn} warn · {summary.fail}{" "}
                  fail · {summary.skip} skipped
                </span>
              )}
            </div>
            <ul data-testid="onboarding-doctor-checks">
              {result.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </div>
        ) : (
          !error && (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="onboarding-doctor-empty"
            >
              Enter a repository (owner/name) and press Check to render its
              zero-touch onboarding checklist.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
