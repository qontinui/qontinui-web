"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle, Cloud, Loader2 } from "lucide-react";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  UNKNOWN_AMBER,
  readIsUnknown,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRepoFleetPolicyWrite } from "../../_shared/useRepoFleetPolicyWrite";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import { useCiHosting } from "../_hooks/useCiHosting";
import {
  GITHUB_HOSTED_CI_DOMAIN,
  HOSTED_CI_LEVELS,
  HOSTED_CI_PALETTE,
  REPO_CHOICE_LABEL,
  REPO_OVERRIDE_CHOICES,
  UNKNOWN_DASH,
  asHostedCiLevel,
  currentRepoChoice,
  levelLabel,
  repoSourceLabel,
  repoStatus,
  summarizeRepos,
  tenantSourceLabel,
  type CiHostingRepoReading,
  type HostedCiLevel,
  type RepoOverrideChoice,
} from "../_lib/hostedCiStatus";

const LABEL = "GitHub-hosted CI";

/**
 * GitHub-hosted CI — the per-tenant Dev Ops setting, with per-repo overrides.
 *
 * Plan `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` Phase 3
 * (D7). Composes console primitives only (style guide §6.4): a
 * `CollapsiblePanel` whose header keeps the tenant value and repo counts
 * visible when folded (R7), one `RecordRow` per repo (R2) with the control in
 * its in-place detail (R5), and derivations from the pure `hostedCiStatus`
 * module (R8).
 *
 * - **Tenant row** — `On` / `Off` through the shared tenant-band dial. Turning
 *   it OFF asks for a reason first, because off is the change that can stop a
 *   tenant's CI when it has no self-hosted runners; the reason becomes the
 *   write's `change_note` (the `DeviceDrainControl` precedent).
 * - **Repo rows** — the effective value and where it comes from, and an
 *   `Inherit` / `On` / `Off` control that writes the repo band (`inherit`
 *   clears the override).
 * - **UNKNOWN** renders `–` in amber, never a guessed `on`; a failed latest
 *   read keeps the last values and labels them stale.
 * - Writes are offered only to an admin of the ACTIVE tenant, and only when
 *   the backend's `can_edit` agrees.
 */
