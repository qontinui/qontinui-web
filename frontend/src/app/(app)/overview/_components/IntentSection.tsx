"use client";

/**
 * One part of the project's own description (what it is, what it is working
 * towards, how success is measured, who it is for), from coord's intent
 * documents. A kind may hold several documents; each is shown.
 *
 * Editable in place for whoever the server says may edit this project's
 * description (plan `2026-09-20-overview-authoring-layer`, Phase 1): each
 * document can be rewritten, moved within its section, and new ones added.
 * Every control is absent for a reader who may not edit — never disabled.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import {
  EditableSection,
  type EditableText,
} from "@/components/overview/editing/EditableSection";
import { MarkdownEditor } from "@/components/overview/editing/MarkdownEditor";
import { useResourceDescriptor } from "@/components/overview/editing/permissions";
import type { SaveResult } from "@/components/overview/editing/useResource";
import { checkFields } from "@/components/overview/editing/validation";
import {
  hasContent,
  type IntentDocument,
  type IntentEntry,
  type SummaryIntentKind,
} from "../_lib/intent";

export const INTENT_HEADINGS: Record<
  SummaryIntentKind,
  { heading: string; missing: string; noun: string }
> = {
  product_intent: {
    heading: "About this project",
    missing: "Nobody has described this project yet.",
    noun: "a document about the project",
  },
  initiative: {
    heading: "What the project is working towards",
    missing: "The project's current initiatives haven't been written yet.",
    noun: "an initiative",
  },
  success_metric: {
    heading: "How success is measured",
    missing: "The project's measures of success haven't been written yet.",
    noun: "a measure of success",
  },
  audience_profile: {
    heading: "Who it is for",
    missing: "The people this project serves haven't been described yet.",
    noun: "an audience",
  },
};

/** Bodies longer than this start collapsed, so one long document does not
 *  push everything else off the page. */
const COLLAPSE_AT_CHARS = 1400;

const RESOURCE = "intent_documents";

export interface IntentSectionActions {
  canEdit: boolean;
  /** The project on screen — part of every draft's key. */
  projectId: string | null;
  viewerId: string | null;
  saveBody: (
    id: string,
    text: string,
    version: number
  ) => Promise<SaveResult<IntentDocument>>;
  move: (
    section: readonly IntentEntry[],
    from: number,
    to: number
  ) => Promise<string | null>;
  createDocument: (
    kind: SummaryIntentKind,
    name: string,
    body: string
  ) => Promise<SaveResult<IntentDocument>>;
}

function IntentBody({ entry, id }: { entry: IntentEntry; id: string }) {
  const long = entry.body.length > COLLAPSE_AT_CHARS;
  const [open, setOpen] = useState(!long);
  return (
    <div>
      <div
        id={id}
        className={open ? undefined : "relative max-h-72 overflow-hidden"}
      >
        <MarkdownView headingOffset={2}>{entry.body}</MarkdownView>
        {!open && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent"
            aria-hidden
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-2 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id={`overview.summary.${id}.toggle`}
        >
          {open ? "Show less" : "Read all of it"}
        </button>
      )}
      {entry.state === "unknown" && (
        <p className="mt-3 text-xs text-muted-foreground">
          This text started as a template and has been edited since. Parts of it
          may still be template wording.
        </p>
      )}
    </div>
  );
}

/** The editor's view of a served document. */
function editable(doc: IntentDocument): EditableText {
  return {
    text: doc.body,
    version: doc.version,
    updatedBy: doc.updated_by,
    updatedAt: doc.updated_at,
  };
}

function asEditableResult(
  result: SaveResult<IntentDocument>
): SaveResult<EditableText> {
  if (result.ok) return { ok: true, item: editable(result.item) };
  if ("conflict" in result)
    return { ok: false, conflict: editable(result.conflict) };
  return result;
}

function entryText(entry: IntentEntry): EditableText {
  return {
    text: entry.source,
    version: entry.version,
    updatedBy: entry.updatedBy,
    updatedAt: entry.updatedAt,
  };
}

const requireText = (text: string) =>
  text.trim() ? null : "Write something before saving.";

/**
 * A document name coord will accept, from a title: lowercase ASCII words
 * joined by hyphens. Coord's names are ASCII-only, so a title written
 * entirely in another script ("Видение") yields no words; it then takes
 * `fallback` — the title itself is kept as the document's heading, which is
 * what the page shows. The caller makes the fallback ONCE per form, so a
 * second Save after a lost answer names the same document (and is recognised
 * as a retry) rather than creating a twin.
 */
export function slugFromTitle(title: string, fallback: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return words || fallback;
}

