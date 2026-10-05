"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, GitMerge, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRepoFollowupDials } from "../_hooks/useRepoFollowupDials";
import {
  DELIVERY_HELP,
  DELIVERY_LABEL,
  DELIVERY_MODES,
  DELIVERY_PROVENANCE_NOTE,
  EMPTY_READING,
  FOLLOWUP_SCOPES,
  FOLLOWUP_SCOPE_PALETTE,
  SCOPE_HELP,
  SCOPE_LABEL,
  UNKNOWN_DASH,
  buildScopeWrite,
  fleetRolloutMode,
  knownScope,
  parseGlobLines,
  readErrorText,
  rolloutHeadline,
  scopeStatus,
  summarizeScopes,
  type DeliveryMode,
  type FollowupScope,
  type RepoDialReading,
} from "../_lib/repoFollowupStatus";

const LABEL = "Post-merge follow-ups";

/**
 * Per-repo follow-up dials — the post-merge follow-up scope and the
 * continuation-delivery mode, one row per tenant repo.
 *
 * Plan `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind`
 * Phase 4b: the off-switch for the post-merge follow-up spawn has to be
 * "reachable in the product" (served policy `production-and-cost`
 * `agent-spawn-authorization`), and it lives beside the agent defaults
 * because both decide which sessions get spawned. Composes console
 * primitives only (style guide §6.4): a `CollapsiblePanel` whose header keeps
 * the rollout mode and the scope counts visible when folded (R7), one
 * `RecordRow` per repo (R2) with both controls in its in-place detail (R5),
 * and derivations from the pure `repoFollowupStatus` module (R8).
 *
 * - **Rollout mode first.** Under `shadow` coord suppresses nothing, so the
 *   mode is the first line of the body and a header badge — an operator who
 *   sets "Never" must not believe follow-ups stopped while they did not.
 * - **UNKNOWN renders `–` in amber**, never the `all` default; a failed latest
 *   read keeps the last value and labels it stale.
 * - **After a save, the row shows the write's read-back**, not the value sent.
 * - Writes are offered only when the backend's `can_edit` says the caller is
 *   an admin of the ACTIVE tenant; coord re-checks.
 */
