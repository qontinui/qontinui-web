"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  History,
  ListTree,
  NotebookText,
  Pencil,
  Plus,
} from "lucide-react";
import { usePromptDocuments } from "../_hooks/usePromptDocuments";
import { PromptDocumentCreateDialog } from "./PromptDocumentCreateDialog";
import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import { PromptDocumentHistoryDialog } from "./PromptDocumentHistoryDialog";
import { ClauseManagerDialog } from "./ClauseManagerDialog";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import type {
  PromptDocument,
  PromptDocumentKind,
  PromptDocumentSummary,
} from "../types";
import {
  BAND_META,
  isInertSessionBriefing,
  KIND_META,
  kindsInBand,
  PROMPT_DOCUMENT_BANDS,
  SESSION_BRIEFING_DOCUMENT_NAMES,
} from "../types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The prompt-document list, grouped by kind under two bands, with the edit +
 * history dialogs.
 *
 * Discoverability without clutter: all thirteen kinds are on one page under
 * their own headings — the operator sees the whole surface at a glance — while
 * bodies (the bulk) stay behind the editor, and the diff stays behind the
 * history view. A kind with no documents is omitted rather than shown as an
 * empty shell.
 *
 * **The BAND is not omitted, and that asymmetry is the point.** Thirteen kind
 * groups in one flat run made the reader re-derive, per group, which question
 * that kind answers, so the groups sit under `Behavior` ("how a session must
 * act") and `Intent` ("what we are building, for whom, and what 'better'
 * means") — `PROMPT_DOCUMENT_BANDS` / `KIND_BAND` in `../types`. A band with no
 * documents still renders, carrying its own "nothing here yet" line: an ABSENT
 * Intent band reads as "this product has no intent layer", which is the
 * silent-empty-is-unknown failure applied to a heading. The one case where the
 * line is withheld is the one where emptiness genuinely is not known — coord
 * unreachable, or its store unprovisioned — and the notices above say so
 * instead.
 *
 * Bands are presentational only: nothing filters by band, no route addresses
 * one, and the create dialog offers every kind regardless.
 */
export function PromptDocumentList() {
  const {
    documents,
    loading,
    saving,
    error,
    degraded,
    reload,
    fetchDocument,
    fetchVersions,
    fetchVersion,
    createDocument,
    updateDocument,
    restoreDefault,
    restoreVersion,
  } = usePromptDocuments();

  const [createOpen, setCreateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clausesOpen, setClausesOpen] = useState(false);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

  /** Open the freshly-created document straight into the editor. */
  const openCreated = (doc: PromptDocument) => {
    setEditing(doc);
    setLoadingBody(false);
    setEditorOpen(true);
  };

  /** The list carries no bodies — fetch the full document before editing. */
  const loadFull = async (
    doc: PromptDocumentSummary
  ): Promise<PromptDocument | null> => {
    setEditing(null);
    setLoadingBody(true);
    const full = await fetchDocument(doc.kind, doc.name);
    setEditing(full);
    setLoadingBody(false);
    return full;
  };

  const openEdit = async (doc: PromptDocumentSummary) => {
    setEditorOpen(true);
    await loadFull(doc);
  };

  const openHistory = async (doc: PromptDocumentSummary) => {
    setHistoryOpen(true);
    await loadFull(doc);
  };

  const openClauses = async (doc: PromptDocumentSummary) => {
    setClausesOpen(true);
    await loadFull(doc);
  };

  /**
   * Roll the open document back to `version`, then re-read it so the history
   * dialog's diff immediately describes the NEW current version rather than the
   * one that was current a moment ago.
   */
  const handleRestoreVersion = async (
    kind: PromptDocumentKind,
    name: string,
    version: number,
    changeNote: string
  ): Promise<boolean> => {
    const ok = await restoreVersion(kind, name, version, changeNote);
    if (ok) {
      const full = await fetchDocument(kind, name);
      if (full) setEditing(full);
    }
    return ok;
  };

  /**
   * Memoized so the history dialog's load effect (which has `target` in its
   * dependency list) fires on a genuine document change instead of on every
   * render of this list — an inline object literal is a new reference each
   * time. Without this, any re-render of this list (the `saving` flag toggling
   * during a restore, for instance) refetched the version list and reset the
   * dialog's selected version out from under the operator.
   */
  const historyTarget = useMemo(
    () =>
      editing
        ? {
            kind: editing.kind,
            name: editing.name,
            label: editing.description ?? editing.name,
            // Whether a restore-to-default exists for this document — the
            // history dialog names it as the way out of a snapshot today's
            // content rules refuse, and must not name it when there is none.
            hasDefault: editing.default_source != null,
          }
        : null,
    [editing]
  );

  const initialLoading = loading && documents.length === 0;

  /**
   * Whether "this band holds nothing" is a FACT we may state.
   *
   * A band renders its own empty line so an unauthored Intent layer reads as
   * "nobody has written one yet" rather than as a layer this product does not
   * have. That line is only honest when coord actually answered: a transport
   * failure (`error`) or an unprovisioned store (`degraded`) makes the corpus
   * UNKNOWN, and the notices above already say which. In those states the
   * bands render nothing rather than asserting emptiness on no evidence.
   */
  const canAssertEmpty = !initialLoading && !degraded && !error;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setCreateOpen(true)}
          data-testid="new-document"
        >
          <Plus className="size-4" />
          New document
        </Button>
      </div>

      {initialLoading && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading documents…
        </div>
      )}

      {/* Coord refused or is unreachable: we know nothing, and say so. */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
          data-testid="prompt-documents-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Couldn&apos;t reach coord: {error}.{" "}
            {documents.length > 0
              ? "Showing the last documents loaded — they may be out of date."
              : "No documents could be loaded."}
          </p>
        </div>
      )}

      {/* Coord answered, but its store isn't provisioned yet (deploy window). */}
      {degraded && (
        <div
          className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
          data-testid="prompt-documents-degraded"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Coord reports its prompt-document store isn&apos;t provisioned yet (
            {degraded}). This list is empty because the documents can&apos;t be
            read — not because none exist.
          </p>
        </div>
      )}

      {(documents.length > 0 || canAssertEmpty) &&
        PROMPT_DOCUMENT_BANDS.map((band) => {
          // Authority order is `PROMPT_DOCUMENT_KINDS`', preserved within the
          // band — the band regroups the list, it does not re-rank it.
          const populated = kindsInBand(band).filter((kind) =>
            documents.some((d) => d.kind === kind)
          );
          return (
            <section
              key={band}
              className="space-y-4"
              data-testid={`kind-band-${band}`}
            >
              <div className="border-b border-border pb-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide">
                  {BAND_META[band].label}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {BAND_META[band].question}
                </p>
              </div>

              {populated.length === 0 ? (
                // `canAssertEmpty` is re-checked HERE, not just on the outer
                // gate. The outer gate passes on `documents.length > 0` alone,
                // and a failed refetch KEEPS the last-good list on screen
                // (`usePromptDocuments`, deliberately) — so a stale list with
                // an error banner would otherwise reach this branch and state
                // "nobody has authored one" on no evidence. Emptiness is a fact
                // only when coord actually answered; otherwise render nothing
                // and let the banner above say the view is stale.
                canAssertEmpty ? (
                  <p
                    className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground"
                    data-testid={`kind-band-empty-${band}`}
                  >
                    No {BAND_META[band].label.toLowerCase()} documents yet —
                    nothing here says {BAND_META[band].question}.
                  </p>
                ) : null
              ) : (
                populated.map((kind) => {
                  const group = documents.filter((d) => d.kind === kind);
                  return (
                    <section key={kind} data-testid={`kind-group-${kind}`}>
                      <div className="mb-2">
                        <h3 className="text-sm font-semibold">
                          {KIND_META[kind].label}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {KIND_META[kind].description}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {group.map((doc) => (
                          <DocumentRow
                            key={`${doc.kind}/${doc.name}`}
                            doc={doc}
                            saving={saving}
                            onEdit={() => openEdit(doc)}
                            onHistory={() => openHistory(doc)}
                            onSetAgentWritable={(next) =>
                              updateDocument(doc.kind, doc.name, {
                                agent_writable: next,
                                change_description: next
                                  ? "Opened to agent writes by an operator"
                                  : "Protected from agent writes by an operator",
                              })
                            }
                            onClauses={
                              doc.kind === "policy"
                                ? () => openClauses(doc)
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </section>
          );
        })}

      <PromptDocumentCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={saving}
        onCreate={createDocument}
        onCreated={openCreated}
      />

      <PromptDocumentEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        document={editing}
        loadingBody={loadingBody}
        saving={saving}
        onUpdate={updateDocument}
        onRestore={restoreDefault}
        onShowHistory={() => {
          setEditorOpen(false);
          setHistoryOpen(true);
        }}
      />

      <PromptDocumentHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        target={historyTarget}
        currentBody={editing?.body ?? ""}
        currentVersion={editing?.current_version ?? 0}
        fetchVersions={fetchVersions}
        fetchVersion={fetchVersion}
        saving={saving}
        onRestoreVersion={handleRestoreVersion}
      />

      <ClauseManagerDialog
        open={clausesOpen}
        onOpenChange={setClausesOpen}
        document={editing?.kind === "policy" ? editing : null}
        loadingBody={loadingBody}
        onDocsReload={reload}
      />
    </div>
  );
}

interface DocumentRowProps {
  doc: PromptDocumentSummary;
  /** True while any document write is in flight — disables the access toggle. */
  saving: boolean;
  onEdit: () => void;
  onHistory: () => void;
  /** Set this document's per-document agent write access. */
  onSetAgentWritable: (next: boolean) => Promise<boolean>;
  /** Only set for `policy` documents — opens the structured clause manager. */
  onClauses?: () => void;
}

function DocumentRow({
  doc,
  saving,
  onEdit,
  onHistory,
  onSetAgentWritable,
  onClauses,
}: DocumentRowProps) {
  // A document with a `default_source` has a shipped default the editor can
  // restore; one without is hand-authored with nothing to fall back to.
  const restorable = doc.default_source != null;
  /**
   * A `session_briefing` row under a name the runner does not resolve.
   *
   * The create dialog warns about this at authoring time, which covers exactly
   * one of the ways such a row appears. It does not cover a row seeded before
   * that warning existed, nor one an agent created through
   * `coord_write_prompt_document` — and that second case is not hypothetical:
   * coord's `AGENT_UNWRITABLE_DOCUMENTS` lists the three canonical
   * `(kind, name)` PAIRS, so every other briefing name is agent-writable by
   * default. For those rows this list is the only place an operator ever meets
   * them, and until now it rendered them identically to the three live ones,
   * under a heading that says this kind becomes the fleet's system prompt.
   *
   * Flagged rather than hidden: the row is legal, coord stores and versions it,
   * and hiding it would be worse — an operator would lose the one view that
   * shows it exists. Only the exception is marked, so the common case (the
   * three live briefings) stays uncluttered.
   */
  const inertBriefing = isInertSessionBriefing(doc.kind, doc.name);
  return (
    /*
     * Known debt, disclosed rather than migrated — see the identical note on
     * `automation-rules/_components/RuleList.tsx`. `/prompt-documents` is one
     * of the four form/dialog routes plan
     * `2026-08-16-coord-console-ui-unification-pipeline-style` took at R9 only
     * (#1064), and that plan states no sixth wave is owed. Adopting
     * `<RecordRow>` here is its call to make.
     */
    // eslint-disable-next-line @qontinui-web/no-handrolled-record-row -- see above: R9-only by plan decision, migration is a separate wave
    <div
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3"
      data-testid={`doc-row-${doc.kind}-${doc.name}`}
    >
      <NotebookText
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {doc.description ?? doc.name}
          </span>
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {doc.kind === "policy" ? `{{policy:${doc.name}}}` : doc.name}
          </code>
          <span
            className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            title={
              restorable
                ? "Has a built-in default — the editor can restore it."
                : "Hand-authored — no built-in default to restore to."
            }
          >
            {restorable ? "Restorable" : "Custom"}
          </span>
          {inertBriefing && (
            <span
              className="inline-flex shrink-0 items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
              title={`Never injected into a prompt: the runner fetches only ${SESSION_BRIEFING_DOCUMENT_NAMES.join(
                ", "
              )} by name and never lists this kind. Coord's built-in write protection covers those three names specifically, so this row is also agent-writable unless an operator protects it.`}
              data-testid={`doc-inert-${doc.kind}-${doc.name}`}
            >
              Inert
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          v{doc.current_version} · edited by {doc.updated_by ?? "unknown"} ·{" "}
          {formatWhen(doc.updated_at)}
        </p>
      </div>

      <AgentWriteAccessControl
        doc={doc}
        saving={saving}
        onSet={onSetAgentWritable}
      />

      {onClauses && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onClauses}
          title="Structured clauses"
          data-testid={`doc-clauses-${doc.kind}-${doc.name}`}
        >
          <ListTree className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onHistory}
        title="Version history"
        data-testid={`doc-history-${doc.kind}-${doc.name}`}
      >
        <History className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title="Edit document"
        data-testid={`doc-edit-${doc.kind}-${doc.name}`}
      >
        <Pencil className="size-4" />
      </Button>
    </div>
  );
}
