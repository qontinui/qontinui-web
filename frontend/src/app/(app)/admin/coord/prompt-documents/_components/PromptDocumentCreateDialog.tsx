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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type {
  PromptDocument,
  PromptDocumentCreate,
  PromptDocumentKind,
} from "../types";
import {
  KIND_META,
  PROMPT_DOCUMENT_KINDS,
  SESSION_BRIEFING_DOCUMENT_NAMES,
} from "../types";
import { validateBodyForKind } from "../_lib/sessionBriefingBody";

interface PromptDocumentCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onCreate: (
    kind: PromptDocumentKind,
    data: PromptDocumentCreate
  ) => Promise<PromptDocument | null>;
  /** Called with the created document so the caller can open it for editing. */
  onCreated: (doc: PromptDocument) => void;
}

/** Local kebab-case check mirroring coord's `is_kebab_case` — same contract, so
 * the form can disable submit and explain before the round-trip. */
function isKebabCase(s: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

/**
 * Create a brand-new hand-authored prompt document. Distinct from the editor
 * dialog: the address `(kind, name)` is chosen here (and immutable afterward),
 * so this is the only surface where a document's kind + slug are set.
 *
 * Honesty about the address: `name` becomes the permanent `{{policy:<name>}}`
 * (or bare-slug) handle, so the form validates kebab-case up front and previews
 * the resulting handle rather than letting coord's 400 be the first feedback.
 */
export function PromptDocumentCreateDialog({
  open,
  onOpenChange,
  saving,
  onCreate,
  onCreated,
}: PromptDocumentCreateDialogProps) {
  const [kind, setKind] = useState<PromptDocumentKind>("policy");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind("policy");
    setName("");
    setDescription("");
    setBody("");
  }, [open]);

  const nameValid = name.length === 0 || isKebabCase(name);

  /**
   * Coord content-checks a `session_briefing` body on the CREATE door too
   * (`post_create` calls the same `validate_body_for_kind` as `patch_one`), so
   * the form checks it here for the same reason the editor does — a 400 that
   * arrives after the body is typed is the worst place to learn a content rule.
   */
  const bodyError = body.length > 0 ? validateBodyForKind(kind, body) : null;

  /**
   * A `session_briefing` row under a name the runner does not resolve is
   * legal, and it is a trap worth naming rather than blocking.
   *
   * Coord accepts it, so refusing here would be this form inventing a rule.
   * But the row is INERT — the runner fetches its three names by constant and
   * never lists the kind — and, because coord's `AGENT_UNWRITABLE_DOCUMENTS`
   * is a list of `(kind, name)` pairs rather than a kind-wide deny, it is also
   * **agent-writable by default**. Inert and agent-writable is a coherent pair
   * (nothing reads it, so nothing is at stake), but an operator who believes
   * they are authoring the fleet's system prompt has got neither of the two
   * properties they think they have. The address is permanent, so this is the
   * only moment to say so.
   */
  const inertBriefingName =
    kind === "session_briefing" &&
    name.trim().length > 0 &&
    isKebabCase(name.trim()) &&
    !SESSION_BRIEFING_DOCUMENT_NAMES.includes(name.trim());

  const canSubmit =
    !saving &&
    name.trim().length > 0 &&
    isKebabCase(name.trim()) &&
    body.trim().length > 0 &&
    bodyError === null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const data: PromptDocumentCreate = {
      name: name.trim(),
      body,
    };
    if (description.trim().length > 0) data.description = description.trim();
    const created = await onCreate(kind, data);
    if (created) {
      onOpenChange(false);
      onCreated(created);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        data-testid="prompt-document-create"
      >
        <DialogHeader>
          <DialogTitle>New prompt document</DialogTitle>
          <DialogDescription>
            Create a hand-authored document coord serves your fleet. Its kind and
            name form its permanent address — pick them carefully; the body is
            editable and versioned afterward.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as PromptDocumentKind)}
              >
                <SelectTrigger id="create-kind" data-testid="create-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_DOCUMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_META[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {KIND_META[kind].description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-name">Name (slug)</Label>
              <Input
                id="create-name"
                data-testid="create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-new-document"
                aria-invalid={!nameValid}
              />
              {name.trim().length > 0 && !nameValid ? (
                <p className="text-xs text-destructive">
                  Must be kebab-case: lowercase letters, digits, and single
                  dashes (no leading, trailing, or double dash).
                </p>
              ) : inertBriefingName ? (
                <p
                  className="text-xs text-amber-700 dark:text-amber-400"
                  data-testid="create-inert-briefing"
                >
                  The runner resolves only{" "}
                  {SESSION_BRIEFING_DOCUMENT_NAMES.join(", ")} — it fetches
                  those three by name and never lists this kind. A row under any
                  other name is stored and versioned but never injected into a
                  prompt, and coord&apos;s built-in write protection covers those
                  three names specifically, so this row would also be
                  agent-writable by default. The address is permanent.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {kind === "policy" && isKebabCase(name.trim())
                    ? `Referenced as {{policy:${name.trim()}}}.`
                    : "Lowercase kebab-case; permanent once created."}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-description">Description</Label>
            <Input
              id="create-description"
              data-testid="create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this document is for"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-body">Body</Label>
            <Textarea
              id="create-body"
              data-testid="create-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="font-mono text-xs"
              placeholder="Markdown prose — served verbatim to the fleet."
              aria-invalid={bodyError !== null}
              aria-describedby={
                bodyError !== null ? "create-body-error" : undefined
              }
            />
            {bodyError !== null ? (
              <p
                id="create-body-error"
                className="text-xs text-destructive"
                data-testid="create-body-error"
              >
                {bodyError}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Saved as version 1. Every later edit is a new version — nothing is
              overwritten.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="create-submit"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Create document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