export function RepoFollowupDialsPanel() {
  const dials = useRepoFollowupDials();
  const { repos, readings } = dials;

  // The readings in repo order. The two derivations share the rows' unknown
  // rule (a failed write read-back is unknown, not its pre-write value).
  const repoReadings = useMemo(
    () => (repos ?? []).map((r) => readings[r]),
    [repos, readings]
  );
  const rollout = fleetRolloutMode(repoReadings, { loading: dials.loading });
  const mode = rollout.mode;
  const headline = rolloutHeadline(rollout);
  const summary = summarizeScopes(repoReadings);
  // Every per-repo read carries the same `can_edit` (one rule, one caller).
  const canEdit = Object.values(readings).some(
    (r) => r.scope?.can_edit === true || r.delivery?.can_edit === true
  );
  const anyRead = Object.values(readings).some(
    (r) => r.scope !== null || r.delivery !== null
  );
  const reposUnknown = repos === null;

  return (
    <CollapsiblePanel
      data-testid="repo-followup-dials-panel"
      storageKey="agent-registry:repo-followup-dials"
      defaultOpen
      icon={<GitMerge className="h-4 w-4" />}
      title={LABEL}
      summary={
        <>
          <Badge
            variant="outline"
            className={`text-[10px] ${headline.amber ? UNKNOWN_AMBER : ""}`}
            data-testid="repo-followup-summary-mode"
            title={headline.detail}
          >
            rollout {headline.label}
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] ${reposUnknown || summary.unknown > 0 || summary.stale > 0 ? UNKNOWN_AMBER : ""}`}
            data-testid="repo-followup-summary-scopes"
          >
            {reposUnknown
              ? `repos ${UNKNOWN_DASH}`
              : `every merge ${summary.all} · code only ${summary.code_only} · never ${summary.none}` +
                (summary.unknown > 0 ? ` · unknown ${summary.unknown}` : "") +
                (summary.stale > 0 ? ` (${summary.stale} stale)` : "")}
          </Badge>
        </>
      }
      headerActions={
        <RefreshButton
          onRefresh={dials.reload}
          label="Refresh"
          title="Re-read every repo's follow-up settings"
          data-testid="repo-followup-refresh"
        />
      }
    >
      <div className="space-y-3">
        <p className="max-w-3xl text-xs text-muted-foreground">
          When a pull request merges, coord spawns a follow-up session to check
          the result. Choose per repo whether that happens for every merge, only
          for merges that change code, or never — and how work is handed back to
          an author&apos;s session.
        </p>

        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            headline.amber || mode === "shadow"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : "border-border bg-card/30"
          }`}
          data-testid="repo-followup-rollout"
          data-rollout-mode={mode ?? "unknown"}
        >
          <span className="font-semibold">Rollout: {headline.label}.</span>{" "}
          {headline.detail}
        </div>

        {dials.reposError && (
          <Notice testId="repo-followup-repos-error">
            Couldn&apos;t read this tenant&apos;s repos: {dials.reposError}.{" "}
            {repos
              ? "Showing the last list read, which may be stale."
              : "Nothing is shown in their place."}
          </Notice>
        )}

        {!canEdit && anyRead && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="repo-followup-readonly"
          >
            Read-only: only an admin of this tenant can change these settings.
          </p>
        )}

        {!reposUnknown && (
          <RecordList<string>
            items={repos}
            itemKey={(r) => r}
            loaded={!dials.loading || repos !== null}
            empty={
              <p
                className="text-xs text-muted-foreground"
                data-testid="repo-followup-empty"
              >
                This tenant has no registered repos, so there is nothing to
                configure here.
              </p>
            }
            renderRow={(repo, { expanded, onToggle }) => (
              <RepoRow
                repo={repo}
                reading={readings[repo] ?? EMPTY_READING}
                expanded={expanded}
                onToggle={onToggle}
                canEdit={canEdit}
                saving={dials.saving}
                scopeWriteError={dials.writeErrors[`${repo}:scope`] ?? null}
                deliveryWriteError={
                  dials.writeErrors[`${repo}:delivery`] ?? null
                }
                onSaveScope={dials.writeScope}
                onChooseDelivery={(m) => void dials.writeDelivery(repo, m)}
              />
            )}
          />
        )}
      </div>
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
  repo,
  reading,
  expanded,
  onToggle,
  canEdit,
  saving,
  scopeWriteError,
  deliveryWriteError,
  onSaveScope,
  onChooseDelivery,
}: {
  repo: string;
  reading: RepoDialReading;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  saving: string | null;
  scopeWriteError: string | null;
  deliveryWriteError: string | null;
  onSaveScope: (body: {
    repo: string;
    scope: FollowupScope;
    code_paths?: string[];
  }) => Promise<boolean>;
  onChooseDelivery: (mode: DeliveryMode) => void;
}) {
  const status = scopeStatus(reading.scope, {
    error: reading.scopeError,
    readbackError: reading.scopeReadbackError,
  });
  return (
    <RecordRow
      data-testid="repo-followup-row"
      identity={repo}
      label="Follow-up on merge"
      status={<StatusBadge status={status} palette={FOLLOWUP_SCOPE_PALETTE} />}
      reason={status.reason}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="repo-followup-detail"
        why={<p className="text-xs">{status.reason}</p>}
        problems={
          scopeWriteError || deliveryWriteError ? (
            <div className="space-y-1">
              {scopeWriteError && (
                <p
                  className="text-xs text-amber-700 dark:text-amber-300"
                  data-testid="repo-followup-scope-write-error"
                >
                  The scope change was not applied: {scopeWriteError}.
                </p>
              )}
              {deliveryWriteError && (
                <p
                  className="text-xs text-amber-700 dark:text-amber-300"
                  data-testid="repo-followup-delivery-write-error"
                >
                  The delivery change was not applied: {deliveryWriteError}.
                </p>
              )}
            </div>
          ) : undefined
        }
        actions={
          <div className="space-y-4">
            <ScopeEditor
              // Re-seed the draft whenever coord's answer changes.
              key={`${reading.scopeReadbackError !== null ? "readback-failed" : (reading.scope?.scope ?? "?")}|${(reading.scope?.code_paths ?? []).join("\n")}`}
              repo={repo}
              reading={reading}
              canEdit={canEdit}
              saving={saving === `${repo}:scope`}
              busy={saving !== null}
              onSave={onSaveScope}
            />
            <DeliveryEditor
              reading={reading}
              canEdit={canEdit}
              saving={saving === `${repo}:delivery`}
              busy={saving !== null}
              onChoose={onChooseDelivery}
            />
          </div>
        }
        raw={
          <span>
            scope={knownScope(reading)?.scope ?? "unknown"} · resolved_scope=
            {knownScope(reading)?.resolved_scope ?? "unknown"} · mode=
            {knownScope(reading)?.mode ?? "unknown"} · delivery=
            {reading.deliveryReadbackError === null
              ? (reading.delivery?.mode ?? "unknown")
              : "unknown"}
          </span>
        }
      />
    </RecordRow>
  );
}

