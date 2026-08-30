"use client";

/**
 * Create a new Project (a coord tenant) from the operator console header.
 *
 * Plan `2026-08-25-self-service-tenant-project-creation`, Phase 3. Posts a
 * single field — the name the user typed — to
 * `POST /api/v1/operations/tenants`, which proxies coord's
 * `POST /coord/tenants`.
 *
 * Console style guide (`frontend/docs/console-ui-style-guide.md`): a dialog
 * host inside the console takes **R9 (chrome)** and **R3 (palette)** only,
 * so this composes the shipped `ui/dialog` shape used by the other coord
 * dialogs and mints no new red or amber — a failed submit is
 * `text-destructive`, and the success state is calm even though it carries a
 * caveat, because amber's contract is "waiting on something that will clear
 * itself" and nothing here is waiting.
 *
 * Three honesty rules drive the design, all stated by a plan:
 *
 * 1. **Never silently mangle the name.** Coord slugifies and REJECTS a name
 *    that does not survive it (`400 invalid_name`) rather than assigning
 *    something like `---`. So this form does not pre-slugify, does not
 *    "clean up" what was typed, and surfaces coord's reason — a code it
 *    recognizes gets plain-English copy, anything else is shown VERBATIM
 *    rather than flattened into a generic failure.
 * 2. **Name the runner-pairing limitation in the success state.** A
 *    self-created project is an ADDITIONAL membership, not the creator's
 *    home tenant, and `mint_pair_code_endpoint` mints codes for the home
 *    tenant only — so no runner can be paired to it yet (plan Q5,
 *    explicitly out of scope). Saying so on success is cheaper than letting
 *    the user discover it by failing to pair.
 * 3. **Show the derived id BEFORE submit, and never promise it.** Plan
 *    `2026-08-27-tenant-creation-fix-and-members-page-ux` Phase 1 #7: this
 *    dialog used to reveal the slug only in the success state, which is too
 *    late to be an affordance — it made rule 1's reject-don't-mangle contract
 *    something the user met only by failing. `slugifyProjectName` mirrors
 *    coord's rule so the id appears as they type. It is a preview and nothing
 *    more: it does not gate submit (a mirror with a veto turns drift into an
 *    unusable name — see `projectSlug.ts`), and it says only what the id WOULD
 *    be, never that it is available, because the reserved-list and
 *    group-mapping halves of coord's answer cannot be mirrored from a browser.
 *
 * The success path is deliberately two-step rather than an immediate
 * reload: the caveat above would be unreadable if the page navigated out
 * from under it. Confirming does exactly what the switcher's `onSwitch`
 * does — `setActiveTenantId(newId)` (persisted to localStorage) then
 * `window.location.reload()`. The reload is NOT optional: `tenants` is
 * fetched once in a mount-time effect, so the new tenant is absent from the
 * in-memory list and a plain state update would leave the switcher
 * selecting a row it has no data for.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { createTenant, TenantCreateError } from "@/components/sessions/api";
import type { TenantCreateResponse } from "@/components/sessions/types";
import { useTenant } from "@/contexts/tenant-context";
import { projectSlugProblemMessage, slugifyProjectName } from "./projectSlug";

/** Coord's `min_length`/`max_length` on the proxy's `display_name`. Mirrored
 *  here only to disable submit early — the server is still the authority. */
const MAX_NAME_LENGTH = 120;

/**
 * Turn a create failure into something true.
 *
 * The three codes below are the ones coord documents for this route, so they
 * get copy a non-engineer can act on. Everything else — an unknown code, a
 * plain-text body, a 502 from an unreachable coord — falls through to
 * coord's own words plus the status, because a generic "failed to create
 * project" would be us asserting we know a cause we do not.
 *
 * Exported pure so the mapping is unit-testable without a DOM.
 */
export function projectCreateErrorMessage(err: unknown): string {
  if (!(err instanceof TenantCreateError)) {
    return err instanceof Error
      ? err.message
      : "Could not reach the server to create the project.";
  }
  const code = err.code ?? "";
  if (code === "slug_taken" || err.status === 409) {
    return "That name is taken. Pick a different one.";
  }
  if (code === "invalid_name") {
    return "That name can't be used — try letters and numbers.";
  }
  // `reserved_name` is the DENYLIST rejection, and it is the security-relevant
  // one: coord reserves the `personal-` namespace and any slug a group mapping
  // already points at precisely because both SSO auto-provision paths JOIN an
  // existing slug rather than rejecting it, so a squatted slug would capture
  // the tenant a victim's first login (or an admin's mapping) lands in. The
  // user does not need any of that — they need to know the name is unavailable
  // and that trying another one is the fix. Coord's machine-readable `reason`
  // arrives as the detail (`parseTenantCreateError` reads `obj.reason`); an
  // unrecognized one falls through to the verbatim branch rather than being
  // flattened, so a reason added coord-side later is still legible here.
  if (code === "reserved_name") {
    switch (err.detail) {
      case "personal_namespace":
        return "Names starting with \u201cpersonal\u201d are reserved. Pick a different one.";
      case "group_mapped":
        return "That name is already reserved for a group. Pick a different one.";
      case "configured_default_tenant":
      case "fleet_reserved":
        return "That name is reserved. Pick a different one.";
      default:
        return `That name is reserved (${err.detail}). Pick a different one.`;
    }
  }
  // The per-operator creation cap (`COORD_SELF_SERVICE_TENANT_CAP`), which
  // coord answers as `403 tenant_cap_reached`. The loose match is kept as a
  // backstop, and a miss still costs nothing: the fall-through below shows
  // coord's own text.
  if (
    code === "tenant_cap_reached" ||
    err.status === 429 ||
    /cap|quota|limit/i.test(code)
  ) {
    return "You've reached the limit on how many projects you can create.";
  }
  return err.detail
    ? `Could not create the project (${err.status}): ${err.detail}`
    : `Could not create the project (${err.status}).`;
}

