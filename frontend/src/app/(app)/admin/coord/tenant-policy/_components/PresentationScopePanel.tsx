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
 *   then be written into a row every member reads). An edit is bound to the
 *   scope it was made against — the project and the stored version at its
 *   first keystroke (`ScopeEdit`) — and the panel's own re-reads never move
 *   that: a save is a compare-and-set on what the operator actually edited.
 *   When the stored version moved underneath, the save answers 409 and the
 *   panel re-reads, keeping the edit for the operator to check and save
 *   again. When the active project changed underneath (another tab switched
 *   it), the edit is SET ASIDE — never shown under, nor saved into, the
 *   other project's scope — and the backend refuses it too
 *   (`expected_tenant_id`).
 * - **The outcome** — what the save observed: saved, refused (a 4xx, nothing
 *   written), or UNKNOWN (a timeout, a lost connection or a 5xx: the backend
 *   may have committed before the answer was lost), in which case the panel
 *   re-reads and says so rather than claiming either. Every re-read after a
 *   save is a fresh one (`rereadNow`: a read already in flight was sent
 *   before the save and may carry what was stored before it), and the notice
 *   says how it went — being read, read after the save, or failed too, which
 *   leaves what is stored UNKNOWN and the lists from before the save.
 * - **A stale read** — when the latest read failed while an earlier one is
 *   held, the lists are labelled as the last read, not as in force:
 *   presentation mode withholds every title until a read succeeds.
 *
 * It reads and writes through the lens's own scope store
 * (`defaultPresentationScopeStore`), so a save is in force in this tab at
 * once — when the project has not changed since the save was sent. The backend decides who may write
 * (`require_coord_tenant_admin_target` on `PUT /api/v1/presentation/scope`);
 * `can_edit` is its answer, computed by the same rule, and the form is not
 * offered without it.
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
  type PresentationScopeReread,
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
import { cn } from "@/lib/utils";
import {
  baseOf,
  draftChangesStored,
  draftFromConfigured,
  editIsFor,
  saveFailureOf,
  unknownOwnersReason,
  writeFromEdit,
  type OwnersMode,
  type ScopeDraft,
  type ScopeEdit,
} from "../_lib/presentationScopeDraft";

export interface PresentationScopePanelProps {
  /** The scope store; the lens's module-wide one by default. */
  store?: PresentationScopeStore;
}

/** How the re-read a save started has gone so far. */
type RereadState = { readonly status: "pending" } | PresentationScopeReread;

const REREAD_PENDING: RereadState = { status: "pending" };

