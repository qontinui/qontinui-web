"use client";

/**
 * The presentation scope — what the console's presentation lens may show,
 * editable in operator mode only (plan `2026-10-23-console-presentation-spaces`
 * D3.3; Phase 1's "a small real form on an existing tenant-policy … surface").
 *
 * A title renders in presentation mode only when every repository it belongs
 * to has a FIRST-PARTY owner and it holds none of the CONFIDENTIAL terms.
 * This panel shows the two lists in force and lets an admin of the active
 * project replace the project's stored half of them:
 *
 * - **In force** — the effective lists the lens applies right now, with the
 *   first-party owners labelled UNKNOWN (and why) when coord could not list
 *   the project's repositories: every title is withheld until they are known.
 * - **Defaults** — what applies when nothing is stored: the owners of the
 *   repositories the project owns, and the signed-in viewer's other projects'
 *   names, which are always withheld and never stored.
 * - **The form** — seeded from what the project has STORED, never from the
 *   effective lists (those carry the viewer's own memberships, which would
 *   then be written into a row every member reads). It saves as a
 *   compare-and-set on the stored version; when someone saved first the
 *   panel re-reads and keeps the edit for the operator to save again.
 *
 * It reads and writes through the lens's own scope store
 * (`defaultPresentationScopeStore`), so a save is in force in this tab at
 * once. The backend decides who may write (`require_coord_tenant_admin_target`
 * on `PUT /api/v1/presentation/scope`); `can_edit` is its answer, computed by
 * the same rule, and the form is not offered without it.
 *
 * The whole panel sits inside `OperatorOnly`: it lists the confidential terms
 * — the names presentation mode exists to keep off screen — so it is never
 * part of a presentation.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, Presentation } from "lucide-react";
import { RefreshButton, UNKNOWN_AMBER } from "@/components/console";
import {
  OperatorOnly,
  defaultPresentationScopeStore,
  usePresentationScopeSnapshot,
  type PresentationScopeStore,
} from "@/components/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  savePresentationScope,
  type PresentationScopeRecord,
} from "@/lib/api/presentationScope";
import { BackendError } from "@/lib/errors/backend-error-message";
import { cn } from "@/lib/utils";
import {
  draftChangesStored,
  draftFromConfigured,
  unknownOwnersReason,
  writeFromDraft,
  type OwnersMode,
  type ScopeDraft,
} from "../_lib/presentationScopeDraft";

export interface PresentationScopePanelProps {
  /** The scope store; the lens's module-wide one by default. */
  store?: PresentationScopeStore;
}

type SaveOutcome =
  | { readonly kind: "saved"; readonly version: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly message: string };

export function PresentationScopePanel(props: PresentationScopePanelProps) {
  return (
    <OperatorOnly>
      <ScopePanel {...props} />
    </OperatorOnly>
  );
}