export function GithubHostedCiPanel({ isAdmin }: { isAdmin: boolean }) {
  const ci = useCiHosting();
  const tenant = useTenantFleetPolicyDial<HostedCiLevel>(
    GITHUB_HOSTED_CI_DOMAIN,
    LABEL,
    "coord"
  );
  const { reload: reloadCi } = ci;
  const repoWrite = useRepoFleetPolicyWrite<RepoOverrideChoice>(
    GITHUB_HOSTED_CI_DOMAIN,
    LABEL,
    reloadCi
  );
  const { clearReadbackErrors } = repoWrite;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [tenantPending, setTenantPending] = useState<HostedCiLevel | null>(
    null
  );

  /** Re-read both halves. A confirmed aggregate read retires read-back fails. */
  const refreshAll = useCallback(async () => {
    const [ok] = await Promise.all([reloadCi(), tenant.reload()]);
    if (ok) clearReadbackErrors();
  }, [reloadCi, tenant, clearReadbackErrors]);

  const tenantLevel = asHostedCiLevel(tenant.policy?.effective_level);
  const tenantScope = tenant.policy?.resolved_scope ?? null;
  const tenantUnknown = tenantLevel === null || tenant.readbackError !== null;
  const canEditTenant = isAdmin && tenant.policy?.can_edit === true;
  const canEditRepos = isAdmin && ci.view?.can_edit === true;

  const writeTenant = useCallback(
    async (level: HostedCiLevel, note?: string) => {
      setTenantPending(level);
      try {
        const ok = await tenant.setLevel(level, note);
        // Repos that inherit just changed with it — re-read what they resolve.
        if (ok) void reloadCi();
        return ok;
      } finally {
        setTenantPending(null);
      }
    },
    [tenant, reloadCi]
  );

  const onTenantClick = (level: HostedCiLevel) => {
    if (level === "off") {
      setReason("");
      setConfirmOpen(true);
      return;
    }
    void writeTenant(level);
  };

  const submitOff = async () => {
    const trimmed = reason.trim();
    if (trimmed === "") return;
    const ok = await writeTenant("off", trimmed);
    if (ok) setConfirmOpen(false);
  };

  const repos = ci.view?.repos ?? [];
  const summary = summarizeRepos(repos);
  const reposUnknown = readIsUnknown(ci.view !== null, ci.error !== null);

  return (
    <CollapsiblePanel
      data-testid="github-hosted-ci-panel"
      storageKey="devops:github-hosted-ci"
      defaultOpen
      icon={<Cloud className="h-4 w-4" />}
      title={LABEL}
      summary={
        <>
          <Badge
            variant="outline"
            className={`text-[10px] ${tenantUnknown ? UNKNOWN_AMBER : ""}`}
            data-testid="github-hosted-ci-summary-tenant"
          >
            tenant {tenantUnknown ? UNKNOWN_DASH : levelLabel(tenantLevel)}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] ${reposUnknown || summary.unknown > 0 ? UNKNOWN_AMBER : ""}`}
            data-testid="github-hosted-ci-summary-repos"
          >
            {reposUnknown
              ? `repos ${UNKNOWN_DASH}`
              : `repos on ${summary.on} · off ${summary.off}` +
                (summary.unknown > 0 ? ` · unknown ${summary.unknown}` : "")}
          </Badge>
        </>
      }
      headerActions={
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh"
          title="Re-read the GitHub-hosted CI setting"
          data-testid="github-hosted-ci-refresh"
        />
      }
    >
      <div className="space-y-4">
        <p className="max-w-3xl text-xs text-muted-foreground">
          Whether this tenant&apos;s CI may run on GitHub-hosted runners. When
          it is off, coord treats a workflow job aimed at a GitHub-hosted runner
          as mis-targeted: every CI job must run on the tenant&apos;s own
          self-hosted runners. Repos inherit the tenant setting unless they
          carry an override.
        </p>

        {/* ---- Tenant row ---------------------------------------------- */}
        <div
          className="space-y-2 rounded-md border border-border bg-card/30 px-3 py-2"
          data-testid="github-hosted-ci-tenant"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Tenant default</span>
            {HOSTED_CI_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={
                  !tenantUnknown && tenantLevel === level
                    ? "default"
                    : "outline"
                }
                disabled={
                  !canEditTenant ||
                  tenant.saving ||
                  (!tenantUnknown && tenantLevel === level)
                }
                onClick={() => onTenantClick(level)}
                data-testid={`github-hosted-ci-tenant-${level}`}
              >
                {tenant.saving && tenantPending === level && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {levelLabel(level)}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">resolves</span>
            <Badge
              variant="outline"
              className={tenantUnknown ? UNKNOWN_AMBER : ""}
              data-testid="github-hosted-ci-tenant-effective"
            >
              {tenantUnknown ? UNKNOWN_DASH : levelLabel(tenantLevel)}
            </Badge>
            <span className="text-xs text-muted-foreground">from</span>
            <Badge
              variant="outline"
              className={tenantScope === null ? UNKNOWN_AMBER : ""}
              data-testid="github-hosted-ci-tenant-source"
            >
              {tenantSourceLabel(tenantScope)}
            </Badge>
          </div>

          {!canEditTenant && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="github-hosted-ci-readonly"
            >
              {tenant.policy || ci.view
                ? "Read-only: only an admin of this tenant can change this setting."
                : "Read-only: your role could not be read, so whether a change would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {tenant.readbackError && (
            <Notice testId="github-hosted-ci-tenant-readback-error">
              The write to <code>{tenant.lastWrite?.written_level}</code> was
              accepted, but reading back what coord resolves failed (
              {tenant.readbackError}). The tenant value is unknown until a
              refresh confirms it.
            </Notice>
          )}
          {tenant.error && (
            <Notice testId="github-hosted-ci-tenant-error">
              Couldn&apos;t read the tenant setting: {tenant.error}.{" "}
              {tenant.policy
                ? "Showing the last value read, which may be stale."
                : "The current value is unknown."}
            </Notice>
          )}
        </div>

        {/* ---- Repo rows ----------------------------------------------- */}
        <div className="space-y-2" data-testid="github-hosted-ci-repos">
          {ci.error && (
            <Notice testId="github-hosted-ci-repos-error">
              {ci.notServed
                ? `Per-repo values are unknown: ${ci.error}.`
                : `Couldn't read the per-repo values: ${ci.error}.`}{" "}
              {ci.view
                ? "Showing the last values read, which may be stale."
                : "Nothing is shown in their place."}
            </Notice>
          )}
          {!reposUnknown && (
            <RecordList<CiHostingRepoReading>
              items={repos}
              itemKey={(r) => r.repo}
              loaded={ci.view !== null || !ci.loading}
              empty={
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="github-hosted-ci-repos-empty"
                >
                  Coord lists no repos for this tenant.
                </p>
              }
              renderRow={(r, { expanded, onToggle }) => (
                <RepoRow
                  reading={r}
                  expanded={expanded}
                  onToggle={onToggle}
                  stale={ci.stale}
                  readbackError={repoWrite.readbackErrors[r.repo] ?? null}
                  canEdit={canEditRepos}
                  saving={repoWrite.savingRepo === r.repo}
                  busy={repoWrite.savingRepo !== null}
                  onChoose={(choice) => void repoWrite.write(r.repo, choice)}
                />
              )}
            />
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !tenant.saving) setConfirmOpen(false);
        }}
      >
        <DialogContent data-testid="github-hosted-ci-off-dialog">
          <DialogHeader>
            <DialogTitle>
              Turn GitHub-hosted CI off for this tenant?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="break-words">
                  Workflow jobs aimed at GitHub-hosted runners will be treated
                  as mis-targeted, in every repo that inherits the tenant
                  setting. Make sure this tenant has self-hosted runners for
                  every pool its required checks need first — without them, its
                  CI stops.
                </p>
                <p className="break-words">
                  Repos with their own override keep it.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="github-hosted-ci-off-reason">
              Reason (required)
            </Label>
            <Textarea
              id="github-hosted-ci-off-reason"
              rows={2}
              value={reason}
              disabled={tenant.saving}
              placeholder="e.g. hosted CI is off for cost; all pools are self-hosted"
              onChange={(e) => setReason(e.target.value)}
              data-testid="github-hosted-ci-off-reason"
            />
            <p className="text-[11px] text-muted-foreground break-words">
              Recorded with the change, so the next operator can see why.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={tenant.saving}
              onClick={() => setConfirmOpen(false)}
              data-testid="github-hosted-ci-off-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={tenant.saving || reason.trim() === ""}
              onClick={() => void submitOff()}
              data-testid="github-hosted-ci-off-submit"
            >
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsiblePanel>
  );
}

