"use client";

/**
 * Rename a Project (a coord tenant) — its name, its short id, or both.
 *
 * Plan `2026-09-17-tenant-rename`, Phase D (D6). PATCHes
 * `/api/v1/operations/tenants/{tenant_id}`, which proxies coord's
 * `PATCH /coord/tenants/:tenant_id`. Opened from the members page's
 * "Your tenant & roles" rows where the caller holds `admin` in that tenant —
 * the one role coord's `is_tenant_admin` accepts.
 *
 * Console style guide (`frontend/docs/console-ui-style-guide.md` §1): a dialog
 * host takes **R9 (chrome)** and **R3 (palette)** only, so this composes the
 * shipped `ui/dialog` exactly as `CoordProjectCreateDialog` does and mints no
 * new visual vocabulary — a failed submit is the same `text-destructive`
 * alert box, a success is calm.
 *
 * Three rules shape it:
 *
 * 1. **Only what changed is sent.** Coord treats an absent field as "leave it
 *    alone", and a display-name-only rename never pays slug validation. A
 *    submit with nothing changed is impossible (the button is disabled), so
 *    coord's `400 empty_patch` is a backstop, not a path.
 * 2. **The short id is canonical-or-refused, and the check is shown as you
 *    type.** Unlike the create dialog's name, the short id is typed directly
 *    and nothing slugifies it on the caller's behalf (D4). The web proxy
 *    refuses a non-canonical id itself (a 422), so the local check vetoes
 *    submit — it only moves a refusal the server would give anyway to before
 *    the round-trip. The sentences come from `projectSlug.ts`, the same ones
 *    the create dialog and coord's `invalid_slug` answer render.
 * 3. **Every coord refusal gets a sentence that says what to do next**, and an
 *    unrecognized one is shown verbatim rather than flattened into "failed".
 *    `renameErrorMessage` is exported pure so the mapping is testable without
 *    a DOM.
 *
 * On success the tenant list is re-fetched in place (`TenantProvider.refresh`)
 * rather than reloading the page, and the outcome of the `<old-id>-home`
 * Cognito group follow-through is shown — the web backend never deletes that
 * group, and only a platform superuser gets it copied.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUIComponent } from "@qontinui/ui-bridge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameTenant, TenantRenameError } from "@/components/sessions/api";
import type {
  HomeGroupMigration,
  TenantRenameRequest,
  TenantRenameResponse,
} from "@/components/sessions/types";
import { useTenant } from "@/contexts/tenant-context";
import {
  isProjectSlugReason,
  MAX_DISPLAY_NAME_CHARS,
  MAX_SLUG_LEN,
  projectSlugProblemMessage,
  slugifyProjectName,
} from "./projectSlug";

/** The tenant being renamed, as the caller currently sees it. */
export interface RenameTarget {
  id: string;
  slug: string;
  /** Current display name; falls back to the slug when the tenant has none. */
  name: string;
}

/**
 * Why a typed short id cannot be used, or `null` when it is canonical.
 *
 * `slugifyProjectName` mirrors coord's rule; a short id is acceptable exactly
 * when slugifying it changes nothing. When it WOULD change something but still
 * produce a valid id, say which id — that is the fix, one keystroke away.
 */
export function renameSlugProblem(slug: string): string | null {
  const derived = slugifyProjectName(slug);
  if (!derived.ok) {
    return (
      projectSlugProblemMessage(derived.reason) ??
      "Enter a short id — lowercase letters, digits and single hyphens."
    );
  }
  if (derived.slug !== slug) {
    return `A short id uses only lowercase letters, digits and single hyphens — did you mean “${derived.slug}”?`;
  }
  return null;
}

/**
 * Turn a rename failure into something true and actionable.
 *
 * Codes are coord's contract for `PATCH /coord/tenants/:tenant_id`; three of
 * them carry a `reason` that decides the sentence. An unknown code or reason
 * falls through to coord's own words, never to a guess.
 */
