"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { History, Loader2 } from "lucide-react";
import type {
  PromptDocument,
  PromptDocumentKind,
  PromptDocumentUpdate,
} from "../types";
import { KIND_META } from "../types";

interface PromptDocumentEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document being edited, body included. `null` while it loads. */
  document: PromptDocument | null;
  /** True while the body fetch is in flight (the list carries no bodies). */
  loadingBody: boolean;
  saving: boolean;
  onUpdate: (
    kind: PromptDocumentKind,
    name: string,
    data: PromptDocumentUpdate
  ) => Promise<boolean>;
  onRestore: (kind: PromptDocumentKind, name: string) => Promise<boolean>;
  /** Open the version-history view for this document. */
  onShowHistory: () => void;
}

/**
 * Edit one prompt document's description + body. Documents are coord-seeded and
 * addressed by `(kind, name)`, so the dialog is edit-only — never create, and
 * the address is immutable.
 *
 * Predictability: saving does not overwrite anything. Coord snapshots the
 * current body as an immutable version and writes the edit as the next one, so
 * the dialog states the version the save will produce and links the history.
 * Restore-to-default is offered when the document carries a `default_source`,
 * and is itself a versioned edit — reversible from the history view.
 */
export function PromptDocumentEditorDialog({
  open,
  onOpenChange,
  document,
  loadingBody,
  saving,
  onUpdate,
  onRestore,
  onShowHistory,
}: PromptDocumentEditorDialogProps) {
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [changeNote, setChangeNote] = useState("");

  useEffect(() => {
    if (!open || !document) return;
    setDescription(document.description ?? "");
    setBody(document.body);
    setChangeNote("");
  }, [open, document]);

  const dirty =
    document !== null &&
    (description !== (document.description ?? "") || body !== document.body);
  const canSubmit = !saving && !loadingBody && dirty && body.trim().length > 0;

  const handleSubmit = async () => {
    if (!document || !canSubmit) return;
    const patch: PromptDocumentUpdate = {};
    if (description !== (document.description ?? "")) {
      patch.description = description;
    }
    if (body !== document.body) patch.body = body;
    if (changeNote.trim().length > 0) patch.change_description = changeNote.trim();
    const ok = await onUpdate(document.kind, document.name, patch);
    if (ok) onOpenChange(false);
  };

  const handleRestore = async () => {
    if (!document) return;
    if (
      !window.confirm(
        `Restore "${document.description ?? document.name}" to its built-in ` +
          "default? Your current wording is replaced by the shipped default — " +
          "saved as a new version, so you can read or copy back the current " +
          "wording from the history afterwards."
      )
    ) {
      return;
    }
    const ok = await onRestore(document.kind, document.name);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        data-testid="prompt-document-editor"
      >
        <DialogHeader>
          <DialogTitle>
            Edit {document ? KIND_META[document.kind].label.toLowerCase() : ""}{" "}
            document
          </DialogTitle>
          <DialogDescription>
            {document ? (
              <>
                <code>
                  {document.kind}/{document.name}
                </code>
                {document.kind === "policy" ? (
                  <>
                    {" "}
                    — referenced by the meta-answer template as{" "}
                    <code>{`{{policy:${document.name}}}`}</code>.
                  </>
                ) : null}{" "}
                Format: {document.format}. Tenant-scoped; served to the fleet by
                coord.
              </>
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>

        {loadingBody || !document ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading document…
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="doc-description">Description</Label>
                <Input
                  id="doc-description"
                  data-testid="doc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this document is for"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-body">Body</Label>
                <Textarea
                  id="doc-body"
                  data-testid="doc-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={18}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {document.format === "markdown"
                    ? "Markdown prose — served verbatim to the fleet."
                    : "Prose — served verbatim to the fleet."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-change-note">Change note (optional)</Label>
                <Input
                  id="doc-change-note"
                  data-testid="doc-change-note"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Why this edit — recorded on the version"
                />
              </div>

              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Saving creates{" "}
                  <span className="font-medium text-foreground">
                    version {document.current_version + 1}
                  </span>
                  . Version {document.current_version} is kept and stays
                  restorable — nothing is overwritten.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={onShowHistory}
                  data-testid="doc-show-history"
                >
                  <History className="size-3.5" />
                  History
                </Button>
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              {document.default_source != null ? (
                <Button
                  variant="outline"
                  onClick={handleRestore}
                  disabled={saving}
                  data-testid="doc-restore-default"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Restore to default
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  data-testid="doc-save"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Save as v{document.current_version + 1}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
