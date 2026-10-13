"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ImageIcon, Loader2 } from "lucide-react";
import {
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  UNKNOWN_AMBER,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useImageGenerationPolicy } from "../_hooks/useImageGenerationPolicy";
import {
  IMAGE_GENERATION_LEVEL_LABEL,
  IMAGE_GENERATION_PALETTE,
  IMAGE_GENERATION_REPO_CHOICE_LABEL,
  UNKNOWN_DASH,
  findOverride,
  knownLevel,
  overrideStatus,
  type ImageGenerationOverride,
  type TenantImageGeneration,
} from "../_lib/imageGenerationStatus";
import {
  IMAGE_GENERATION_LEVELS,
  IMAGE_GENERATION_REPO_CHOICES,
  isOwnerName,
  type ImageGenerationLevel,
  type ImageGenerationRepoChoice,
} from "../types";

const LEVEL_BLURB: Record<ImageGenerationLevel, string> = {
  on: "Agents may generate images — with the fleet's own image generator, and with a cloud image provider only within the quota the launch kit grants it.",
  local_only:
    "Images are generated only on the fleet's own hardware. Nothing — prompt or image — is sent to a cloud image provider or cloud model, so a step that would need one is skipped.",
  off: "No images are generated and no image model is called. An image request is refused with a reason that names this setting.",
};

/**
 * The `image_generation` dial (plan
 * `2026-10-13-image-generation-and-visual-judgment` Phase 12 step 2, D1.7):
 * a tenant level plus per-repo overrides.
 *
 * The tenant row is laid out exactly as `CommandSafetyRewritePanel` and
 * `AccountSelectionPanel` beside it, and shows the level coord RESOLVES, never
 * the level last written (`useTenantFleetPolicyDial` property 1). The override
 * list composes the console primitives the way Dev Ops ▸ CI's
 * `GithubHostedCiPanel` does (style guide §6.4): one `RecordRow` per repo (R2)
 * with its controls in the in-place detail (R5).
 *
 * The states kept apart, every UNKNOWN rendered as such and never as a level:
 *
 * * no row, level `on` — coord's declared default, named as a default;
 * * no row, any other level — UNKNOWN: a coord that predates the domain (its
 *   generic no-row `off`), or an answer with no level that the backend floored
 *   to `off`. It must not read as `on`, and must not read as somebody's `off`;
 * * a level outside the three (a hand-written row) — UNKNOWN, named;
 * * a failed read, or a failed read-back after a write — UNKNOWN;
 * * `repo_overrides` absent — the list is UNKNOWN, never "no overrides".
 *
 * There is no "overridden by a repo row" note on the tenant row, unlike the
 * other two dials: this read names no repo, so coord never resolves a repo row
 * for it, and every repo row is listed below instead.
 */