export function renameErrorMessage(err: unknown): string {
  if (!(err instanceof TenantRenameError)) {
    return err instanceof Error
      ? err.message
      : "Could not reach the server to rename the project.";
  }
  const code = err.code ?? "";
  const reason = err.reason;
  switch (code) {
    case "empty_patch":
      return "Nothing changed — edit the name or the short id first.";
    case "invalid_name":
      if (reason === "empty") return "The name can't be blank.";
      if (reason === "display_name_too_long") return "That name is too long.";
      return reason
        ? `That name can't be used (${reason}).`
        : "That name can't be used.";
    case "invalid_slug": {
      if (isProjectSlugReason(reason)) {
        const sentence = projectSlugProblemMessage(reason);
        if (sentence) return sentence;
      }
      return reason
        ? `That short id can't be used (${reason}).`
        : "That short id can't be used — use lowercase letters, digits and single hyphens.";
    }
    case "reserved_name":
      switch (reason) {
        case "personal_namespace":
          return "Short ids starting with “personal” are reserved. Pick a different one.";
        case "group_mapped":
          return "That short id is already used by an SSO group mapping. Pick a different one.";
        case "historical_slug":
          return "That short id used to belong to another project and stays reserved for it. Pick a different one.";
        case "configured_default_tenant":
        case "fleet_reserved":
          return "That short id is reserved. Pick a different one.";
        default:
          return reason
            ? `That short id is reserved (${reason}). Pick a different one.`
            : "That short id is reserved. Pick a different one.";
      }
    case "slug_taken":
      return err.slug
        ? `The short id “${err.slug}” is already taken. Pick a different one.`
        : "That short id is already taken. Pick a different one.";
    case "slug_pinned":
      switch (reason) {
        case "configured_default_tenant":
          return "This project's short id can't be changed: it is the deployment's default project. You can still change its name.";
        case "bootstrap_group_mapping":
          return "This project's short id can't be changed: coord's deployment configuration maps an SSO group to it by that id. You can still change its name.";
        case "bootstrap_group_mapping_target":
          return "That short id is named in coord's deployment SSO group mappings, so it can't be given to this project. Pick a different one.";
        case "bootstrap_mappings_unreadable":
          return "The short id can't be changed right now: coord could not read its deployment SSO group mappings, so it cannot tell whether the change is safe. You can still change the name.";
        default:
          return reason
            ? `This project's short id is pinned (${reason}) and can't be changed. You can still change its name.`
            : "This project's short id is pinned and can't be changed. You can still change its name.";
      }
    case "concurrent_group_mapping":
      return "An SSO group mapping for this project changed at the same moment, so nothing was renamed. Try again.";
    case "tenant_mismatch":
      return "The rename was checked against a different project than this one. Reload the page and try again.";
    case "not_admin_in_target_tenant":
      return "Only an administrator of this project can rename it.";
    case "tenant_not_found":
      return "This project no longer exists.";
  }
  if (err.status === 403) {
    return "Only an administrator of this project can rename it.";
  }
  if (err.status === 404) return "This project no longer exists.";
  return err.detail
    ? `Could not rename the project (${err.status}): ${err.detail}`
    : `Could not rename the project (${err.status}).`;
}

/** One line on what happened to the `<old-id>-home` Cognito group. */
function homeGroupHeadline(outcome: HomeGroupMigration): string {
  switch (outcome.status) {
    case "migrated":
      return "Home group moved";
    case "requires_superuser":
      return "Home group not moved";
    case "target_exists":
      return "Home group left as is";
    case "absent":
      return "No home group to move";
    case "failed":
      return "Home group move failed";
    default:
      return "Home group";
  }
}

interface CoordProjectRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tenant to rename. The dialog renders nothing useful without one. */
  tenant: RenameTarget | null;
  /** Called after a successful rename, after the tenant list refresh. */
  onRenamed?: (result: TenantRenameResponse) => void;
}