interface CoordProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CoordProjectCreateDialog({
  open,
  onOpenChange,
}: CoordProjectCreateDialogProps) {
  const { setActiveTenantId } = useTenant();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TenantCreateResponse | null>(null);

  // Reset every time the dialog opens, so a prior failure or a prior
  // success never bleeds into the next create.
  useEffect(() => {
    if (!open) return;
    setName("");
    setSubmitting(false);
    setError(null);
    setCreated(null);
  }, [open]);

  const trimmed = name.trim();
  const canSubmit =
    !submitting && trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;

  // The live slug preview (plan Phase 1 #7). Derived from the TRIMMED value
  // because that is what `handleSubmit` posts — previewing the raw text would
  // show a different id from the one the request asks for.
  //
  // It deliberately does NOT feed `canSubmit`. `slugifyProjectName` is a
  // mirror of a rule that lives in coord, and giving a mirror a veto is how a
  // drift stops being a cosmetic bug and starts making a legitimate name
  // unusable. The server remains the authority, exactly as this file's header
  // rule 1 says; the preview only stops the answer from being a surprise.
  const slugPreview = slugifyProjectName(trimmed);
  const slugProblem = slugPreview.ok
    ? null
    : projectSlugProblemMessage(slugPreview.reason);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // Sent exactly as typed — coord decides whether the name is usable.
      const result = await createTenant({ display_name: trimmed });
      setCreated(result);
    } catch (err) {
      setError(projectCreateErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenCreated = () => {
    if (!created) return;
    setActiveTenantId(created.tenant_id);
    // The tenant list is fetched once on mount, so the new project is not in
    // memory yet. Reload to re-run that fetch in the new selection.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="coord-project-create"
        data-ui-bridge-id="coord.project-create"
        onSubmit={created ? undefined : () => void handleSubmit()}
      >
        <DialogHeader>
          <DialogTitle>
            {created ? "Project created" : "New project"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "You're an admin of this project. Open it to start working there."
              : "A project is its own workspace — separate members, repos and sessions. You'll be its admin."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div
            className="space-y-3 py-2"
            data-testid="coord-project-create-success"
          >
            <p className="text-sm font-medium">{created.display_name}</p>
            <p className="text-sm text-muted-foreground">
              A runner can&apos;t be paired to this project yet — pair codes are
              still minted for your home project only.
            </p>
            <p
              className="font-mono text-[10px] text-muted-foreground/60"
              data-testid="coord-project-create-slug"
            >
              {created.slug} · {created.tenant_id}
            </p>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="coord-project-name">Project name</Label>
            <Input
              id="coord-project-name"
              data-testid="coord-project-create-name"
              data-ui-bridge-id="coord.project-create.name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Pizzeria"
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={error !== null}
              aria-describedby={
                [
                  error !== null ? "coord-project-create-error" : null,
                  trimmed.length > 0 ? "coord-project-create-preview" : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            <p className="text-xs text-muted-foreground">
              Use the name you&apos;d say out loud. It gets a short id of its
              own, and if the name can&apos;t produce one you&apos;ll be told
              rather than given something you didn&apos;t choose.
            </p>
            {/* The derived id, live (plan Phase 1 #7). `aria-live="polite"`
                rather than `role="alert"`: this updates on every keystroke, and
                an assertive region would interrupt the operator mid-word to
                read out an id they are still typing. */}
            {trimmed.length > 0 ? (
              <p
                id="coord-project-create-preview"
                className="text-xs text-muted-foreground"
                data-testid="coord-project-create-preview"
                data-ui-bridge-id="coord.project-create.preview"
                aria-live="polite"
              >
                {slugPreview.ok ? (
                  <>
                    Short id:{" "}
                    <span
                      className="font-mono text-foreground"
                      data-testid="coord-project-create-preview-slug"
                    >
                      {slugPreview.slug}
                    </span>
                    {/* Derivation is ALL that can be previewed. Coord's other
                        two rejections are unmirrorable from here — the reserved
                        list reads coord's own deployment config, and the
                        group-mapping check is a read inside the create
                        transaction — so this line must never be taken for
                        "this id is yours". */}
                    <span className="text-muted-foreground/70">
                      {" "}
                      · whether it&apos;s free is checked when you create it
                    </span>
                  </>
                ) : (
                  <span
                    className="text-destructive"
                    data-testid="coord-project-create-preview-problem"
                  >
                    {slugProblem}
                  </span>
                )}
              </p>
            ) : null}
            {error !== null ? (
              <p
                id="coord-project-create-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap break-words"
                data-testid="coord-project-create-error"
                data-ui-bridge-id="coord.project-create.error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {created ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="coord-project-create-later"
              >
                Later
              </Button>
              <Button
                onClick={handleOpenCreated}
                data-testid="coord-project-create-open"
                data-ui-bridge-id="coord.project-create.open"
              >
                Open project
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                data-testid="coord-project-create-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                data-testid="coord-project-create-submit"
                data-ui-bridge-id="coord.project-create.submit"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create project"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
