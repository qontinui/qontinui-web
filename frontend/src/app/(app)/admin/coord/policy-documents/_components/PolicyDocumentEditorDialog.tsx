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
import { Loader2 } from "lucide-react";
import type { PolicyDocument, PolicyDocumentUpdate } from "../types";

interface PolicyDocumentEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document being edited (dialog is edit-only; documents are coord-seeded). */
  document: PolicyDocument | null;
  saving: boolean;
  onUpdate: (handle: string, data: PolicyDocumentUpdate) => Promise<boolean>;
  onRestore: (handle: string) => Promise<boolean>;
}

/**
 * Edit one policy document's title + body. Documents are coord-seeded (never
 * created here), so the dialog is edit-only. A Restore-to-default control is
 * shown when the document carries a `default_source`.
 */
export function PolicyDocumentEditorDialog({
  open,
  onOpenChange,
  document,
  saving,
  onUpdate,
  onRestore,
}: PolicyDocumentEditorDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open || !document) return;
    setTitle(document.title);
    setBody(document.body);
  }, [open, document]);

  if (!document) return null;

  const dirty = title !== document.title || body !== document.body;
  const canSubmit =
    !saving && dirty && title.trim().length > 0 && body.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const patch: PolicyDocumentUpdate = {};
    if (title !== document.title) patch.title = title;
    if (body !== document.body) patch.body = body;
    const ok = await onUpdate(document.handle, patch);
    if (ok) onOpenChange(false);
  };

  const handleRestore = async () => {
    if (
      !window.confirm(
        `Restore "${document.title}" to its built-in default? Your current ` +
          "wording will be replaced by the shipped default."
      )
    ) {
      return;
    }
    const ok = await onRestore(document.handle);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit policy document</DialogTitle>
          <DialogDescription>
            Referenced by the meta-answer template as{" "}
            <code>{`{{policy:${document.handle}}}`}</code>. Format:{" "}
            {document.format}. Tenant-scoped; served to the fleet by coord.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
                ? "Markdown prose — inlined into the meta-answer when composed."
                : "Prose — inlined into the meta-answer when composed."}
            </p>
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
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
