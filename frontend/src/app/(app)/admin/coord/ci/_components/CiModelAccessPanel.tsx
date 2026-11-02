"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  UNKNOWN_AMBER,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import { useRepoFleetPolicyWrite } from "../../_shared/useRepoFleetPolicyWrite";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import { useCiModelAccessRepos } from "../_hooks/useCiModelAccessRepos";
import { Notice } from "./Notice";
import {
  CI_MODEL_ACCESS_DOMAIN,
  MODEL_ACCESS_LEVELS,
  MODEL_ACCESS_PALETTE,
  MODEL_ACCESS_REPO_CHOICES,
  MODEL_ACCESS_REPO_CHOICE_LABEL,
  MODEL_ACCESS_UNKNOWN_DASH,
  OFF_EFFECT_TEXT,
  currentModelAccessChoice,
  modelAccessLevelLabel,
  modelAccessRepoStatus,
  modelAccessSourceLabel,
  modelAccessUnknownText,
  readingFromPolicy,
  refusalFor,
  summarizeModelAccess,
  unreadReading,
  type ModelAccessLevel,
  type ModelAccessReading,
  type ModelAccessRepoChoice,
  type ModelAccessRepoReading,
} from "../_lib/ciModelAccessStatus";

const LABEL = "Model access for CI steps";
/** Lower-case name for toasts and the default change note. */
const WRITE_LABEL = "CI model access";

/**
 * Model access for CI steps — the tenant and repo off-switches of plan
 * `2026-10-13-ci-node-runs-model-dependent-eval-steps` (D6, Phase 4), beside
 * `GithubHostedCiPanel` and built the same way: console primitives only
 * (style guide §6.4) — a `CollapsiblePanel` whose header keeps the tenant
 * value and repo counts visible when folded (R7), one `RecordRow` per repo
 * (R2) with its control in the in-place detail (R5), derivations from the
 * pure `ciModelAccessStatus` module (R8).
 *
 * - **Tenant row** — displayed from the tenant-band dial's own read, through
 *   `readingFromPolicy`, so an unreadable or row-less `off` is UNKNOWN, never
 *   a guessed value. A write whose read-back failed is UNKNOWN until a refresh
 *   confirms it.
 * - **Repo rows** — the effective value and the band it came from, the refusal
 *   word a dispatch would carry, and an `Inherit` / `On` / `Off` control that
 *   writes the repo band through `useRepoFleetPolicyWrite`.
 * - Writes are offered only to an admin of the ACTIVE tenant, and only when the
 *   backend's `can_edit` agrees.
 */