function ScopePanel({
  store = defaultPresentationScopeStore,
}: PresentationScopePanelProps) {
  const snapshot = usePresentationScopeSnapshot(store);
  /** The operator's edit; `null` while they follow what is stored. */
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  // This page reads the scope itself — the lens reads it only while
  // presenting — and again when it is stale or a failed read's retry is due.
  useEffect(() => {
    store.ensureFresh();
    const delay = store.msUntilRecheck();
    if (delay === null) return;
    const timer = setTimeout(() => store.ensureFresh(), delay);
    return () => clearTimeout(timer);
  }, [store, snapshot]);

  // A record read under another project selection is not this page's.
  const record =
    snapshot.selection === store.currentSelection() ? snapshot.record : null;
  const canEdit = record?.can_edit === true;
  const stored = record?.configured ?? null;
  const form = draft ?? (stored ? draftFromConfigured(stored) : null);
  const dirty =
    draft !== null && stored !== null && draftChangesStored(draft, stored);

  const edit = (change: Partial<ScopeDraft>) => {
    if (!form) return;
    setDraft({ ...form, ...change });
    setOutcome(null);
  };

  const save = async () => {
    if (!record || !form) return;
    setSaving(true);
    setOutcome(null);
    try {
      const saved = await savePresentationScope(
        writeFromDraft(form, record.configured.version)
      );
      store.accept(saved);
      setDraft(null);
      setOutcome({ kind: "saved", version: saved.configured.version });
    } catch (err) {
      if (err instanceof BackendError && err.status === 409) {
        // Someone saved first: show what is stored now, keep the edit.
        setOutcome({ kind: "conflict" });
        await store.reload();
      } else if (err instanceof BackendError && err.status === 403) {
        setOutcome({
          kind: "refused",
          message:
            "The save was refused: only an admin of this project may change its presentation scope.",
        });
      } else {
        setOutcome({
          kind: "refused",
          message:
            err instanceof Error && err.message
              ? `The save was refused: ${err.message}`
              : "The save did not complete, so nothing was changed.",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const loading =
    record === null &&
    (snapshot.state.status === "loading" ||
      snapshot.state.status === "unknown");
  const readFailure =
    record === null && snapshot.failure !== null ? snapshot.failure : null;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="presentation-scope-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Presentation className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Presentation scope</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              What presentation mode may show. A title (a plan, pull request,
              session or finding) is shown only when every repository it belongs
              to has one of the first-party owners and it contains none of the
              confidential terms; anything else is replaced by a plain
              description of what it is.
            </p>
          </div>
        </div>
        <RefreshButton
          onRefresh={() => store.reload()}
          label="Refresh"
          title="Re-read the presentation scope"
          data-testid="presentation-scope-refresh"
        />
      </div>

      {loading && readFailure === null ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : record === null ? (
        <Notice testId="presentation-scope-unknown">
          The presentation scope could not be read
          {readFailure ? ` (${readFailure})` : ""}, so what presentation mode
          may show is unknown — it withholds every title until it can be read.
          Refresh once the backend answers.
        </Notice>
      ) : (
        <div className="mt-4 space-y-4">
          <InForce record={record} />
          <Defaults record={record} />
          {canEdit && form ? (
            <ScopeForm
              form={form}
              dirty={dirty}
              saving={saving}
              outcome={outcome}
              version={record.configured.version}
              onEdit={edit}
              onSave={save}
              onRevert={() => {
                setDraft(null);
                setOutcome(null);
              }}
            />
          ) : (
            <p
              className="text-xs text-muted-foreground"
              data-testid="presentation-scope-readonly"
            >
              Read-only: you are not an admin of this project, so a save would
              be refused.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** The two lists the lens applies right now. */
function InForce({ record }: { record: PresentationScopeRecord }) {
  const owners = record.first_party_owners;
  return (
    <div className="space-y-2" data-testid="presentation-scope-in-force">
      <h3 className="text-xs font-semibold text-foreground">In force</h3>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">First-party owners</span>
        {owners === null ? (
          <Badge
            variant="outline"
            className={UNKNOWN_AMBER}
            data-testid="presentation-scope-owners-unknown"
          >
            UNKNOWN —{" "}
            {unknownOwnersReason(record.first_party_owners_unknown_reason)}
          </Badge>
        ) : owners.length === 0 ? (
          <Badge variant="outline" data-testid="presentation-scope-owners-none">
            none — every title is withheld
          </Badge>
        ) : (
          <Chips values={owners} testId="presentation-scope-owners" />
        )}
        <span className="text-muted-foreground">
          {record.first_party_owners_source === "configured"
            ? "(configured for this project)"
            : "(the owners of this project's repositories)"}
        </span>
      </div>
      {owners === null && (
        <p className="text-xs text-muted-foreground">
          Until they are known, presentation mode withholds every title. Naming
          the owners below makes them known without coord.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Confidential terms</span>
        {record.confidential_terms.length === 0 ? (
          <Badge variant="outline">none</Badge>
        ) : (
          <Chips
            values={record.confidential_terms}
            testId="presentation-scope-terms"
          />
        )}
      </div>
    </div>
  );
}

/** What applies when nothing is stored, read fresh for this viewer. */
function Defaults({ record }: { record: PresentationScopeRecord }) {
  const { defaults } = record;
  return (
    <div className="space-y-2" data-testid="presentation-scope-defaults">
      <h3 className="text-xs font-semibold text-foreground">Defaults</h3>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">
          Owners of this project&apos;s repositories
        </span>
        {defaults.registered_repo_owners === null ? (
          <Badge variant="outline" className={UNKNOWN_AMBER}>
            UNKNOWN —{" "}
            {unknownOwnersReason(
              defaults.registered_repo_owners_unknown_reason
            )}
          </Badge>
        ) : defaults.registered_repo_owners.length === 0 ? (
          <Badge variant="outline">none registered</Badge>
        ) : (
          <Chips values={defaults.registered_repo_owners} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">
          Your other projects&apos; names (always withheld, never stored)
        </span>
        {defaults.viewer_other_tenant_names.length === 0 ? (
          <Badge variant="outline">none</Badge>
        ) : (
          <Chips
            values={defaults.viewer_other_tenant_names}
            testId="presentation-scope-viewer-names"
          />
        )}
      </div>
    </div>
  );
}

interface ScopeFormProps {
  form: ScopeDraft;
  dirty: boolean;
  saving: boolean;
  outcome: SaveOutcome | null;
  version: number;
  onEdit: (change: Partial<ScopeDraft>) => void;
  onSave: () => void;
  onRevert: () => void;
}

/** The project's stored half, editable. */
function ScopeForm({
  form,
  dirty,
  saving,
  outcome,
  version,
  onEdit,
  onSave,
  onRevert,
}: ScopeFormProps) {
  return (
    <form
      className="space-y-3 border-t border-border pt-3"
      data-testid="presentation-scope-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h3 className="text-xs font-semibold text-foreground">
        Stored for this project{" "}
        <span className="font-normal text-muted-foreground">
          (version {version})
        </span>
      </h3>

      <fieldset className="space-y-1.5">
        <legend className="text-xs text-muted-foreground">
          First-party owners
        </legend>
        <RadioGroup
          value={form.ownersMode}
          onValueChange={(value) => onEdit({ ownersMode: value as OwnersMode })}
          className="gap-1.5"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="registered"
              id="presentation-scope-owners-registered"
              data-testid="presentation-scope-owners-registered"
            />
            <Label
              htmlFor="presentation-scope-owners-registered"
              className="text-xs font-normal"
            >
              The owners of this project&apos;s repositories
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="list"
              id="presentation-scope-owners-list"
              data-testid="presentation-scope-owners-list"
            />
            <Label
              htmlFor="presentation-scope-owners-list"
              className="text-xs font-normal"
            >
              These GitHub owners (an empty list withholds every title)
            </Label>
          </div>
        </RadioGroup>
        {form.ownersMode === "list" && (
          <Textarea
            aria-label="First-party GitHub owners"
            value={form.ownersText}
            onChange={(event) => onEdit({ ownersText: event.target.value })}
            placeholder="one per line, e.g. your-org"
            rows={3}
            className="text-xs font-mono"
            data-testid="presentation-scope-owners-input"
          />
        )}
      </fieldset>

      <div className="space-y-1.5">
        <Label
          htmlFor="presentation-scope-terms-input"
          className="text-xs font-normal text-muted-foreground"
        >
          Confidential terms, one per line — customer and partner names a title
          must not show. Matched ignoring case, accents, spacing and
          punctuation.
        </Label>
        <Textarea
          id="presentation-scope-terms-input"
          value={form.termsText}
          onChange={(event) => onEdit({ termsText: event.target.value })}
          placeholder="e.g. Acme Corp"
          rows={4}
          className="text-xs"
          data-testid="presentation-scope-terms-input"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!dirty || saving}
          data-testid="presentation-scope-save"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={onRevert}
          data-testid="presentation-scope-revert"
        >
          Revert to stored
        </Button>
        {outcome?.kind === "saved" && (
          <span
            className="text-xs text-muted-foreground"
            data-testid="presentation-scope-saved"
          >
            Saved (version {outcome.version}); in force in this tab now.
          </span>
        )}
      </div>

      {outcome?.kind === "conflict" && (
        <Notice testId="presentation-scope-conflict">
          Someone saved the scope after you opened it. The lists above are what
          is stored now; your edit is kept below — check it against them and
          save again.
        </Notice>
      )}
      {outcome?.kind === "refused" && (
        <Notice testId="presentation-scope-refused">{outcome.message}</Notice>
      )}
    </form>
  );
}

function Chips({
  values,
  testId,
}: {
  values: readonly string[];
  testId?: string;
}) {
  return (
    <span className="flex flex-wrap gap-1" data-testid={testId}>
      {values.map((value) => (
        <Badge key={value} variant="outline" className="font-mono">
          {value}
        </Badge>
      ))}
    </span>
  );
}

function Notice({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 rounded-md border px-3 py-2",
        UNKNOWN_AMBER
      )}
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-xs">{children}</p>
    </div>
  );
}