function ScopeEditor({
  repo,
  reading,
  canEdit,
  saving,
  busy,
  onSave,
}: {
  repo: string;
  reading: RepoDialReading;
  canEdit: boolean;
  saving: boolean;
  busy: boolean;
  onSave: (body: {
    repo: string;
    scope: FollowupScope;
    code_paths?: string[];
  }) => Promise<boolean>;
}) {
  const view = reading.scope;
  const known = view !== null && reading.scopeReadbackError === null;
  const stored = view?.code_paths ?? [];
  const [draftScope, setDraftScope] = useState<FollowupScope | null>(
    known ? view.scope : null
  );
  const [draftText, setDraftText] = useState(stored.join("\n"));
  const draftPaths = parseGlobLines(draftText);
  const plan =
    draftScope === null
      ? null
      : buildScopeWrite(repo, draftScope, draftPaths, stored);
  const sameGlobs =
    draftPaths.length === stored.length &&
    draftPaths.every((p, i) => p === stored[i]);
  // Nothing to save: same scope and same globs as coord's answer. (For
  // `code_only` the body always carries its globs, so compare them directly.)
  const unchanged = known && draftScope === view.scope && sameGlobs;

  return (
    <div className="space-y-2" data-testid="repo-followup-scope-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Spawn a follow-up for</span>
        {FOLLOWUP_SCOPES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={draftScope === s ? "default" : "outline"}
            disabled={!canEdit || busy}
            onClick={() => setDraftScope(s)}
            data-testid={`repo-followup-scope-${s}`}
            aria-pressed={draftScope === s}
          >
            {SCOPE_LABEL[s]}
          </Button>
        ))}
      </div>
      {draftScope !== null && (
        <p className="text-xs text-muted-foreground">
          {SCOPE_HELP[draftScope]}.
        </p>
      )}
      {!known && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The current scope is unknown, so nothing is pre-selected. Saving sets
          the scope you choose; any globs coord has stored are kept unless you
          enter new ones here.
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor={`repo-followup-paths-${repo}`} className="text-xs">
          Code globs — one per line
          {draftScope === "code_only" ? " (required)" : " (kept for later)"}
        </Label>
        <Textarea
          id={`repo-followup-paths-${repo}`}
          rows={3}
          value={draftText}
          disabled={!canEdit || busy}
          placeholder={"scripts/**\n.github/**"}
          onChange={(e) => setDraftText(e.target.value)}
          className="font-mono text-xs"
          data-testid="repo-followup-paths"
        />
        <p className="text-[11px] text-muted-foreground">
          Paths that carry a build or test check. Only used by “Code changes
          only”; under the other choices they are kept, and clearing this box
          and saving removes them.
        </p>
      </div>

      {plan !== null && "error" in plan && (
        <p
          className="text-xs text-amber-700 dark:text-amber-300"
          data-testid="repo-followup-scope-invalid"
        >
          {plan.error}.
        </p>
      )}

      <Button
        size="sm"
        disabled={
          !canEdit ||
          busy ||
          plan === null ||
          "error" in plan ||
          unchanged === true
        }
        onClick={() => {
          if (plan !== null && "body" in plan) void onSave(plan.body);
        }}
        data-testid="repo-followup-scope-save"
      >
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        Save scope
      </Button>
    </div>
  );
}

function DeliveryEditor({
  reading,
  canEdit,
  saving,
  busy,
  onChoose,
}: {
  reading: RepoDialReading;
  canEdit: boolean;
  saving: boolean;
  busy: boolean;
  onChoose: (mode: DeliveryMode) => void;
}) {
  /** The mode whose write is in flight, so only its button spins. */
  const [pending, setPending] = useState<DeliveryMode | null>(null);
  const current: DeliveryMode | null =
    reading.deliveryReadbackError === null
      ? (reading.delivery?.mode ?? null)
      : null;
  const problem = reading.deliveryReadbackError
    ? `written, but reading it back failed (${reading.deliveryReadbackError}) — refresh to re-check`
    : reading.deliveryError
      ? readErrorText(reading.deliveryError) +
        (reading.delivery ? "; showing the last value read" : "")
      : null;
  return (
    <div className="space-y-2" data-testid="repo-followup-delivery-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Hand work back</span>
        {DELIVERY_MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={current === m ? "default" : "outline"}
            disabled={!canEdit || busy || current === m}
            onClick={() => {
              setPending(m);
              onChoose(m);
            }}
            title={DELIVERY_HELP[m]}
            data-testid={`repo-followup-delivery-${m}`}
            aria-pressed={current === m}
          >
            {saving && pending === m && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {DELIVERY_LABEL[m]}
          </Button>
        ))}
        <Badge
          variant="outline"
          className={`text-[11px] ${current === null ? UNKNOWN_AMBER : ""}`}
          data-testid="repo-followup-delivery-current"
        >
          {current === null ? UNKNOWN_DASH : DELIVERY_LABEL[current]}
        </Badge>
      </div>
      {current !== null && (
        <p className="text-xs text-muted-foreground">
          {DELIVERY_HELP[current]}.
        </p>
      )}
      {problem && (
        <p
          className="text-xs text-amber-700 dark:text-amber-300"
          data-testid="repo-followup-delivery-problem"
        >
          The delivery mode is {current === null ? "unknown" : "possibly stale"}
          : {problem}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {DELIVERY_PROVENANCE_NOTE}
      </p>
    </div>
  );
}
