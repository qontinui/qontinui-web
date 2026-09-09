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
import {
  SESSION_BRIEFING_MAX_BYTES,
  sessionBriefingByteLength,
  validateBodyForKind,
} from "../_lib/sessionBriefingBody";
import { PromptDocumentClaims } from "./PromptDocumentClaims";

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
 *
 * One kind tightens this in two ways, and both are mirrored so the operator
 * learns them from the form rather than from a rejected save. A
 * `session_briefing` PATCH is refused by coord without a non-empty change note,
 * so for that kind the note is a required field; and its BODY must satisfy
 * coord's content rules (size ceiling, closed placeholder vocabulary, no forged
 * source marker, no operator-door link, no identity), so a violating body names
 * itself under the textarea and holds Save disabled. See
 * `../_lib/sessionBriefingBody`.
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

  const bodyDirty = document !== null && body !== document.body;
  const dirty =
    document !== null &&
    (description !== (document.description ?? "") || bodyDirty);

  /**
   * `session_briefing` is the one kind whose PATCH coord REJECTS without a
   * change note (400, `change_description` must be non-empty).
   *
   * The rule is coord's, not this dialog's: this text becomes the system prompt
   * of every session the tenant's runners host, and the version log with
   * `edited_by` is the whole mitigation for that — an unattributed edit leaves
   * it unable to answer "why did every session change behaviour on Tuesday".
   * Mirrored here so the operator learns the requirement from a disabled button
   * and a labelled field BEFORE submitting, rather than from a rejected save.
   *
   * Deliberately NOT global: every other kind keeps the optional note.
   */
  const changeNoteRequired = document?.kind === "session_briefing";
  const changeNoteMissing =
    changeNoteRequired && changeNote.trim().length === 0;

  /**
   * Coord's per-kind CONTENT rules, mirrored so a violation is answered in the
   * form rather than by a 400 after the operator has typed the edit — the same
   * reason the change note above is a labelled required field.
   *
   * Gated on `bodyDirty`, mirroring coord's `patch_one`, which runs
   * `validate_body_for_kind` only `if let Some(ref body) = req.body`. A
   * description-only edit therefore sends no body and is not content-checked,
   * and blocking one here would refuse a save coord would have accepted —
   * which matters precisely for a stored body that predates a tightened rule.
   */
  const bodyError =
    document !== null && bodyDirty
      ? validateBodyForKind(document.kind, body)
      : null;

  /** Computed once per render rather than three times inside the budget line. */
  const bodyBytes =
    document?.kind === "session_briefing"
      ? sessionBriefingByteLength(body)
      : 0;

  const canSubmit =
    !saving &&
    !loadingBody &&
    dirty &&
    body.trim().length > 0 &&
    !changeNoteMissing &&
    bodyError === null;

  const handleSubmit = async () => {
    if (!document || !canSubmit) return;
    const patch: PromptDocumentUpdate = {};
    if (description !== (document.description ?? "")) {
      patch.description = description;
    }
    if (body !== document.body) patch.body = body;
    // Safe as an unconditional guard: `canSubmit` already blocks submit while a
    // REQUIRED note is blank, so the only path that reaches here with an empty
    // note is a kind where coord treats it as optional.
    if (changeNote.trim().length > 0) patch.change_description = changeNote.trim();
    const ok = await onUpdate(document.kind, document.name, patch);
    if (ok) onOpenChange(false);
  };

  /**
   * Restore-to-default needs no change note even for `session_briefing`: it is a
   * POST to coord's `restore-default` route, not a PATCH, and coord stamps the
   * snapshot's note itself. Same for the history view's version restore
   * ("Restored from version N"). Only the PATCH door takes the note from the
   * operator, so only the PATCH door gates on it here.
   */
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
                ) : null}
                {document.kind === "session_briefing" ? (
                  <>
                    {" "}
                    — appended to the system prompt of every session the runner
                    hosts. Edits reach sessions spawned after the next runner
                    poll (up to 45 seconds); sessions already running keep the
                    prompt they started with.
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
                  aria-invalid={bodyError !== null}
                  aria-describedby={
                    bodyError !== null ? "doc-body-error" : undefined
                  }
                />
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {document.format === "markdown"
                      ? "Markdown prose — served verbatim to the fleet."
                      : "Prose — served verbatim to the fleet."}
                  </p>
                  {/*
                    The budget is shown only for the kind that HAS one, and it
                    counts UTF-8 bytes because that is what coord measures. A
                    character count would read comfortably under the cap on
                    exactly the em-dash-heavy prose most likely to exceed it.
                  */}
                  {document.kind === "session_briefing" ? (
                    <p
                      className={`shrink-0 text-xs tabular-nums ${
                        bodyBytes > SESSION_BRIEFING_MAX_BYTES
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      }`}
                      data-testid="doc-body-budget"
                    >
                      {bodyBytes.toLocaleString()} /{" "}
                      {SESSION_BRIEFING_MAX_BYTES.toLocaleString()} bytes
                    </p>
                  ) : null}
                </div>
                {/*
                  Coord refuses this body. Named here, next to the field, rather
                  than surfaced as a toast after a failed round-trip — the
                  operator has to be able to see which token is the problem
                  while looking at the text that contains it.
                */}
                {bodyError !== null ? (
                  <p
                    id="doc-body-error"
                    className="text-xs text-destructive"
                    data-testid="doc-body-error"
                  >
                    {bodyError}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="doc-change-note">
                  Change note {changeNoteRequired ? "(required)" : "(optional)"}
                </Label>
                <Input
                  id="doc-change-note"
                  data-testid="doc-change-note"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Why this edit — recorded on the version"
                  aria-required={changeNoteRequired}
                />
                {changeNoteRequired ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="doc-change-note-required"
                  >
                    Required for this document: the edit changes the system
                    prompt of every session spawned from now on, and the note is
                    what makes it attributable in the version history.
                  </p>
                ) : null}
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

              {/*
                The per-claim probe state coord serves beside the document.
                Read-only and SERVED: it reflects the body coord last read, not
                the textarea above — an unsaved edit that adds a probe block
                shows up here only after the save and the next observer tick.
              */}
              <PromptDocumentClaims document={document} />
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
