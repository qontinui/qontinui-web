"use client";

/**
 * Click-to-edit for one block of markdown on an overview page.
 *
 * Plan `2026-09-20-overview-authoring-layer` §3, with its open question 2
 * answered as the plan defaulted it: an explicit **Save**, never autosave —
 * these pages are shared, and a half-written paragraph appearing in front of
 * someone else reading it is worse than a button. What the writer gets
 * instead of autosave:
 *
 * - a **draft kept on this device** (per record and per viewer) while they
 *   type, restored if the tab closes, and said so on screen;
 * - a **guard on leaving** with unsaved text (closing the tab, or following a
 *   link inside the app);
 * - on a **conflict**, both versions side by side and a choice — never a
 *   silent overwrite in either direction.
 *
 * The component renders nothing editable unless `canEdit` — the served
 * permission for the project on screen. Controls are absent, not disabled.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { formatRelativeTime } from "@/lib/time-utils";
import { ConflictDialog } from "./ConflictDialog";
import type { WikiLinkOptions } from "@/components/overview/wiki-links";
import { MarkdownEditor } from "./MarkdownEditor";
import { clearDraft, draftKey, readDraft, writeDraft } from "./drafts";
import { useFocusAfterRender } from "./focus";
import type { SaveResult } from "./useResource";

/** The slice of a record this component edits and reports on. */
export interface EditableText {
  text: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

type Mode =
  | { kind: "view" }
  | {
      kind: "edit";
      text: string;
      baseVersion: number;
      /** The record's text at `baseVersion`, when the editor opened on the
       *  record itself; null for a restored draft, whose base is older. */
      baseText: string | null;
      restoredFrom: string | null;
      /** Their text, shown beside the editor after "Combine them myself". */
      theirs: EditableText | null;
    };

/**
 * Warn before the page is left with unsaved text: the browser's own prompt on
 * close/reload, and a confirm on an in-app link, which the browser does not
 * catch because the App Router never unloads the page.
 */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || (anchor as HTMLAnchorElement).target === "_blank") return;
      if (
        !window.confirm(
          "You have unsaved changes. Leave this page and lose them? (A draft is kept on this device.)"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
}

export function EditableSection({
  projectId,
  resource,
  recordId,
  viewerId,
  record,
  canEdit,
  label,
  editLabel = "Edit",
  startText,
  validate,
  onSave,
  onOpen,
  onDone,
  startEditing = false,
  wikiLinks,
  uiBridgeId,
  children,
}: {
  /** The project on screen, for the draft key — record ids repeat across
   *  projects. */
  projectId: string | null;
  /** Registry name, for the draft key. */
  resource: string;
  recordId: string;
  viewerId: string | null;
  record: EditableText;
  canEdit: boolean;
  /** What is being edited, for accessible names ("the vision"). */
  label: string;
  editLabel?: string;
  /** Text to open the editor with when not the record's own — e.g. empty,
   *  for a template nobody has filled in yet. */
  startText?: string;
  /** A reason the text cannot be saved, or null. */
  validate?: (text: string) => string | null;
  onSave: (text: string, version: number) => Promise<SaveResult<EditableText>>;
  /** Called when the editor opens. */
  onOpen?: () => void;
  /** Called when the editor closes, saved or not. */
  onDone?: () => void;
  startEditing?: boolean;
  /** Render `[[links]]` in the editor's preview (see `MarkdownView`). */
  wikiLinks?: WikiLinkOptions;
  uiBridgeId: string;
  /** The read-only rendering. */
  children: React.ReactNode;
}) {
  const key = useMemo(
    () => draftKey(projectId, resource, recordId, viewerId),
    [projectId, resource, recordId, viewerId]
  );
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EditableText | null>(null);
  const [askingToLeave, setAskingToLeave] = useState(false);
  const errorId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();

  const initial = startText ?? record.text;
  const dirty = mode.kind === "edit" && mode.text !== initial;
  useLeaveGuard(dirty);

  const open = () => {
    const draft = readDraft(key);
    const useDraft = draft !== null && draft.text !== initial;
    setError(null);
    setAskingToLeave(false);
    onOpen?.();
    setMode({
      kind: "edit",
      text: useDraft ? draft.text : initial,
      // A restored draft keeps the version it was written against, so saving
      // it over a newer document is a conflict, not an overwrite.
      baseVersion: useDraft ? draft.baseVersion : record.version,
      baseText: useDraft ? null : record.text,
      restoredFrom: useDraft ? draft.savedAt || null : null,
      theirs: null,
    });
  };

  // A write that moved the record's version but not its text — the page's
  // own rename, a details save, a restore of identical text — is not a
  // conflict with what is being typed: follow it, so the save names the
  // version the server now holds instead of refusing the writer's own move.
  // A functional update: a keystroke that lands between the record's
  // commit and this effect must not be overwritten by a stale copy.
  useEffect(() => {
    setMode((m) =>
      m.kind === "edit" &&
      m.baseText !== null &&
      record.version > m.baseVersion &&
      record.text === m.baseText
        ? { ...m, baseVersion: record.version }
        : m
    );
  }, [record.version, record.text]);

  // Keep the draft on the version it will now be saved against.
  const editBase = mode.kind === "edit" ? mode.baseVersion : null;
  const previousBase = useRef<number | null>(null);
  useEffect(() => {
    const moved =
      previousBase.current !== null &&
      editBase !== null &&
      editBase !== previousBase.current;
    previousBase.current = editBase;
    // Only when the base MOVES while editing, not when the editor opens: a
    // rewrite on open would restamp a restored draft as saved just now.
    // Typing writes the draft itself (`change`).
    if (moved && mode.kind === "edit" && mode.text !== initial) {
      writeDraft(key, mode.text, mode.baseVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editBase]);

  // Opening on mount (a "Write it" affordance hands over straight to the
  // editor) happens once, after the first render.
  const opened = useRef(false);
  useEffect(() => {
    if (startEditing && canEdit && !opened.current) {
      opened.current = true;
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const close = () => {
    setMode({ kind: "view" });
    setConflict(null);
    setAskingToLeave(false);
    setError(null);
    onDone?.();
    // Return focus to where the writer started.
    focusAfterRender(editButton);
  };

  const change = (text: string) => {
    if (mode.kind !== "edit") return;
    setMode({ ...mode, text });
    if (text === initial) clearDraft(key);
    else writeDraft(key, text, mode.baseVersion);
  };

  const save = async (text: string, version: number) => {
    const problem = validate?.(text) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(text, version);
    setSaving(false);
    if (result.ok) {
      clearDraft(key);
      close();
    } else if ("conflict" in result) {
      setConflict(result.conflict);
    } else {
      setError(result.error);
    }
  };

  if (!canEdit) return <>{children}</>;

  if (mode.kind === "view") {
    return (
      <div data-ui-bridge-id={uiBridgeId}>
        {children}
        <button
          ref={editButton}
          type="button"
          onClick={open}
          aria-label={`${editLabel}: ${label}`}
          className="mt-2 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id={`${uiBridgeId}.edit`}
        >
          {editLabel}
        </button>
      </div>
    );
  }

  const editor = (
    <MarkdownEditor
      value={mode.text}
      onChange={change}
      label={`Text of ${label}`}
      uiBridgeId={`${uiBridgeId}.editor`}
      invalid={error !== null}
      describedBy={error ? errorId : undefined}
      autoFocus
      wikiLinks={wikiLinks}
    />
  );

  return (
    <div
      className="rounded-md border border-border p-4"
      data-ui-bridge-id={uiBridgeId}
      data-editing="true"
    >
      {mode.restoredFrom !== null && (
        <p
          role="status"
          className="mb-3 text-sm text-muted-foreground"
          data-ui-bridge-id={`${uiBridgeId}.restored`}
        >
          Restored your unsaved draft
          {mode.restoredFrom
            ? ` from ${formatRelativeTime(mode.restoredFrom)}`
            : ""}
          .
        </p>
      )}

      {mode.theirs ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {editor}
          <section aria-label="Their version, for reference">
            <h3 className="mb-2 text-sm font-medium text-foreground">
              Their version
              {mode.theirs.updatedBy ? ` — ${mode.theirs.updatedBy}` : ""}
            </h3>
            <pre
              className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed"
              data-ui-bridge-id={`${uiBridgeId}.theirs`}
            >
              {mode.theirs.text}
            </pre>
          </section>
        </div>
      ) : (
        editor
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-sm text-destructive"
          data-ui-bridge-id={`${uiBridgeId}.error`}
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void save(mode.text, mode.baseVersion)}
          disabled={saving}
          data-ui-bridge-id={`${uiBridgeId}.save`}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {askingToLeave ? (
          <span className="flex items-center gap-2 text-sm" role="group">
            <span>Discard your changes?</span>
            {/* The one control here that loses the writer's text, so it takes
                a real keystroke — a synthetic (bridge) click is refused. */}
            <DestructiveButton
              onClick={() => {
                clearDraft(key);
                close();
              }}
              data-ui-bridge-id={`${uiBridgeId}.discard-confirm`}
            >
              Discard
            </DestructiveButton>
            <Button
              variant="ghost"
              onClick={() => setAskingToLeave(false)}
              data-ui-bridge-id={`${uiBridgeId}.discard-cancel`}
            >
              Keep editing
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            onClick={() => (dirty ? setAskingToLeave(true) : close())}
            disabled={saving}
            data-ui-bridge-id={`${uiBridgeId}.cancel`}
          >
            Cancel
          </Button>
        )}
        {dirty && !saving && (
          <span
            className="text-xs text-muted-foreground"
            data-ui-bridge-id={`${uiBridgeId}.draft-indicator`}
          >
            Unsaved — a draft is kept on this device
          </span>
        )}
      </div>

      <ConflictDialog
        open={conflict !== null}
        mine={mode.text}
        theirs={conflict?.text ?? ""}
        theirsBy={conflict?.updatedBy ?? null}
        theirsAt={conflict?.updatedAt ?? null}
        uiBridgeId={`${uiBridgeId}.conflict`}
        onKeepMine={() => {
          const theirs = conflict;
          setConflict(null);
          if (theirs) void save(mode.text, theirs.version);
        }}
        onTakeTheirs={() => {
          clearDraft(key);
          close();
        }}
        onMerge={() => {
          if (!conflict) return;
          writeDraft(key, mode.text, conflict.version);
          setMode({
            ...mode,
            baseVersion: conflict.version,
            baseText: conflict.text,
            theirs: conflict,
          });
          setConflict(null);
        }}
      />
    </div>
  );
}
