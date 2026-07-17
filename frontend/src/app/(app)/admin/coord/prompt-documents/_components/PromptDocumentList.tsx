"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, History, NotebookText, Pencil } from "lucide-react";
import { usePromptDocuments } from "../_hooks/usePromptDocuments";
import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import { PromptDocumentHistoryDialog } from "./PromptDocumentHistoryDialog";
import type { PromptDocument, PromptDocumentSummary } from "../types";
import { KIND_META, PROMPT_DOCUMENT_KINDS } from "../types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The prompt-document list, grouped by kind, with the edit + history dialogs.
 *
 * Discoverability without clutter: all four kinds are on one page under their
 * own headings — the operator sees the whole surface at a glance — while bodies
 * (the bulk) stay behind the editor, and the diff stays behind the history view.
 * A kind with no documents is omitted rather than shown as an empty shell.
 */
export function PromptDocumentList() {
  const {
    documents,
    loading,
    saving,
    error,
    degraded,
    fetchDocument,
    fetchVersions,
    fetchVersion,
    updateDocument,
    restoreDefault,
  } = usePromptDocuments();

  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

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

  if (loading && documents.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            Coord reports its prompt-document store isn&apos;t provisioned yet
            ({degraded}). This list is empty because the documents can&apos;t be
            read — not because none exist.
          </p>
        </div>
      )}

      {documents.length === 0 && !degraded && !error ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No prompt documents yet.
          </p>
        </div>
      ) : (
        PROMPT_DOCUMENT_KINDS.map((kind) => {
          const group = documents.filter((d) => d.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} data-testid={`kind-group-${kind}`}>
              <div className="mb-2">
                <h2 className="text-sm font-semibold">
                  {KIND_META[kind].label}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {KIND_META[kind].description}
                </p>
              </div>
              <div className="space-y-2">
                {group.map((doc) => (
                  <DocumentRow
                    key={`${doc.kind}/${doc.name}`}
                    doc={doc}
                    onEdit={() => openEdit(doc)}
                    onHistory={() => openHistory(doc)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

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
        target={
          editing
            ? {
                kind: editing.kind,
                name: editing.name,
                label: editing.description ?? editing.name,
              }
            : null
        }
        currentBody={editing?.body ?? ""}
        currentVersion={editing?.current_version ?? 0}
        fetchVersions={fetchVersions}
        fetchVersion={fetchVersion}
      />
    </div>
  );
}

interface DocumentRowProps {
  doc: PromptDocumentSummary;
  onEdit: () => void;
  onHistory: () => void;
}

function DocumentRow({ doc, onEdit, onHistory }: DocumentRowProps) {
  // A document with a `default_source` has a shipped default the editor can
  // restore; one without is hand-authored with nothing to fall back to.
  const restorable = doc.default_source != null;
  return (
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
        </div>
        <p className="truncate text-xs text-muted-foreground">
          v{doc.current_version} · edited by {doc.updated_by ?? "unknown"} ·{" "}
          {formatWhen(doc.updated_at)}
        </p>
      </div>

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
