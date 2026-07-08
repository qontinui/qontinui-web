"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotebookText, Pencil } from "lucide-react";
import { usePolicyDocuments } from "../_hooks/usePolicyDocuments";
import { PolicyDocumentEditorDialog } from "./PolicyDocumentEditorDialog";
import type { PolicyDocument } from "../types";

/** First line of the body, trimmed to a one-line preview. */
function bodyPreview(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim();
}

export function PolicyDocumentList() {
  const { documents, loading, saving, updateDocument, restoreDefault } =
    usePolicyDocuments();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PolicyDocument | null>(null);

  const openEdit = (doc: PolicyDocument) => {
    setEditing(doc);
    setEditorOpen(true);
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No policy documents yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.handle}
              doc={doc}
              onEdit={() => openEdit(doc)}
            />
          ))}
        </div>
      )}

      <PolicyDocumentEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        document={editing}
        saving={saving}
        onUpdate={updateDocument}
        onRestore={restoreDefault}
      />
    </div>
  );
}

interface DocumentRowProps {
  doc: PolicyDocument;
  onEdit: () => void;
}

function DocumentRow({ doc, onEdit }: DocumentRowProps) {
  // A document with a `default_source` is either on its shipped default or has
  // been edited away from it. Coord doesn't expose per-row dirtiness, so we badge
  // "Customizable" (restorable) vs "Custom" (no default to restore to).
  const onDefault = doc.default_source != null;
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
      <NotebookText
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.title}</span>
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {`{{policy:${doc.handle}}}`}
          </code>
          <span
            className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            title={
              onDefault
                ? "Has a built-in default — the editor can restore it."
                : "Hand-authored — no built-in default to restore to."
            }
          >
            {onDefault ? "Restorable" : "Custom"}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {bodyPreview(doc.body)}
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title="Edit document"
      >
        <Pencil className="size-4" />
      </Button>
    </div>
  );
}