function Notice({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-xs text-amber-800 dark:text-amber-200">{children}</p>
    </div>
  );
}

function RepoRow({
  reading,
  expanded,
  onToggle,
  stale,
  readbackError,
  canEdit,
  saving,
  busy,
  onChoose,
}: {
  reading: CiHostingRepoReading;
  expanded: boolean;
  onToggle: () => void;
  stale: boolean;
  readbackError: string | null;
  canEdit: boolean;
  saving: boolean;
  busy: boolean;
  onChoose: (choice: RepoOverrideChoice) => void;
}) {
  const status = repoStatus(reading, { stale, readbackError });
  const current = readbackError ? null : currentRepoChoice(reading);
  return (
    <RecordRow
      data-testid="github-hosted-ci-repo-row"
      identity={reading.repo}
      label={LABEL}
      status={<StatusBadge status={status} palette={HOSTED_CI_PALETTE} />}
      reason={status.reason}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="github-hosted-ci-repo-detail"
        why={
          <p className="text-xs">
            {readbackError || reading.level === null
              ? status.reason
              : `Coord resolves ${levelLabel(reading.level)} for this repo, from the ${repoSourceLabel(reading.resolved_scope)}${stale ? " (the last refresh failed, so this may be stale)" : ""}.`}
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {REPO_OVERRIDE_CHOICES.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={current === choice ? "default" : "outline"}
                disabled={!canEdit || busy || current === choice}
                onClick={() => onChoose(choice)}
                data-testid={`github-hosted-ci-repo-${choice}`}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {REPO_CHOICE_LABEL[choice]}
              </Button>
            ))}
            {!canEdit && (
              <span className="text-xs text-muted-foreground">
                Read-only: only an admin of this tenant can change it.
              </span>
            )}
          </div>
        }
        raw={
          reading.unknown_reason ? (
            <span>unknown_reason: {reading.unknown_reason}</span>
          ) : undefined
        }
      />
    </RecordRow>
  );
}