export function ImageGenerationPanel() {
  /** Which tenant level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<ImageGenerationLevel | null>(null);
  const [repoInput, setRepoInput] = useState("");
  /** Which add-form level's write is in flight. */
  const [addPending, setAddPending] = useState<ImageGenerationLevel | null>(
    null
  );
  const {
    policy,
    loading,
    saving,
    error,
    readbackError,
    lastWrite,
    refresh,
    setLevel,
    tenant,
    displayLevel,
    overrides,
    writeRepo,
    savingRepo,
    repoReadbackErrors,
    repoWriteErrors,
  } = useImageGenerationPolicy();

  const canEdit = policy?.can_edit === true;
  const fallingBackToSystem = policy?.resolved_scope === "system";
  // A failed latest read keeps the last values on screen: say they may be old.
  const stale = error !== null && policy !== null;

  // coord stores this domain's repo keys in lower case; send what it stores.
  const candidate = repoInput.trim().toLowerCase();
  const candidateValid = isOwnerName(candidate);
  const existing = candidateValid ? findOverride(overrides, candidate) : null;
  const addError = candidateValid ? (repoWriteErrors[candidate] ?? null) : null;
  // Writes whose read-back failed for a repo the list does not show: still
  // UNKNOWN, and still owed a place on screen.
  const unlistedReadbackErrors = Object.entries(repoReadbackErrors).filter(
    ([repo]) => findOverride(overrides, repo) === null
  );

  const addOverride = async (level: ImageGenerationLevel) => {
    setAddPending(level);
    try {
      if (await writeRepo(candidate, level)) setRepoInput("");
    } finally {
      setAddPending(null);
    }
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="image-generation-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ImageIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Image generation</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Whether agents may generate images for this tenant&apos;s
              products, and whether a prompt or an image may leave the
              fleet&apos;s own hardware to do it. Studio checks this before
              each image request, for the repo it is generating for; a repo
              with an override below follows its override instead.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Studio builds that predate this setting ignore it.
            </p>
          </div>
        </div>
        <RefreshButton
          onRefresh={refresh}
          label="Refresh"
          title="Re-read the image generation setting and its repo overrides"
          data-testid="image-generation-refresh"
        />
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {IMAGE_GENERATION_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={displayLevel === level ? "default" : "outline"}
                disabled={saving || !canEdit}
                onClick={() => {
                  setPending(level);
                  setLevel(level).finally(() => setPending(null));
                }}
                data-testid={`image-generation-${level}`}
              >
                {/* Only the level being written spins. */}
                {saving && pending === level && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {IMAGE_GENERATION_LEVEL_LABEL[level]}
              </Button>
            ))}
            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Studio resolves</span>
              <Badge
                variant={
                  displayLevel !== null && displayLevel !== "off"
                    ? "default"
                    : "outline"
                }
                className={displayLevel === null ? UNKNOWN_AMBER : undefined}
                data-testid="image-generation-effective"
                data-level={displayLevel ?? "unknown"}
              >
                {displayLevel === null
                  ? "unknown"
                  : IMAGE_GENERATION_LEVEL_LABEL[displayLevel]}
              </Badge>
              <span>from the</span>
              <Badge variant="outline" data-testid="image-generation-scope">
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="image-generation-readonly"
            >
              {policy
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {tenant?.state === "known" && tenant.defaulted && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="image-generation-no-row"
            >
              No policy row answered for this tenant, so nobody chose this: On
              is image generation&apos;s default. Pick a level to write an
              explicit row.
            </p>
          )}

          {tenant?.state === "no_declared_default" && (
            <Notice testId="image-generation-undeclared-default">
              Coord answered with no row for this tenant, but with{" "}
              <code>{tenant.raw}</code> rather than image generation&apos;s
              default (On): the coord answering predates this setting, or
              reported no level at all. What Studio resolves is unknown.
            </Notice>
          )}

          {tenant?.state === "unrecognised" && (
            <Notice testId="image-generation-unrecognized">
              The resolved level is <code>{tenant.raw}</code>, which is not one
              of the levels above, so what Studio does with it is unknown. Pick
              a level to replace the row.
            </Notice>
          )}

          {fallingBackToSystem && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="image-generation-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {readbackError && (
            <Notice testId="image-generation-readback-error">
              The write to <code>{lastWrite?.written_level}</code> was accepted,
              but reading back what Studio resolves failed ({readbackError}).
              The value above is the last one confirmed and may be stale.
              Refresh to re-check.
            </Notice>
          )}

          {error && (
            <Notice testId="image-generation-error">
              Couldn&apos;t read the image generation setting: {error}.{" "}
              {policy
                ? "Showing the last value read, which may be out of date."
                : "The current value is unknown."}
            </Notice>
          )}

          {/* Coord returns `fleet_resources` blocks with any domain's read; the
              backend strips them and this line says so. */}
          {policy != null && policy.keys_not_shown.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="image-generation-keys-not-shown"
            >
              Coord also returned {policy.keys_not_shown.join(", ")} with this
              read.{" "}
              {policy.keys_not_shown_source === "fleet_resources_row"
                ? "Those belong to the fleet_resources row, not to this setting, and are not shown here."
                : "Those are not shown here."}
            </p>
          )}

          <p
            className="text-xs text-muted-foreground"
            data-testid="image-generation-blurb"
          >
            {tenantBlurb(tenant)}
          </p>

          {/* ---- Per-repo overrides ------------------------------------ */}
          <div
            className="space-y-2 border-t border-border pt-3"
            data-testid="image-generation-overrides"
          >
            <h3 className="text-xs font-semibold">Per-repo overrides</h3>
            <p className="max-w-2xl text-xs text-muted-foreground">
              A repo with no override follows the tenant setting. An override
              changes image generation for that one repo; Inherit clears it.
            </p>

            {overrides === null ? (
              <Notice testId="image-generation-overrides-unknown">
                {policy
                  ? "This coord does not list per-repo overrides, so whether any repo overrides the tenant setting is unknown."
                  : "The per-repo overrides are unknown until the setting can be read."}
              </Notice>
            ) : (
              <RecordList<ImageGenerationOverride>
                items={overrides}
                itemKey={(o) => o.repo}
                loaded={policy !== null}
                empty={
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="image-generation-overrides-empty"
                  >
                    No repo overrides: every repo follows the tenant setting.
                  </p>
                }
                renderRow={(o, { expanded, onToggle }) => (
                  <OverrideRow
                    override={o}
                    tenant={tenant}
                    expanded={expanded}
                    onToggle={onToggle}
                    stale={stale}
                    readbackError={repoReadbackErrors[o.repo] ?? null}
                    writeError={repoWriteErrors[o.repo] ?? null}
                    canEdit={canEdit}
                    saving={savingRepo === o.repo}
                    busy={savingRepo !== null}
                    onChoose={(choice) => void writeRepo(o.repo, choice)}
                  />
                )}
              />
            )}

            {unlistedReadbackErrors.map(([repo, reason]) => (
              <Notice key={repo} testId="image-generation-unlisted-readback">
                The write for <code>{repo}</code> was accepted, but reading it
                back failed ({reason}), so whether it carries an override is
                unknown. Refresh to re-check.
              </Notice>
            ))}

            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="image-generation-add"
            >
              <Label
                htmlFor="image-generation-add-repo"
                className="text-xs font-medium"
              >
                Override a repo
              </Label>
              <Input
                id="image-generation-add-repo"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
                autoComplete="off"
                disabled={!canEdit || savingRepo !== null}
                className="h-8 w-60 text-xs"
                data-testid="image-generation-add-repo"
              />
              {IMAGE_GENERATION_LEVELS.map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || !candidateValid || savingRepo !== null}
                  onClick={() => void addOverride(level)}
                  data-testid={`image-generation-add-${level}`}
                >
                  {addPending === level && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  {IMAGE_GENERATION_LEVEL_LABEL[level]}
                </Button>
              ))}
            </div>
            {repoInput.trim() !== "" && !candidateValid && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="image-generation-add-hint"
              >
                Name the repo as owner/name — for example
                qontinui/qontinui-web.
              </p>
            )}
            {existing && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="image-generation-add-existing"
              >
                <code>{existing.repo}</code> already has an override (
                {existing.level === null
                  ? UNKNOWN_DASH
                  : IMAGE_GENERATION_LEVEL_LABEL[existing.level]}
                ); choosing a level here replaces it.
              </p>
            )}
            {addError && (
              <p
                className="text-xs text-amber-700 dark:text-amber-300"
                data-testid="image-generation-add-error"
              >
                The override was not applied: {addError}.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** The tenant row's closing sentence — `null` readings say UNKNOWN, never `off`. */
function tenantBlurb(tenant: TenantImageGeneration | null): string {
  const level = knownLevel(tenant);
  if (level !== null) return LEVEL_BLURB[level];
  if (tenant === null) {
    return "The resolved level could not be read, so whether agents may generate images is unknown.";
  }
  return "The resolved level is not one this console can vouch for, so whether agents may generate images is unknown.";
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

function OverrideRow({
  override,
  tenant,
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
  override: ImageGenerationOverride;
  tenant: TenantImageGeneration | null;
  expanded: boolean;
  onToggle: () => void;
  stale: boolean;
  readbackError: string | null;
  writeError: string | null;
  canEdit: boolean;
  saving: boolean;
  busy: boolean;
  onChoose: (choice: ImageGenerationRepoChoice) => void;
}) {
  const status = overrideStatus(override, { tenant, stale, readbackError });
  // A listed row IS an override, so `inherit` is never the current choice; an
  // unknown or unconfirmed one highlights nothing.
  const current = readbackError ? null : override.level;
  const tenantLevel = knownLevel(tenant);
  return (
    <RecordRow
      data-testid="image-generation-override-row"
      identity={override.repo}
      label="image generation"
      status={<StatusBadge status={status} palette={IMAGE_GENERATION_PALETTE} />}
      reason={status.reason}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="image-generation-override-detail"
        why={
          <p className="text-xs">
            {readbackError || override.level === null
              ? status.reason
              : `Studio resolves ${IMAGE_GENERATION_LEVEL_LABEL[override.level]} for this repo, from its own override${stale ? " (the last refresh failed, so this may be stale)" : ""}. Inherit clears the override, so the repo follows the tenant setting (${tenantLevel === null ? "currently unknown" : IMAGE_GENERATION_LEVEL_LABEL[tenantLevel]}).`}
          </p>
        }
        problems={
          writeError ? (
            <p
              className="text-xs text-amber-700 dark:text-amber-300"
              data-testid="image-generation-override-write-error"
            >
              The last change was not applied: {writeError}.
            </p>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {IMAGE_GENERATION_REPO_CHOICES.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={current === choice ? "default" : "outline"}
                disabled={!canEdit || busy || current === choice}
                onClick={() => onChoose(choice)}
                data-testid={`image-generation-override-${choice}`}
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {IMAGE_GENERATION_REPO_CHOICE_LABEL[choice]}
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
          override.level === null ? (
            <span>effective_level: {override.raw}</span>
          ) : undefined
        }
      />
    </RecordRow>
  );
}