export function CoordProjectRenameDialog({
  open,
  onOpenChange,
  tenant,
  onRenamed,
}: CoordProjectRenameDialogProps) {
  const { refresh } = useTenant();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Coord's answer is about the values SUBMITTED, so it is kept with them and
  // hidden once either field is edited — a sentence must not outlive its input.
  const [error, setError] = useState<{
    name: string;
    slug: string;
    message: string;
  } | null>(null);
  const [result, setResult] = useState<TenantRenameResponse | null>(null);

  // Pre-fill every time the dialog opens (or its target changes), so a prior
  // failure or success never bleeds into the next rename.
  useEffect(() => {
    if (!open || !tenant) return;
    setName(tenant.name);
    setSlug(tenant.slug);
    setSubmitting(false);
    setError(null);
    setResult(null);
  }, [open, tenant]);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const nameChanged = tenant !== null && trimmedName !== tenant.name;
  const slugChanged = tenant !== null && trimmedSlug !== tenant.slug;
  const nameValid =
    trimmedName.length > 0 && [...trimmedName].length <= MAX_DISPLAY_NAME_CHARS;
  const slugProblem = slugChanged ? renameSlugProblem(trimmedSlug) : null;

  const canSubmit =
    tenant !== null &&
    !submitting &&
    (nameChanged || slugChanged) &&
    (!nameChanged || nameValid) &&
    slugProblem === null;

  const shownError =
    error !== null && error.name === trimmedName && error.slug === trimmedSlug
      ? error.message
      : null;

  const handleSubmit = async () => {
    if (!canSubmit || tenant === null) return;
    const body: TenantRenameRequest = {};
    if (nameChanged) body.display_name = trimmedName;
    if (slugChanged) body.slug = trimmedSlug;
    setSubmitting(true);
    setError(null);
    try {
      const renamed = await renameTenant(tenant.id, body);
      setResult(renamed);
      // The switcher and header chip read the provider's list, which is
      // otherwise fetched once on mount.
      await refresh();
      onRenamed?.(renamed);
    } catch (err) {
      setError({
        name: trimmedName,
        slug: trimmedSlug,
        message: renameErrorMessage(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  useUIComponent({
    id: "coord-tenant-rename",
    name: "Rename project dialog",
    description:
      "Renames a coord tenant's display name and/or short id (slug). Sends only changed fields.",
    actions: [
      {
        id: "rename-tenant",
        label: "Rename tenant",
        description:
          "Submit the rename with the values currently in the dialog's fields.",
        // A rename is a reversible write — declared, not re-derived.
        effect: "write",
        handler: async () => {
          await handleSubmit();
        },
      },
    ],
  });

  const migration = result?.home_group_migration;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="coord-tenant-rename"
        data-ui-bridge-id="coord.tenant-rename"
      >
        <DialogHeader>
          <DialogTitle>
            {result ? "Project renamed" : "Rename project"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "The new name and short id are in effect now."
              : "Change what this project is called. Its members, repos and sessions stay as they are."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div
            className="space-y-3 py-2"
            data-testid="coord-tenant-rename-success"
          >
            <p className="text-sm font-medium">
              {result.display_name ?? result.slug}
            </p>
            <p
              className="font-mono text-[10px] text-muted-foreground/60"
              data-testid="coord-tenant-rename-result-slug"
            >
              {result.slug}
              {result.previous.slug !== result.slug
                ? ` · was ${result.previous.slug}`
                : ""}
            </p>
            {migration ? (
              <div
                className="space-y-1 text-xs"
                data-testid="coord-tenant-rename-home-group"
                data-status={migration.status}
              >
                <p className="font-medium">{homeGroupHeadline(migration)}</p>
                <p
                  className={
                    migration.status === "failed"
                      ? "text-destructive whitespace-pre-wrap break-words"
                      : "text-muted-foreground whitespace-pre-wrap break-words"
                  }
                >
                  {migration.detail}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="coord-tenant-rename-name">Project name</Label>
              <Input
                id="coord-tenant-rename-name"
                data-testid="coord-tenant-rename-display-name"
                data-ui-bridge-id="coord.tenant-rename.display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_DISPLAY_NAME_CHARS}
                autoComplete="off"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coord-tenant-rename-slug">Short id</Label>
              <Input
                id="coord-tenant-rename-slug"
                className="font-mono"
                data-testid="coord-tenant-rename-slug"
                data-ui-bridge-id="coord.tenant-rename.slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={MAX_SLUG_LEN}
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
                aria-invalid={slugProblem !== null}
                aria-describedby="coord-tenant-rename-slug-note"
              />
              <p
                id="coord-tenant-rename-slug-note"
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {slugProblem !== null ? (
                  <span
                    className="text-destructive"
                    data-testid="coord-tenant-rename-slug-problem"
                  >
                    {slugProblem}
                  </span>
                ) : (
                  <>
                    The short id is an identifier: SSO group mappings and the{" "}
                    <span
                      className="font-mono text-foreground"
                      data-testid="coord-tenant-rename-slug-preview"
                    >
                      {(trimmedSlug || tenant?.slug) ?? ""}-home
                    </span>{" "}
                    group refer to it. Whether a new one is free is checked when
                    you save.
                  </>
                )}
              </p>
            </div>
            {shownError !== null ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap break-words"
                data-testid="coord-tenant-rename-error"
                data-ui-bridge-id="coord.tenant-rename.error"
                role="alert"
              >
                {shownError}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button
              onClick={() => onOpenChange(false)}
              data-testid="coord-tenant-rename-done"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                data-testid="coord-tenant-rename-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                data-testid="coord-tenant-rename-submit"
                data-ui-bridge-id="coord.tenant-rename.submit"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Renaming…
                  </>
                ) : (
                  "Rename"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