export function CiModelAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const tenant = useTenantFleetPolicyDial<ModelAccessLevel>(
    CI_MODEL_ACCESS_DOMAIN,
    WRITE_LABEL,
    "coord"
  );
  const repoRead = useCiModelAccessRepos();
  const { reload: reloadRepos, applyWriteReadback } = repoRead;
  const { reload: reloadTenant, setLevel } = tenant;
  // A repo write changes only that repo: update it from the write's own
  // read-back instead of re-reading every repo.
  const onRepoConfirmed = useCallback(
    (repo: string, effective: FleetPolicyView) =>
      applyWriteReadback(repo, readingFromPolicy(effective)),
    [applyWriteReadback]
  );
  const repoWrite = useRepoFleetPolicyWrite<ModelAccessRepoChoice>(
    CI_MODEL_ACCESS_DOMAIN,
    WRITE_LABEL,
    onRepoConfirmed
  );
  const { clearReadbackErrors } = repoWrite;
  const [tenantPending, setTenantPending] = useState<ModelAccessLevel | null>(
    null
  );

  const refreshAll = useCallback(async () => {
    const [ok] = await Promise.all([reloadRepos(), reloadTenant()]);
    if (ok) clearReadbackErrors();
  }, [reloadRepos, reloadTenant, clearReadbackErrors]);

  const writeTenant = useCallback(
    async (level: ModelAccessLevel) => {
      setTenantPending(level);
      try {
        const ok = await setLevel(level);
        // Repos that inherit just changed with it — re-read what they resolve.
        if (ok) void reloadRepos();
      } finally {
        setTenantPending(null);
      }
    },
    [setLevel, reloadRepos]
  );

  const tenantReading: ModelAccessReading | null = tenant.readbackError
    ? unreadReading(`read-back failed: ${tenant.readbackError}`)
    : tenant.policy
      ? readingFromPolicy(tenant.policy)
      : tenant.error
        ? unreadReading(tenant.error)
        : null;
  const tenantLevel = tenantReading?.level ?? null;
  const tenantStale = tenant.policy !== null && tenant.error !== null;
  const canEdit = isAdmin && tenant.policy?.can_edit === true;
  const stillReading = tenant.loading && !tenant.policy;

  const repos = repoRead.repos ?? [];
  const summary = summarizeModelAccess(repos);
  const reposUnknown = repoRead.repos === null && repoRead.error !== null;
  const staleSuffix = (s: boolean) => (s ? " (stale)" : "");

  return (
    <CollapsiblePanel
      data-testid="ci-model-access-panel"
      storageKey="coord-ci-model-access-open"
      defaultOpen
      icon={<Sparkles className="h-4 w-4" />}
      title={LABEL}
      summary={
        <>
          <Badge
            variant="outline"
            className={`text-[10px] ${tenantLevel === null || tenantStale ? UNKNOWN_AMBER : ""}`}
            data-testid="ci-model-access-summary-tenant"
            data-level={tenantLevel ?? "unknown"}
          >
            tenant{" "}
            {tenantLevel === null
              ? MODEL_ACCESS_UNKNOWN_DASH
              : modelAccessLevelLabel(tenantLevel)}
            {staleSuffix(tenantStale)}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] ${reposUnknown || summary.unknown > 0 || repoRead.stale ? UNKNOWN_AMBER : ""}`}
            data-testid="ci-model-access-summary-repos"
          >
            {reposUnknown || repoRead.repos === null
              ? `repos ${MODEL_ACCESS_UNKNOWN_DASH}`
              : `repos on ${summary.on} · off ${summary.off}` +
                (summary.unknown > 0 ? ` · unknown ${summary.unknown}` : "")}
            {staleSuffix(repoRead.stale)}
          </Badge>
        </>
      }
      headerActions={
        <RefreshButton
          onRefresh={refreshAll}
          label="Refresh"
          title="Re-read the CI model-access setting"
          data-testid="ci-model-access-refresh"
        />
      }
    >
      <div className="space-y-4">
        <div
          className="max-w-3xl space-y-1 text-xs text-muted-foreground"
          data-testid="ci-model-access-explainer"
        >
          <p className="m-0">
            Whether CI steps may call a model. It governs only the steps of
            repos whose CI manifest declares <code>[model]</code> — and, of
            those, only the steps marked <code>model = true</code>. Calls run
            through coord-dispatched CI on the tenant&apos;s CI-node machines
            (which may belong to other members), on those machines&apos; Claude
            accounts, within the budget the manifest declares.
          </p>
          <p className="m-0">
            It is <strong>on by default</strong>. Turn it off for the tenant or
            for one repo and {OFF_EFFECT_TEXT}; the CI verdict is unaffected.
            Repos inherit the tenant setting unless they carry an override. Each
            machine&apos;s owner can also switch it off for their machine on{" "}
            <em>Environments ▸ Machines</em>.
          </p>
        </div>

        {/* ---- Tenant row ---------------------------------------------- */}
        <div
          className="space-y-2 rounded-md border border-border bg-card/30 px-3 py-2"
          data-testid="ci-model-access-tenant"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Tenant default</span>
            {MODEL_ACCESS_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={tenantLevel === level ? "default" : "outline"}
                // Disabled only when the TENANT row already holds this level:
                // an `on` that comes from the no-row default can still be
                // pinned, so a later change to the default cannot move it.
                disabled={
                  !canEdit ||
                  tenant.saving ||
                  (tenantLevel === level &&
                    tenantReading?.resolved_scope === "tenant")
                }
                onClick={() => void writeTenant(level)}
                data-testid={`ci-model-access-tenant-${level}`}
              >
                {tenant.saving && tenantPending === level && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {modelAccessLevelLabel(level)}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">resolves</span>
            <Badge
              variant="outline"
              className={tenantLevel === null ? UNKNOWN_AMBER : ""}
              data-testid="ci-model-access-tenant-effective"
              data-level={tenantLevel ?? "unknown"}
              title={
                tenantReading && tenantLevel === null
                  ? modelAccessUnknownText(tenantReading)
                  : undefined
              }
            >
              {tenantLevel === null
                ? MODEL_ACCESS_UNKNOWN_DASH
                : modelAccessLevelLabel(tenantLevel)}
            </Badge>
            <span className="text-xs text-muted-foreground">from</span>
            <Badge
              variant="outline"
              className={tenantLevel === null ? UNKNOWN_AMBER : ""}
              data-testid="ci-model-access-tenant-source"
            >
              {tenantLevel === null
                ? MODEL_ACCESS_UNKNOWN_DASH
                : modelAccessSourceLabel(tenantReading?.resolved_scope ?? null)}
            </Badge>
          </div>

          {tenantReading !== null && tenantLevel === null && (
            <p
              className="text-xs text-amber-700 dark:text-amber-300"
              data-testid="ci-model-access-tenant-unknown"
            >
              The tenant value is unknown:{" "}
              {modelAccessUnknownText(tenantReading)}.{" "}
              {tenantReading.read_failed ? (
                <>
                  If coord cannot read it either, it refuses model access with{" "}
                  <code>preference_unknown</code> unless it holds a reading from
                  the last 24 hours.
                </>
              ) : (
                <>
                  Coord refuses model access with{" "}
                  <code>preference_unknown</code> unless it holds a reading from
                  the last 24 hours.
                </>
              )}
            </p>
          )}
          {tenantStale && (
            <Notice testId="ci-model-access-tenant-error">
              Couldn&apos;t refresh the tenant setting: {tenant.error}. The
              value shown is from the last read, which may be stale.
            </Notice>
          )}
          {!canEdit && !stillReading && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="ci-model-access-readonly"
            >
              {!isAdmin || tenant.policy
                ? "Read-only: only an admin of this tenant can change this setting."
                : "Read-only: your role could not be read, so whether a change would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}
        </div>

        {/* ---- Repo rows ----------------------------------------------- */}
        <div className="space-y-2" data-testid="ci-model-access-repos">
          {repoRead.error && (
            <Notice testId="ci-model-access-repos-error">
              Couldn&apos;t read the per-repo values: {repoRead.error}.{" "}
              {repoRead.repos
                ? "Showing the last values read, which may be stale."
                : "Nothing is shown in their place."}
            </Notice>
          )}
          {!reposUnknown && (
            <RecordList<ModelAccessRepoReading>
              items={repos}
              itemKey={(r) => r.repo}
              loaded={repoRead.repos !== null || !repoRead.loading}
              empty={
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="ci-model-access-repos-empty"
                >
                  Coord lists no repos for this tenant.
                </p>
              }
              renderRow={(r, { expanded, onToggle }) => (
                <RepoRow
                  reading={r}
                  expanded={expanded}
                  onToggle={onToggle}
                  stale={repoRead.stale}
                  readbackError={repoWrite.readbackErrors[r.repo] ?? null}
                  writeError={repoWrite.writeErrors[r.repo] ?? null}
                  canEdit={canEdit}
                  saving={repoWrite.savingRepo === r.repo}
                  busy={repoWrite.savingRepo !== null}
                  onChoose={(choice) => void repoWrite.write(r.repo, choice)}
                />
              )}
            />
          )}
        </div>
      </div>
    </CollapsiblePanel>
  );
}

/** What a dispatch of this repo reads, in operator words plus coord's word. */
function dispatchEffect(reading: ModelAccessRepoReading): ReactNode {
  const refusal = refusalFor(reading);
  if (refusal === null) {
    return (
      <>
        Model access is allowed for this repo; each dispatch is still granted
        only when coord trusts it (a same-repo branch, a main push or a
        schedule).
      </>
    );
  }
  if (refusal === "preference_unknown" && reading.read_failed) {
    // THIS PAGE could not read it — that is not coord refusing anything.
    return (
      <>
        The value could not be read here. If coord cannot read it either, it
        refuses model access with{" "}
        <code data-testid="ci-model-access-refusal">{refusal}</code> unless it
        holds a reading from the last 24 hours; {OFF_EFFECT_TEXT}.
      </>
    );
  }
  if (refusal === "preference_unknown") {
    return (
      <>
        Coord refuses model access with{" "}
        <code data-testid="ci-model-access-refusal">{refusal}</code> unless it
        holds a reading from the last 24 hours; {OFF_EFFECT_TEXT}.
      </>
    );
  }
  return (
    <>
      Dispatches are refused model access with{" "}
      <code data-testid="ci-model-access-refusal">{refusal}</code>:{" "}
      {OFF_EFFECT_TEXT}.
    </>
  );
}

function RepoRow({
  reading,
  expanded,
  onToggle,
  stale,
  readbackError,
  writeError,
  canEdit,
  saving,
  busy,
  onChoose,
}: {
  reading: ModelAccessRepoReading;
  expanded: boolean;
  onToggle: () => void;
  stale: boolean;
  readbackError: string | null;
  writeError: string | null;
  canEdit: boolean;
  saving: boolean;
  busy: boolean;
  onChoose: (choice: ModelAccessRepoChoice) => void;
}) {
  const status = modelAccessRepoStatus(reading, { stale, readbackError });
  const current = readbackError ? null : currentModelAccessChoice(reading);
  return (
    <RecordRow
      data-testid="ci-model-access-repo-row"
      identity={reading.repo}
      label={LABEL}
      status={
        <span
          data-testid="ci-model-access-repo-status"
          data-status={status.kind}
        >
          <StatusBadge status={status} palette={MODEL_ACCESS_PALETTE} />
        </span>
      }
      reason={status.reason}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="ci-model-access-repo-detail"
        why={
          <div className="space-y-1 text-xs">
            <p className="m-0">
              {readbackError || reading.level === null
                ? status.reason
                : `Coord resolves ${modelAccessLevelLabel(reading.level)} for this repo, from the ${modelAccessSourceLabel(reading.resolved_scope)}${stale ? " (the last refresh failed, so this may be stale)" : ""}.`}
            </p>
            {!readbackError && <p className="m-0">{dispatchEffect(reading)}</p>}
          </div>
        }
        problems={
          writeError ? (
            <p
              className="text-xs text-amber-700 dark:text-amber-300"
              data-testid="ci-model-access-repo-write-error"
            >
              The last change was not applied: {writeError}.
            </p>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {MODEL_ACCESS_REPO_CHOICES.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={current === choice ? "default" : "outline"}
                disabled={!canEdit || busy || current === choice}
                onClick={() => onChoose(choice)}
                data-testid={`ci-model-access-repo-${choice}`}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {MODEL_ACCESS_REPO_CHOICE_LABEL[choice]}
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