function NewDocumentForm({
  kind,
  sectionId,
  actions,
  onDone,
}: {
  kind: SummaryIntentKind;
  sectionId: string;
  actions: IntentSectionActions;
  onDone: () => void;
}) {
  const descriptor = useResourceDescriptor(RESOURCE);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Fixed for the life of this form — see `slugFromTitle`.
  const [fallbackName] = useState(() => `document-${Date.now().toString(36)}`);
  const uiBridgeId = `overview.summary.${sectionId}.new`;

  const submit = async () => {
    const name = slugFromTitle(title, fallbackName);
    const body = `# ${title.trim()}\n\n${text.trim()}\n`;
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    const problems = checkFields(
      descriptor?.schemas.create,
      { name, body },
      { name: "The title", body: "The text" }
    );
    const first = Object.values(problems)[0];
    if (first) {
      setError(first);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await actions.createDocument(kind, name, body);
    setSaving(false);
    if (result.ok) onDone();
    else setError("error" in result ? result.error : "It could not be saved.");
  };

  return (
    <div
      className="mt-4 rounded-md border border-border p-4"
      data-ui-bridge-id={uiBridgeId}
    >
      <label
        htmlFor={`${uiBridgeId}-title`}
        className="mb-1 block text-sm font-medium text-foreground"
      >
        Title
      </label>
      <Input
        id={`${uiBridgeId}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        data-ui-bridge-id={`${uiBridgeId}.title`}
      />
      <div className="mt-3">
        <MarkdownEditor
          value={text}
          onChange={setText}
          label="Text"
          uiBridgeId={`${uiBridgeId}.editor`}
        />
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 text-sm text-destructive"
          data-ui-bridge-id={`${uiBridgeId}.error`}
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={saving}
          data-ui-bridge-id={`${uiBridgeId}.save`}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          onClick={onDone}
          disabled={saving}
          data-ui-bridge-id={`${uiBridgeId}.cancel`}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

const linkButton =
  "inline-flex min-h-9 items-center rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:no-underline";

export function IntentSection({
  kind,
  entries,
  actions,
}: {
  kind: SummaryIntentKind;
  entries: IntentEntry[];
  actions: IntentSectionActions;
}) {
  const { heading, missing, noun } = INTENT_HEADINGS[kind];
  // Every template with an OPEN editor stays an unwritten row until that
  // editor closes. Otherwise a save's own optimistic result (or a conflict
  // carrying the other writer's text) moves it into the written list — or
  // flips an empty section to its written branch — which unmounts editors
  // mid-save, taking their error messages and conflict dialogs with them.
  // A SET, because several template editors can be open at once.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const setOpen = (id: string, open: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  // An entry that vanishes while its editor is open (deleted or withdrawn
  // elsewhere) unmounts that editor without its onDone, so drop its id — else
  // the id would linger and hold the document under "Not written yet" if it
  // ever came back written.
  useEffect(() => {
    setOpenIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(entries.map((e) => e.id));
      const kept = [...prev].filter((id) => live.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [entries]);
  const written = entries.filter((e) => hasContent(e) && !openIds.has(e.id));
  // Every template nobody has filled in yet is offered to an editor — not just
  // while the section is empty. Coord seeds several templates for some kinds
  // (three for product_intent), and hiding the rest once one was written left
  // them with no way in from the page.
  const unwritten = actions.canEdit
    ? entries.filter(
        (e) => openIds.has(e.id) || (e.state === "skeleton" && !hasContent(e))
      )
    : [];
  // A template just saved moves to the written list, a different parent, so
  // its row remounts and the editor's own focus-return lands on nothing. Send
  // focus to the document's new heading instead, once it has rendered.
  const [justClosedId, setJustClosedId] = useState<string | null>(null);
  useEffect(() => {
    if (justClosedId === null) return;
    const entry = entries.find((e) => e.id === justClosedId);
    setJustClosedId(null);
    if (!entry || !hasContent(entry)) return; // cancelled: it stayed put
    // Only reclaim focus that was LOST with the remounted row — never pull it
    // out of another editor the writer has moved on to.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document
      .getElementById(`${kind.replace(/_/g, "-")}-${entry.name}--title`)
      ?.focus();
  }, [justClosedId, entries, kind]);
  const sectionId = kind.replace(/_/g, "-");
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const { canEdit } = actions;

  // Name every template row once there is more than one document to choose
  // between, so each button says which document it opens.
  const named = unwritten.length > 1 || written.length > 0;

  const move = async (from: number, to: number) => {
    setMoving(true);
    setMoveError(null);
    setMoveError(await actions.move(written, from, to));
    setMoving(false);
  };

  const missingText = (
    <p className="text-[15px] leading-relaxed text-muted-foreground">
      {missing}
    </p>
  );

  /** `primary`: the empty section's own "Write it", which keeps its
   *  long-standing UI Bridge id. Every other row names its document. */
  const templateRow = (template: IntentEntry, primary: boolean) => (
    // The template coord seeded is the document to write into — but its
    // template text is not offered as a start: it is guidance for agents, not
    // the project's words.
    <EditableSection
      key={template.id}
      projectId={actions.projectId}
      resource={RESOURCE}
      recordId={template.id}
      viewerId={actions.viewerId}
      record={entryText(template)}
      startText=""
      onOpen={() => setOpen(template.id, true)}
      onDone={() => {
        setOpen(template.id, false);
        setJustClosedId(template.id);
      }}
      canEdit
      label={primary && !named ? noun : template.title}
      editLabel={primary && !named ? "Write it" : "Write"}
      validate={requireText}
      onSave={async (text, version) =>
        asEditableResult(await actions.saveBody(template.id, text, version))
      }
      uiBridgeId={
        primary
          ? `overview.summary.${sectionId}.write`
          : `overview.summary.${sectionId}.write-${template.name}`
      }
    >
      {named && <p className="text-sm text-foreground">{template.title}</p>}
    </EditableSection>
  );

  return (
    <section
      aria-labelledby={`${sectionId}-heading`}
      data-ui-bridge-id={`overview.summary.${sectionId}`}
    >
      <h2
        id={`${sectionId}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        {heading}
      </h2>

      {written.length > 0 && (
        <div className="mt-3 space-y-8">
          {written.map((entry, index) => {
            const docId = `${sectionId}-${entry.name}`;
            const title = (
              // Always rendered: the document's own opening heading is removed
              // from its body, so this IS that heading. Rendering it only for
              // multi-document sections dropped the title of every
              // single-document one, and left the heading levels skipping from
              // the section's h2 to the body's h4.
              <h3
                id={`${docId}--title`}
                tabIndex={-1}
                className="mb-2 font-[family-name:var(--font-overview-serif)] text-xl leading-snug text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id={`overview.summary.${docId}.title`}
              >
                {entry.title}
              </h3>
            );
            return (
              <article
                key={entry.id}
                data-ui-bridge-id={`overview.summary.${docId}`}
              >
                {entry.state === "unreadable" ? (
                  <>
                    {title}
                    <LoadFailure
                      what="this part of the description"
                      message={entry.error ?? ""}
                      uiBridgeId={`overview.summary.${docId}.error`}
                      announce={false}
                    />
                  </>
                ) : (
                  <EditableSection
                    projectId={actions.projectId}
                    resource={RESOURCE}
                    recordId={entry.id}
                    viewerId={actions.viewerId}
                    record={entryText(entry)}
                    canEdit={canEdit}
                    label={entry.title}
                    validate={requireText}
                    onSave={async (text, version) =>
                      asEditableResult(
                        await actions.saveBody(entry.id, text, version)
                      )
                    }
                    uiBridgeId={`overview.summary.${docId}.editable`}
                  >
                    {title}
                    <IntentBody entry={entry} id={docId} />
                  </EditableSection>
                )}
                <div className="flex flex-wrap items-center gap-x-3">
                  <ChangeLogPanel
                    resource={RESOURCE}
                    recordId={entry.id}
                    updatedBy={entry.updatedBy}
                    updatedAt={entry.updatedAt}
                    uiBridgeId={`overview.summary.${docId}.history`}
                  />
                  {canEdit && written.length > 1 && (
                    <span
                      className="mt-2 flex gap-1"
                      role="group"
                      aria-label={`Order of ${entry.title}`}
                    >
                      <button
                        type="button"
                        className={linkButton}
                        disabled={moving || index === 0}
                        onClick={() => void move(index, index - 1)}
                        aria-label={`Move ${entry.title} up`}
                        data-ui-bridge-id={`overview.summary.${docId}.move-up`}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={linkButton}
                        disabled={moving || index === written.length - 1}
                        onClick={() => void move(index, index + 1)}
                        aria-label={`Move ${entry.title} down`}
                        data-ui-bridge-id={`overview.summary.${docId}.move-down`}
                      >
                        Move down
                      </button>
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          {moveError && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-ui-bridge-id={`overview.summary.${sectionId}.move-error`}
            >
              {moveError}
            </p>
          )}
        </div>
      )}

      {/* ONE container for every unwritten template, at a fixed position in
          the tree whether or not the section has written documents yet.
          Rendering the rows under a different parent per case remounted every
          open editor the moment one save made the section "written". */}
      {(written.length === 0 || unwritten.length > 0) && (
        <div
          {...(written.length > 0
            ? {
                role: "group",
                "aria-labelledby": `${sectionId}--unwritten-label`,
              }
            : {})}
          className="mt-3 space-y-3 border-l-2 border-border pl-4"
          data-ui-bridge-id={
            written.length > 0
              ? `overview.summary.${sectionId}.unwritten`
              : `overview.summary.${sectionId}.missing`
          }
        >
          {written.length > 0 ? (
            <h3
              id={`${sectionId}--unwritten-label`}
              className="text-sm font-normal text-muted-foreground"
            >
              Not written yet
            </h3>
          ) : (
            missingText
          )}
          {unwritten.map((t, i) =>
            templateRow(t, i === 0 && written.length === 0)
          )}
          {unwritten.length === 0 && canEdit && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`mt-1 ${linkButton}`}
              data-ui-bridge-id={`overview.summary.${sectionId}.write`}
            >
              Write it
            </button>
          )}
        </div>
      )}

      {canEdit && written.length > 0 && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`mt-4 ${linkButton}`}
          data-ui-bridge-id={`overview.summary.${sectionId}.add`}
        >
          Add {noun}
        </button>
      )}
      {canEdit && adding && (
        <NewDocumentForm
          kind={kind}
          sectionId={sectionId}
          actions={actions}
          onDone={() => setAdding(false)}
        />
      )}
    </section>
  );
}