type SaveOutcome =
  | {
      readonly kind: "saved";
      readonly version: number;
      /** Whether the answer is in force in this tab: false when the active
       *  project changed while the save was in flight. */
      readonly held: boolean;
      /** The re-read of the project selected now, when not held. */
      readonly reread: RereadState | null;
    }
  | { readonly kind: "conflict"; readonly reread: RereadState }
  | { readonly kind: "refused"; readonly message: string }
  | {
      readonly kind: "unknown";
      readonly message: string;
      readonly reread: RereadState;
    };

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
  /** The operator's edit, bound to the scope it was made against; `null`
   *  while they follow what is stored. */
  const [edit, setEdit] = useState<ScopeEdit | null>(null);
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
  // An edit made for another project (the selection changed underneath) is
  // set aside: never shown under this project's scope, never saved into it.
  const ownEdit = edit !== null && record !== null && editIsFor(edit, record);
  const setAside = edit !== null && record !== null && !ownEdit;
  const form =
    ownEdit && edit ? edit.draft : stored ? draftFromConfigured(stored) : null;
  const dirty =
    ownEdit && edit !== null && stored !== null
      ? draftChangesStored(edit.draft, stored)
      : false;
  // The version this edit was made against, when the stored one has moved
  // since (a re-read brought someone's save in): the save will say so.
  const editedFrom =
    ownEdit && edit !== null && stored !== null
      ? edit.base.version !== stored.version
        ? edit.base.version
        : null
      : null;

  const updateDraft = (patch: Partial<ScopeDraft>) => {
    if (!form || !record) return;
    setEdit({
      draft: { ...form, ...patch },
      // Bound at the first keystroke; later keystrokes keep the binding.
      base: ownEdit && edit ? edit.base : baseOf(record),
    });
    setOutcome(null);
  };

  /**
   * Show the outcome `outcomeOf` builds with its re-read started, then —
   * once THAT read answers — with how it went. The form is read-only while
   * it runs (the save is still settling), so nothing replaces the outcome
   * meanwhile.
   */
  const rereadInto = async (
    outcomeOf: (reread: RereadState) => SaveOutcome
  ): Promise<PresentationScopeReread> => {
    setOutcome(outcomeOf(REREAD_PENDING));
    const reread = await store.rereadNow();
    setOutcome(outcomeOf(reread));
    return reread;
  };

  const save = async () => {
    if (!record || !ownEdit || edit === null) return;
    const sent = edit;
    setSaving(true);
    setOutcome(null);
    // The selection this save is sent under: its answer is held only if the
    // project is still that one when it lands.
    const sentUnder = store.currentSelection();
    try {
      const saved = await savePresentationScope(writeFromEdit(sent));
      const held =
        saved.tenant_id === sent.base.tenantId &&
        store.accept(saved, sentUnder);
      setEdit(null);
      const version = saved.configured.version;
      if (held) {
        setOutcome({ kind: "saved", version, held, reread: null });
      } else {
        // Saved, but the project changed meanwhile: read the one selected
        // now rather than hold another project's answer as its scope.
        await rereadInto((reread) => ({
          kind: "saved",
          version,
          held,
          reread,
        }));
      }
    } catch (err) {
      const failure = saveFailureOf(err);
      if (failure.kind === "conflict") {
        // The stored scope moved since the edit began. Read what is stored
        // now and keep the edit, re-bound to what was read: the notice asks
        // the operator to check it, and their next save is against it. A
        // read that failed re-binds nothing — what is stored is unknown, and
        // a save against it would be refused again.
        const reread = await rereadInto((state) => ({
          kind: "conflict",
          reread: state,
        }));
        const snapshotNow = store.getSnapshot();
        const current =
          reread.status === "read" &&
          snapshotNow.selection === store.currentSelection()
            ? snapshotNow.record
            : null;
        if (current !== null && editIsFor(sent, current)) {
          setEdit({ draft: sent.draft, base: baseOf(current) });
        }
      } else if (failure.kind === "tenant-moved") {
        // The active project is not the one this edit was made for: nothing
        // was written. Read the project selected now; the edit stays bound to
        // its own project, so it is set aside rather than shown here.
        await store.rereadNow();
      } else if (failure.kind === "unknown") {
        // The save may have been committed before its answer was lost: say
        // so, and read what is stored AFTER it instead of claiming either.
        await rereadInto((reread) => ({ ...failure, reread }));
      } else {
        setOutcome(failure);
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
  // The latest read failed while an earlier one is held: those lists are the
  // last read, not what presentation mode applies (it withholds every title).
  const staleFailure =
    record !== null && snapshot.failure !== null ? snapshot.failure : null;

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
          {staleFailure !== null && (
            <Notice testId="presentation-scope-stale">
              The latest read of the presentation scope failed ({staleFailure}),
              so what is stored now is unknown and presentation mode withholds
              every title until a read succeeds. The lists below are from an
              earlier read.
            </Notice>
          )}
          <InForce record={record} current={staleFailure === null} />
          <Defaults record={record} />
          {setAside && (
            <Notice testId="presentation-scope-set-aside">
              An unsaved edit made for another project is set aside: the active
              project changed before it was saved. It is not shown here and is
              never saved into this project — switch back to that project to
              finish it, or discard it. Editing this project&apos;s scope
              discards it.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setEdit(null)}
                data-testid="presentation-scope-discard-set-aside"
              >
                Discard it
              </button>
            </Notice>
          )}
          {canEdit && form ? (
            <ScopeForm
              form={form}
              dirty={dirty}
              saving={saving}
              outcome={outcome}
              version={record.configured.version}
              editedFrom={editedFrom}
              onEdit={updateDraft}
              onSave={save}
              onRevert={() => {
                setEdit(null);
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

/**
 * The two lists the lens applies right now — or, when the latest read failed
 * (`current` false), the two an earlier read returned, which it does not.
 */
function InForce({
  record,
  current,
}: {
  record: PresentationScopeRecord;
  current: boolean;
}) {
  const owners = record.first_party_owners;
  return (
    <div className="space-y-2" data-testid="presentation-scope-in-force">
      <h3 className="text-xs font-semibold text-foreground">
        {current ? "In force" : "Last read (not in force)"}
      </h3>
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
  /** The stored version the edit was made against, when it is not `version`. */
  editedFrom: number | null;
  onEdit: (patch: Partial<ScopeDraft>) => void;
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
  editedFrom,
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
      {editedFrom !== null && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="presentation-scope-edited-from"
        >
          Your edit began from version {editedFrom}; the scope has been saved
          since, so saving will ask you to check your edit against what is
          stored now.
        </p>
      )}

      {/* Read-only while a save is in flight, so the edit that answer
          settles is the edit that was sent. */}
      <fieldset
        className="space-y-1.5"
        disabled={saving}
        data-testid="presentation-scope-owners-fieldset"
      >
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

      <fieldset className="space-y-1.5" disabled={saving}>
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
      </fieldset>

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
            {outcome.held || outcome.reread === null
              ? `Saved (version ${outcome.version}); in force in this tab now.`
              : `Saved (version ${outcome.version}). The active project changed while it was saving, so this page shows the project selected now: ${movedRereadText(outcome.reread)}`}
          </span>
        )}
      </div>

      {outcome?.kind === "conflict" && (
        <Notice testId="presentation-scope-conflict">
          The stored scope changed after this edit began — another admin saved,
          or an earlier attempt of this save landed.{" "}
          {conflictRereadText(outcome.reread)}
        </Notice>
      )}
      {outcome?.kind === "refused" && (
        <Notice testId="presentation-scope-refused">{outcome.message}</Notice>
      )}
      {outcome?.kind === "unknown" && (
        <Notice testId="presentation-scope-outcome-unknown">
          {outcome.message} It may or may not have been stored
          {unknownRereadText(outcome.reread)} Your edit is kept below.
        </Notice>
      )}
    </form>
  );
}

/** What the re-read after a save to a project no longer selected observed. */
function movedRereadText(reread: RereadState): string {
  switch (reread.status) {
    case "pending":
      return "its scope is being read.";
    case "read":
      return "its scope, read after the save.";
    case "failed":
      return `reading its scope failed (${reread.failure}), so what it stores is UNKNOWN here.`;
    case "superseded":
      return "reading its scope was interrupted by another change of project, so what it stores is UNKNOWN here until it is read.";
  }
}

/** What the re-read after a refused compare-and-set observed. */
function conflictRereadText(reread: RereadState): string {
  switch (reread.status) {
    case "pending":
      return "What is stored now is being read; your edit is kept below.";
    case "read":
      return "The lists above are what is stored now, read after this save; your edit is kept below — check it against them and save again.";
    case "failed":
      return `Reading what is stored now failed (${reread.failure}), so it is UNKNOWN: the lists above are from before this save. Your edit is kept below — refresh before saving again.`;
    case "superseded":
      return "Reading what is stored now was interrupted by a change of project, so it is UNKNOWN. Your edit is kept below — refresh before saving again.";
  }
}

/** What the re-read after a save whose outcome is unknown observed (continues a sentence). */
function unknownRereadText(reread: RereadState): string {
  switch (reread.status) {
    case "pending":
      return "; what is stored is being read.";
    case "read":
      return ": the lists above were read after the save failed, so check them before saving again.";
    case "failed":
      return `, and reading the scope again failed too (${reread.failure}), so what is stored is UNKNOWN: the lists above are from before the save.`;
    case "superseded":
      return ", and reading the scope again was interrupted by a change of project, so what is stored is UNKNOWN.";
  }
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
