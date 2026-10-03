"use client";

/**
 * Project Overview — the estimate editor, on the overview authoring kit (plan
 * `2026-09-20-overview-authoring-layer` Phase 3).
 *
 * The estimate is one resource on the authoring contract, and this page is one
 * client of it:
 *
 * - **Tables** are the kit's `RecordTable`s, declared in the kit registry:
 *   add, edit inline, remove, sort, and the shared CSV paste dialog (preview,
 *   per-line problems, then commit). The schedule comes from a mermaid
 *   `gantt` chart, which has no kit equivalent, so its importer lives here —
 *   but what it produces lands in the same working copy and the same save.
 * - **Save** is one write through the kit (`useResourceRecord`): the content
 *   and, when the estimate is being built from a document, that document as
 *   its source, in ONE version — they cannot half-land. It names the version
 *   the working copy was built on (`If-Match`), so a peer's save in between
 *   opens the kit's conflict dialog with both versions side by side, never an
 *   overwrite. The change log records it as an import when the working copy
 *   holds one, and the page shows the estimate's history (`ChangeLogPanel`).
 * - **The working copy is kept on this device** until it is saved or
 *   discarded, and leaving with unsaved changes asks first.
 * - **Who may edit** is the served permission for the project on screen
 *   (`EditGate`), never `isCoordAdmin`.
 * - **A Save that would drop a phase holding recorded work asks first.** A
 *   saved phase nothing in the working copy continues (by its id, else its
 *   code) is deleted by the write, with the progress recorded on the Timeline
 *   and its milestones untied. Before such a Save the page reads, fresh, what
 *   those phases hold, and names each one and its loss; a read that failed is
 *   said too (`DroppedPhasesDialog`, `_lib/dropped.ts`).
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { estimateVocabulary } from "@/components/overview/vocabulary";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import { ConflictDialog } from "@/components/overview/editing/ConflictDialog";
import { IssueList } from "@/components/overview/editing/CsvPasteDialog";
import {
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
} from "@/components/overview/editing/drafts";
import { useLeaveGuard } from "@/components/overview/editing/leave-guard";
import {
  EditGate,
  useOverviewCatalog,
  useResourceDescriptor,
} from "@/components/overview/editing/permissions";
import { RecordTable } from "@/components/overview/editing/RecordTable";
import {
  ESTIMATE_ALLOCATIONS,
  ESTIMATE_EFFORTS,
  ESTIMATE_ROLES,
} from "@/components/overview/editing/registry";
import {
  useResourceList,
  useResourceRecord,
  type SaveResult,
} from "@/components/overview/editing/useResource";
import { schemaDefinition } from "@/components/overview/editing/validation";
import type { WriteSource } from "@/components/overview/editing/api";
import { formatRelativeTime } from "@/lib/time-utils";
import { sumPersonDays } from "../../_lib/csv";
import {
  ESTIMATES,
  pickBaseline,
  type EstimatePurposeOption,
  type EstimateRecord,
} from "../../_lib/estimate-api";
import { ganttToPhases, parseMermaidGantt } from "../../_lib/gantt";
import { useOverviewProject } from "../../_hooks/useOverviewProject";
import {
  applyGanttImport,
  describeDraft,
  draftFromEstimate,
  draftFromStorage,
  draftProblems,
  draftToContent,
  draftToStorage,
  keepMineBlockers,
  openMergeNotes,
  rebaseDraft,
  sameDraft,
  STORED_DRAFT_SCHEMA,
  takePart,
  type Draft,
  type DraftPart,
  type MergeNote,
} from "./_lib/draft";
import {
  checkDroppedPhases,
  droppedPhases,
  type DropCheck,
} from "./_lib/dropped";
import { useSourceDocument, type SourceDocument } from "./_lib/source";
import { DroppedPhasesDialog } from "./_components/DroppedPhasesDialog";
import { statusAfterEdit, type Status } from "./_lib/status";

const TEAM_ROUTE = "/overview/team";

const PURPOSES: {
  value: EstimatePurposeOption;
  label: string;
  help: string;
}[] = [
  {
    value: "budget",
    label: "A budget",
    help: "Money this project is expected to spend. What it actually spends will be tracked against it.",
  },
  {
    value: "comparison",
    label: "A comparison",
    help: "What the work would cost delivered conventionally. A baseline to compare against, not money this project will spend.",
  },
  {
    value: "forecast",
    label: "A forecast",
    help: "A projection of the likely cost, with no commitment.",
  },
];

const PARTS: { part: DraftPart; label: string }[] = [
  { part: "schedule", label: "their phases and tasks" },
  { part: "roles", label: "their roles" },
  { part: "allocations", label: "their allocations" },
  { part: "efforts", label: "their days of work" },
];

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-overview-serif)] text-[1.375rem] text-foreground">
      {children}
    </h2>
  );
}

/** Says which document the estimate is being built from, and what happens
 *  to it. `linked`: it is already this estimate's recorded source. */
function SourceBanner({
  source,
  linked,
  creating,
}: {
  source: SourceDocument;
  linked: boolean;
  creating: boolean;
}) {
  return (
    <section
      role="note"
      className="max-w-[46rem] rounded-md border border-border bg-muted/30 px-4 py-3 text-[15px] leading-relaxed"
      data-ui-bridge-id="overview.estimate-editor.source"
    >
      <p className="text-foreground">
        Building the estimate from &ldquo;
        <Link
          href={`/overview/documents/${encodeURIComponent(source.id)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {source.title}
        </Link>
        &rdquo;.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {source.gantt
          ? creating
            ? "Once the estimate exists, its gantt chart will be waiting in the import box. "
            : "Its gantt chart is in the import box below: read it, and use it if it looks right. "
          : "It has no mermaid gantt chart, so the schedule is entered here as usual. "}
        {linked
          ? "It is already recorded as this estimate’s source."
          : creating
            ? "Creating the estimate records it as the source."
            : "Saving records it as this estimate’s source."}
      </p>
    </section>
  );
}

function CreateEstimate({
  create,
  source,
  onSourceGone,
}: {
  create: (
    body: Record<string, unknown>
  ) => Promise<SaveResult<EstimateRecord>>;
  source: SourceDocument | null;
  /** The source turned out not to be a document here: forget it page-wide,
   *  so the editor that follows does not keep trying to record it. */
  onSourceGone: () => void;
}) {
  const [name, setName] = useState("Estimate v0.1");
  const [purpose, setPurpose] = useState<EstimatePurposeOption>("budget");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The source stopped being a document of this project between loading and
  // Create: say so, and offer the estimate without it rather than failing.
  const [sourceGone, setSourceGone] = useState(false);

  const submit = async (withSource: boolean) => {
    setBusy(true);
    setError(null);
    const result = await create({
      name: name.trim(),
      purpose,
      is_baseline: true,
      source_page_id: withSource ? (source?.id ?? null) : null,
    });
    setBusy(false);
    if (result.ok || "conflict" in result) return;
    if (withSource && result.code === "source_page_not_found") {
      setSourceGone(true);
    } else {
      setError(result.error);
    }
  };

  return (
    <section
      className="max-w-[38rem]"
      data-ui-bridge-id="overview.estimate-editor.create"
    >
      <Heading>Set up this project&rsquo;s estimate</Heading>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        An estimate is the plan the project is measured against: its phases, the
        roles it needs and what they come to. What it MEANS is the first choice,
        because every figure is described in those terms afterwards.
      </p>

      <label
        htmlFor="estimate-name"
        className="mt-6 block text-sm font-medium text-foreground"
      >
        Name
      </label>
      <input
        id="estimate-name"
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 w-full max-w-sm rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.create.name"
      />

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-foreground">
          What is it?
        </legend>
        <div className="mt-2 space-y-3">
          {PURPOSES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer gap-3"
              data-ui-bridge-id={`overview.estimate-editor.create.purpose.${option.value}`}
            >
              <input
                type="radio"
                name="purpose"
                value={option.value}
                checked={purpose === option.value}
                onChange={() => setPurpose(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm text-foreground">
                  {option.label}
                </span>
                <span className="block text-sm leading-relaxed text-muted-foreground">
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {sourceGone && source && (
        <div role="alert" className="mt-4 text-sm">
          <p className="text-destructive">
            &ldquo;{source.title}&rdquo; is no longer a document in this
            project, so it can&rsquo;t be the estimate&rsquo;s source.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onSourceGone();
              void submit(false);
            }}
            className="mt-2 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id="overview.estimate-editor.create.without-source"
          >
            Create it without a source
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={busy || name.trim() === ""}
        onClick={() => void submit(true)}
        className="mt-6 inline-flex min-h-9 items-center rounded-md bg-primary px-3.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.create.submit"
      >
        {busy ? "Creating…" : "Create it"}
      </button>
    </section>
  );
}

function GanttImport({
  onImport,
  busy = false,
  initialText = "",
  onTextChange,
}: {
  onImport: (text: string) => void;
  /** Told whether the box holds typed text that is not yet applied (the
   *  source document's own chart, untouched, does not count). */
  onTextChange?: (unapplied: boolean) => void;
  /** A save is in flight: an import now would change a working copy the
   *  open request is NOT carrying. */
  busy?: boolean;
  /** A chart to start from: the source document's, when it has one. */
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const unapplied = text.trim() !== "" && text !== initialText;
  useEffect(() => {
    onTextChange?.(unapplied);
  }, [unapplied, onTextChange]);
  const [preview, setPreview] = useState<ReturnType<
    typeof parseMermaidGantt
  > | null>(null);

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];

  return (
    <div
      className="rounded-md border border-border p-4"
      data-ui-bridge-id="overview.estimate-editor.gantt"
    >
      <label
        htmlFor="gantt-input"
        className="block text-sm font-medium text-foreground"
      >
        Import the schedule from a mermaid gantt chart
      </label>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Paste the chart from the delivery plan. Each <code>section</code>{" "}
        becomes a phase and each bar becomes a task. Dates have to be written
        YYYY-MM-DD.
      </p>
      <textarea
        id="gantt-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={10}
        spellCheck={false}
        placeholder={
          "gantt\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    section A0 Mobilisation\n    Kick-off :a0t1, 2026-01-05, 5d"
        }
        className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.gantt.input"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={text.trim() === ""}
          onClick={() => setPreview(parseMermaidGantt(text))}
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.gantt.read"
        >
          Read it
        </button>
        {preview && preview.taskCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onImport(text);
              setText("");
              setPreview(null);
            }}
            className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id="overview.estimate-editor.gantt.apply"
          >
            Use this schedule
          </button>
        )}
        {preview && (
          <p
            role="status"
            className="text-sm text-muted-foreground"
            data-ui-bridge-id="overview.estimate-editor.gantt.summary"
          >
            {preview.taskCount === 0
              ? "No task could be read from that chart."
              : `Read ${preview.phases.length} phase${preview.phases.length === 1 ? "" : "s"} and ${preview.taskCount} task${preview.taskCount === 1 ? "" : "s"}.`}
            {errors.length > 0 &&
              ` ${errors.length} line${errors.length === 1 ? "" : "s"} could not be read.`}
            {preview.excludesWeekends &&
              " Durations were laid out over working days, as the chart excludes weekends."}
          </p>
        )}
      </div>
      {preview && (
        <IssueList
          issues={preview.issues}
          uiBridgeId="overview.estimate-editor.gantt.issues"
        />
      )}
      {preview && preview.taskCount > 0 && (
        <ul
          className="mt-4 space-y-2 text-sm"
          data-ui-bridge-id="overview.estimate-editor.gantt.preview"
        >
          {preview.phases.map((phase) => (
            <li key={phase.code}>
              <span className="font-mono text-xs text-muted-foreground">
                {phase.code}
              </span>{" "}
              <span className="text-foreground">{phase.name}</span>{" "}
              <span className="text-muted-foreground">
                {phase.plannedStart} &rarr; {phase.plannedEnd} &middot;{" "}
                {phase.tasks.length} task{phase.tasks.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The working copy as this device last kept it, when it says something the
 *  saved estimate does not. */
function restoredDraft(
  key: string,
  saved: Draft
): {
  draft: Draft;
  base: Draft;
  imported: boolean;
  notes: MergeNote[];
  baseVersion: number;
  savedAt: string;
} | null {
  const stored = readDraft(key);
  if (!stored) return null;
  const parsed = draftFromStorage(stored.text);
  if (!parsed || sameDraft(parsed.draft, saved)) return null;
  return {
    ...parsed,
    // A note is kept only while it is open, but the copy may have been
    // written by a build that kept a settled one: re-check on the way in.
    notes: openMergeNotes(parsed.notes ?? [], parsed.draft),
    baseVersion: stored.baseVersion,
    savedAt: stored.savedAt,
  };
}

function EstimateEditor({
  record,
  update,
  source,
  onSourceDropped,
  projectId,
  viewerId,
  updateSchema,
}: {
  /** The estimate as the server last answered — with its content. */
  record: EstimateRecord;
  update: (
    patch: Record<string, unknown>,
    baseVersion: number,
    options?: { source?: WriteSource }
  ) => Promise<SaveResult<EstimateRecord>>;
  source: SourceDocument | null;
  onSourceDropped: () => void;
  projectId: string | null;
  viewerId: string | null;
  /** The estimate's served update schema; each table's rows are checked
   *  against their definition inside it. */
  updateSchema: Parameters<typeof schemaDefinition>[0];
}) {
  const key = useMemo(
    () => draftKey(projectId, ESTIMATES, record.id, viewerId),
    [projectId, record.id, viewerId]
  );
  // Everything below starts from the record ONCE. A later change to `record`
  // (a conflict hands the hook their copy) must never replace what the
  // writer is working on; only Save, "keep theirs" and Discard do that.
  const [initial] = useState(() => {
    const saved = draftFromEstimate(record);
    const restored = restoredDraft(key, saved);
    return {
      saved,
      draft: restored?.draft ?? saved,
      base: restored?.base ?? saved,
      imported: restored?.imported ?? false,
      notes: restored?.notes ?? [],
      baseVersion: restored?.baseVersion ?? record.version,
      restoredFrom: restored?.savedAt ?? null,
    };
  });
  /** What the server held at `baseVersion` — the yardstick for "unsaved". */
  const [baseDraft, setBaseDraft] = useState<Draft>(initial.base);
  const [baseVersion, setBaseVersion] = useState(initial.baseVersion);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  /** The working copy holds an import, so its save is recorded as one. */
  const [imported, setImported] = useState(initial.imported);
  const [restoredFrom, setRestoredFrom] = useState(initial.restoredFrom);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [conflict, setConflict] = useState<EstimateRecord | null>(null);
  /** A Save held for the drop check: being checked, or waiting on the
   *  writer's answer to what the check found. */
  const [held, setHeld] = useState<
    | { state: "checking" }
    | { state: "asking"; check: DropCheck; version: number; content: Draft }
    | null
  >(null);
  /** Their version, shown beside the working copy after "combine". */
  const [theirs, setTheirs] = useState<EstimateRecord | null>(null);
  /** Tables with a row editor open: typed text not yet in the working copy. */
  const [openEditors, setOpenEditors] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const trackEditor = useCallback(
    (table: string) => (open: boolean) =>
      setOpenEditors((prev) => {
        if (prev.has(table) === open) return prev;
        const next = new Set(prev);
        if (open) next.add(table);
        else next.delete(table);
        return next;
      }),
    []
  );
  const onRolesEditing = useMemo(() => trackEditor("roles"), [trackEditor]);
  const onAllocationsEditing = useMemo(
    () => trackEditor("allocations"),
    [trackEditor]
  );
  const onEffortsEditing = useMemo(() => trackEditor("efforts"), [trackEditor]);
  /** Import boxes holding text not yet applied — in no working copy and on
   *  no device. */
  const [unappliedBoxes, setUnappliedBoxes] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const trackBox = useCallback(
    (box: string) => (has: boolean) =>
      setUnappliedBoxes((prev) => {
        if (prev.has(box) === has) return prev;
        const next = new Set(prev);
        if (has) next.add(box);
        else next.delete(box);
        return next;
      }),
    []
  );
  const onGanttText = useMemo(() => trackBox("gantt"), [trackBox]);
  const onRolesPaste = useMemo(() => trackBox("roles"), [trackBox]);
  const onAllocationsPaste = useMemo(() => trackBox("allocations"), [trackBox]);
  const onEffortsPaste = useMemo(() => trackBox("efforts"), [trackBox]);
  /** What a "combine" left for the writer to settle. Each holds Save until
   *  it is settled (`openMergeNotes`), and they are kept with the copy on
   *  this device, so a reload still says why. */
  const [mergeNotes, setMergeNotes] = useState<MergeNote[]>(initial.notes);
  const vocabulary = estimateVocabulary(record.purpose);

  // Recorded as part of Save, in the same write as the content.
  const linkSource = source !== null && record.source_page_id !== source.id;
  const dirty = !sameDraft(draft, baseDraft) || baseVersion !== record.version;
  const unsavedCopy = !sameDraft(draft, baseDraft);
  const unkeptText = openEditors.size > 0 || unappliedBoxes.size > 0;
  useLeaveGuard(
    unsavedCopy || unkeptText,
    unkeptText
      ? "You have typed text that has not been applied yet — a table row being edited, or text in an import box — and it is NOT kept on this device. Leave this page and lose it?" +
          (unsavedCopy
            ? " (Your other unsaved changes are kept on this device.)"
            : "")
      : "The estimate has unsaved changes. Leave this page and lose them? (They are kept on this device.)"
  );

  /** Keep the working copy on this device — with the version it is built on
   *  and what the estimate held then, for a three-way merge later. */
  const keep = (
    next: Draft,
    nextImported: boolean,
    version: number,
    base: Draft = baseDraft,
    notes: MergeNote[] = mergeNotes
  ) => {
    const open = openMergeNotes(notes, next);
    if (
      sameDraft(next, base) &&
      version === record.version &&
      open.length === 0
    )
      clearDraft(key);
    else
      writeDraft(
        key,
        draftToStorage({
          schema: STORED_DRAFT_SCHEMA,
          draft: next,
          base,
          imported: nextImported,
          notes: open,
        }),
        version
      );
  };

  /** Settle a note because the writer says they have checked it — a note
   *  about the whole merge, or a flagged row they have decided is right as it
   *  stands (editing or removing the row settles it too). */
  const settleNote = (note: MergeNote) => {
    const notes = mergeNotes.filter((n) => n !== note);
    setMergeNotes(notes);
    keep(draft, imported, baseVersion, baseDraft, notes);
  };

  /**
   * Every change to the working copy goes through here, so that "Saved as
   * version N" cannot outlive the thing it describes, and the copy kept on
   * this device follows it.
   */
  const editDraft = (
    change: (current: Draft) => Draft,
    how: "edit" | "import"
  ) => {
    const next = change(draft);
    const nextImported = imported || how === "import";
    // A row a note flagged, once edited or removed, settles that note.
    const notes = openMergeNotes(mergeNotes, next);
    setDraft(next);
    setImported(nextImported);
    setMergeNotes(notes);
    setStatus(statusAfterEdit);
    keep(next, nextImported, baseVersion, baseDraft, notes);
  };

  /** Make `fresh` the record the working copy is built on, and the copy. */
  const reset = (fresh: EstimateRecord) => {
    const saved = draftFromEstimate(fresh);
    setBaseDraft(saved);
    setDraft(saved);
    setBaseVersion(fresh.version);
    setImported(false);
    setRestoredFrom(null);
    setTheirs(null);
    setMergeNotes([]);
    clearDraft(key);
  };

  const problems = draftProblems(draft);
  const blocking = problems.filter((p) => p.severity === "error");

  const save = async (
    version: number,
    {
      withSource = linkSource,
      content = draft,
    }: { withSource?: boolean; content?: Draft } = {}
  ) => {
    setStatus({ kind: "saving" });
    const patch: Record<string, unknown> = { content: draftToContent(content) };
    if (withSource && source !== null) patch.source_page_id = source.id;
    const result = await update(patch, version, {
      source: imported ? "import" : "ui",
    });
    if (result.ok) {
      reset(result.item);
      setStatus({ kind: "saved", version: result.item.version });
    } else if ("conflict" in result) {
      setStatus({ kind: "idle" });
      setConflict(result.conflict);
    } else if (result.code === "source_page_not_found") {
      setStatus({ kind: "source_refused" });
    } else {
      setStatus({ kind: "failed", message: result.error });
    }
  };

  /**
   * Save — unless it would drop saved phases (those of `base`, the version it
   * is written over) that hold recorded work, or whose holdings cannot be
   * read: then the writer is asked first.
   */
  const guardedSave = async (
    version: number,
    {
      content = draft,
      base = baseDraft,
    }: { content?: Draft; base?: Draft } = {}
  ) => {
    const dropped = droppedPhases(base.phases, draftToContent(content).phases);
    if (dropped.length === 0) {
      await save(version, { content });
      return;
    }
    setHeld({ state: "checking" });
    const check = await checkDroppedPhases(record.id, dropped);
    if (check.kind === "clear") {
      setHeld(null);
      await save(version, { content });
    } else {
      setHeld({ state: "asking", check, version, content });
    }
  };

  const busy = status.kind === "saving" || held !== null;
  const theirsDraft = useMemo(
    () => (theirs ? draftFromEstimate(theirs) : null),
    [theirs]
  );
  const theirsOfConflict = useMemo(
    () => (conflict ? draftFromEstimate(conflict) : null),
    [conflict]
  );
  const rebased = useMemo(
    () =>
      theirsOfConflict ? rebaseDraft(draft, baseDraft, theirsOfConflict) : null,
    [theirsOfConflict, draft, baseDraft]
  );
  // "Keep mine" is offered only when the merged copy is what the writer
  // means AND would be accepted: otherwise it is a combine, said why.
  const blockers = useMemo(
    () => (rebased ? keepMineBlockers(rebased) : []),
    [rebased]
  );
  const rowSchema = (name: string) => schemaDefinition(updateSchema, name);
  const days = sumPersonDays(draft.efforts.map((e) => e.planned_person_days));

  return (
    <div className="space-y-12" data-ui-bridge-id="overview.estimate-editor">
      {source && (
        <SourceBanner source={source} linked={!linkSource} creating={false} />
      )}
      <section>
        <p className="text-sm text-muted-foreground">
          {record.name} &middot; {vocabulary.noun} &middot; version{" "}
          {record.version}
        </p>
        <ChangeLogPanel
          resource={ESTIMATES}
          recordId={record.id}
          updatedBy={record.updated_by}
          updatedAt={record.updated_at}
          uiBridgeId="overview.estimate-editor.history"
        />
        <p className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground">
          Nothing on this page is saved until you press Save; until then your
          changes are kept on this device. Pasting a table replaces the table it
          belongs to, so you can paste a corrected table over a wrong one.
        </p>
        {restoredFrom !== null && (
          <p
            role="status"
            className="mt-3 max-w-[46rem] text-sm text-foreground"
            data-ui-bridge-id="overview.estimate-editor.restored"
          >
            These are your unsaved changes from{" "}
            {formatRelativeTime(restoredFrom)}.{" "}
            <button
              type="button"
              onClick={() => reset(record)}
              className="inline-flex min-h-9 items-center rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ui-bridge-id="overview.estimate-editor.restored.discard"
            >
              Discard them and start from the saved estimate
            </button>
          </p>
        )}
      </section>

      {theirs && theirsDraft && (
        <section
          className="max-w-[46rem] rounded-md border border-border p-4"
          aria-label="Their version"
          data-ui-bridge-id="overview.estimate-editor.theirs"
        >
          <h3 className="text-sm font-medium text-foreground">
            Their version{theirs.updated_by ? ` — ${theirs.updated_by}` : ""}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving now replaces it with your working copy. Bring over what you
            want to keep first.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
            {describeDraft(theirsDraft)}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            {PARTS.map(({ part, label }) => (
              <button
                key={part}
                type="button"
                disabled={busy}
                onClick={() =>
                  editDraft((d) => takePart(d, theirsDraft, part), "edit")
                }
                className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id={`overview.estimate-editor.theirs.take.${part}`}
              >
                Take {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {mergeNotes.length > 0 && (
        <section
          className="max-w-[46rem] border-l-2 border-destructive pl-4"
          aria-label="Left to settle from combining"
          data-ui-bridge-id="overview.estimate-editor.merge-notes"
        >
          <h3 className="text-sm font-medium text-foreground">
            Left to settle before this can be saved
          </h3>
          <ul className="mt-2 space-y-1.5">
            {mergeNotes.map((note) => (
              <li
                key={note.message}
                className="text-sm leading-relaxed text-destructive"
              >
                {note.message}{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => settleNote(note)}
                  className="inline-flex min-h-9 items-center rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-ui-bridge-id="overview.estimate-editor.merge-notes.checked"
                >
                  I have checked this
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <Heading>Phases and tasks</Heading>
        <GanttImport
          busy={busy}
          initialText={source?.gantt ?? ""}
          onTextChange={onGanttText}
          onImport={(text) => {
            const parsed = ganttToPhases(parseMermaidGantt(text));
            editDraft((d) => applyGanttImport(d, parsed), "import");
          }}
        />
        <div
          className="rounded-md border border-border p-4"
          data-ui-bridge-id="overview.estimate-editor.phases"
        >
          <h3 className="text-sm font-medium text-foreground">
            In the working copy now
          </h3>
          {draft.phases.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No phases yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {draft.phases.map((phase) => (
                <li
                  key={phase.code}
                  data-ui-bridge-id={`overview.estimate-editor.phases.${phase.code}`}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {phase.code}
                  </span>{" "}
                  <span className="text-foreground">{phase.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {phase.planned_start ?? "no start"} &rarr;{" "}
                    {phase.planned_end ?? "no end"} &middot;{" "}
                    {phase.tasks.length} task
                    {phase.tasks.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <Heading>Roles and rates</Heading>
        <RecordTable
          table={ESTIMATE_ROLES}
          rows={draft.roles}
          onChange={(roles, how) => editDraft((d) => ({ ...d, roles }), how)}
          canEdit
          busy={busy}
          rowSchema={rowSchema(ESTIMATE_ROLES.schemaDef)}
          onEditingChange={onRolesEditing}
          onPasteTextChange={onRolesPaste}
          uiBridgeId="overview.estimate-editor.roles"
        />
      </section>

      <section className="space-y-4">
        <Heading>How much of each role, per phase</Heading>
        <RecordTable
          table={ESTIMATE_ALLOCATIONS}
          rows={draft.allocations}
          onChange={(allocations, how) =>
            editDraft((d) => ({ ...d, allocations }), how)
          }
          canEdit
          busy={busy}
          rowSchema={rowSchema(ESTIMATE_ALLOCATIONS.schemaDef)}
          onEditingChange={onAllocationsEditing}
          onPasteTextChange={onAllocationsPaste}
          uiBridgeId="overview.estimate-editor.allocations"
        />
      </section>

      <section className="space-y-4">
        <Heading>Days of work per task</Heading>
        <p className="max-w-[46rem] text-sm leading-relaxed text-muted-foreground">
          This is the only place days of work come from — the allocation table
          above is a separate statement of team size and is never used to derive
          them.
        </p>
        <RecordTable
          table={ESTIMATE_EFFORTS}
          rows={draft.efforts}
          onChange={(efforts, how) =>
            editDraft((d) => ({ ...d, efforts }), how)
          }
          canEdit
          busy={busy}
          rowSchema={rowSchema(ESTIMATE_EFFORTS.schemaDef)}
          onEditingChange={onEffortsEditing}
          onPasteTextChange={onEffortsPaste}
          uiBridgeId="overview.estimate-editor.efforts"
        />
        <p
          className="text-sm text-muted-foreground"
          data-ui-bridge-id="overview.estimate-editor.efforts.count"
        >
          {days ?? "An unreadable number of"} days across {draft.efforts.length}{" "}
          line{draft.efforts.length === 1 ? "" : "s"} in the working copy.
        </p>
      </section>

      {problems.length > 0 && (
        <section
          className="border-l-2 border-destructive pl-4"
          data-ui-bridge-id="overview.estimate-editor.problems"
          role="status"
        >
          <h3 className="text-sm font-medium text-foreground">
            Before this can be saved
          </h3>
          <ul className="mt-2 space-y-1.5">
            {problems.map((problem) => (
              <li
                key={problem.message}
                className={`text-sm leading-relaxed ${
                  problem.severity === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {problem.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
        <button
          type="button"
          onClick={() => void guardedSave(baseVersion)}
          disabled={
            busy ||
            blocking.length > 0 ||
            openEditors.size > 0 ||
            mergeNotes.length > 0 ||
            (!dirty && !linkSource)
          }
          className="inline-flex min-h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.save"
        >
          {held?.state === "checking"
            ? "Checking…"
            : status.kind === "saving"
              ? "Saving…"
              : "Save the estimate"}
        </button>
        <Link
          href={TEAM_ROUTE}
          className="inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.back"
        >
          Back to the Team page
        </Link>
        <div
          role="status"
          className="text-sm"
          data-ui-bridge-id="overview.estimate-editor.status"
        >
          {openEditors.size > 0 && (
            <span className="text-muted-foreground">
              Finish or cancel the row you are editing before saving.{" "}
            </span>
          )}
          {mergeNotes.length > 0 && (
            <span className="text-muted-foreground">
              Settle what combining left above before saving.{" "}
            </span>
          )}
          {held?.state === "checking" && (
            <span className="text-muted-foreground">
              Checking what the phases this save drops hold…{" "}
            </span>
          )}
          {status.kind === "saved" && (
            <span className="text-muted-foreground">
              Saved as version {status.version}. The Team page now shows this.
            </span>
          )}
          {status.kind === "source_refused" && source && (
            <span className="text-destructive">
              &ldquo;{source.title}&rdquo; is no longer a document in this
              project, so it can&rsquo;t be recorded as the estimate&rsquo;s
              source. Nothing was saved.{" "}
              <button
                type="button"
                onClick={() => {
                  onSourceDropped();
                  void save(baseVersion, { withSource: false });
                }}
                className="inline-flex min-h-9 items-center rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id="overview.estimate-editor.save.without-source"
              >
                Save without recording a source
              </button>
            </span>
          )}
          {status.kind === "failed" && (
            <span className="text-destructive">
              It could not be saved: {status.message}
            </span>
          )}
        </div>
      </section>

      <ConflictDialog
        open={conflict !== null}
        // What "keep mine" would write: my changes, rebuilt on their version.
        mine={rebased ? describeDraft(rebased.draft) : ""}
        theirs={theirsOfConflict ? describeDraft(theirsOfConflict) : ""}
        theirsBy={conflict?.updated_by ?? null}
        theirsAt={conflict?.updated_at ?? null}
        keepMineBlocked={blockers}
        uiBridgeId="overview.estimate-editor.conflict"
        onKeepMine={() => {
          const current = conflict;
          setConflict(null);
          if (!current || !rebased || !theirsOfConflict) return;
          if (blockers.length > 0) return; // the button is absent then
          // Built on THEIR version from here on, kept so on this device: if
          // this save meets yet another writer (or fails and is retried), the
          // next merge treats their changes as theirs, not as mine.
          setDraft(rebased.draft);
          setBaseDraft(theirsOfConflict);
          setBaseVersion(current.version);
          setTheirs(null);
          setMergeNotes([]);
          keep(rebased.draft, imported, current.version, theirsOfConflict, []);
          void guardedSave(current.version, {
            content: rebased.draft,
            base: theirsOfConflict,
          });
        }}
        onTakeTheirs={() => {
          const current = conflict;
          setConflict(null);
          if (current) {
            reset(current);
            setStatus({ kind: "idle" });
          }
        }}
        onMerge={() => {
          const current = conflict;
          setConflict(null);
          if (!current || !rebased || !theirsOfConflict) return;
          // Rebuilt on their version: what I did not change is theirs now,
          // and Save replaces the rest knowingly, once the writer has brought
          // over what they want from the panel.
          setDraft(rebased.draft);
          setBaseDraft(theirsOfConflict);
          setBaseVersion(current.version);
          setTheirs(current);
          // The rows and checks the merge could not settle hold Save until
          // the writer settles them. (Broken cross-references are already
          // held by the problem list.)
          setMergeNotes(rebased.unresolved);
          keep(
            rebased.draft,
            imported,
            current.version,
            theirsOfConflict,
            rebased.unresolved
          );
        }}
      />

      <DroppedPhasesDialog
        check={held?.state === "asking" ? held.check : null}
        uiBridgeId="overview.estimate-editor.drop-warning"
        onCancel={() => setHeld(null)}
        onConfirm={() => {
          if (held?.state !== "asking") return;
          const { version, content } = held;
          setHeld(null);
          void save(version, { content });
        }}
      />
    </div>
  );
}

// `useSearchParams` needs a Suspense boundary above it.
export default function EstimateEditorRoute() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[52rem] space-y-4" aria-busy>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <EstimateEditorPage />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function EstimateEditorPage() {
  // The served permission for THIS project, never `isCoordAdmin` (a union
  // across every project the viewer belongs to). Until it has answered the
  // page waits rather than guessing either way.
  const catalog = useOverviewCatalog();
  const descriptor = useResourceDescriptor(ESTIMATES);
  const { projectId, hold, tenantsError, viewerId } = useOverviewProject();
  const estimates = useResourceList<EstimateRecord>(ESTIMATES, {
    hold,
    reloadKey: projectId,
  });
  const chosen =
    estimates.list.state === "ready"
      ? pickBaseline(estimates.list.items)
      : null;
  const estimate = useResourceRecord<EstimateRecord>(
    ESTIMATES,
    chosen?.id ?? null,
    { hold, reloadKey: projectId }
  );
  const sourceState = useSourceDocument(
    useSearchParams().get("from_document"),
    hold,
    projectId
  );
  // Set when a write found the document gone; reset with the document read.
  const [sourceDropped, setSourceDropped] = useState<SourceDocument | null>(
    null
  );
  const source =
    sourceState.kind === "ready" && sourceDropped?.id !== sourceState.source.id
      ? sourceState.source
      : null;

  if (tenantsError) {
    return (
      <div
        className="max-w-[42rem]"
        data-ui-bridge-id="overview.estimate-editor.page"
      >
        <LoadFailure
          what="the list of projects"
          message={tenantsError}
          uiBridgeId="overview.estimate-editor.tenants.error"
        />
      </div>
    );
  }

  if (catalog.state === "error") {
    return (
      <div
        className="max-w-[42rem]"
        data-ui-bridge-id="overview.estimate-editor.page"
      >
        <LoadFailure
          what="whether you can edit this project"
          message={catalog.message}
          uiBridgeId="overview.estimate-editor.permission.error"
        />
      </div>
    );
  }

  if (catalog.state === "loading") {
    return (
      <div
        className="max-w-[52rem]"
        data-ui-bridge-id="overview.estimate-editor.page"
        aria-busy
      >
        <Loading />
      </div>
    );
  }

  const sourceLoading = sourceState.kind === "loading";
  const listLoading = estimates.list.state === "loading";
  const recordLoading = chosen !== null && estimate.record.state === "loading";

  return (
    <div
      className="max-w-[52rem]"
      data-ui-bridge-id="overview.estimate-editor.page"
      aria-busy={listLoading || recordLoading || sourceLoading}
    >
      {descriptor?.can_edit !== true && (
        <section
          className="max-w-[38rem]"
          data-ui-bridge-id="overview.estimate-editor.forbidden"
        >
          <Heading>You can read this estimate but not change it</Heading>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            You can read everything the estimate produces on the Team page. Who
            may change it is set by this project&rsquo;s administrators.
          </p>
          <Link
            href={TEAM_ROUTE}
            className="mt-4 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id="overview.estimate-editor.forbidden.back"
          >
            Back to the Team page
          </Link>
        </section>
      )}
      <EditGate resource={ESTIMATES}>
        {(listLoading || recordLoading || sourceLoading) && <Loading />}
        {estimates.list.state === "error" && (
          <LoadFailure
            what="this project's estimate"
            message={estimates.list.message}
            uiBridgeId="overview.estimate-editor.error"
          />
        )}
        {chosen !== null && estimate.record.state === "error" && (
          <LoadFailure
            what="this project's estimate"
            message={estimate.record.message}
            uiBridgeId="overview.estimate-editor.error"
          />
        )}
        {sourceState.kind === "missing" && (
          <p
            role="status"
            className="mb-8 max-w-[46rem] text-[15px] text-muted-foreground"
            data-ui-bridge-id="overview.estimate-editor.source.missing"
          >
            The document this was opened from isn&rsquo;t a document in this
            project, so nothing will be recorded as the estimate&rsquo;s source.
          </p>
        )}
        {sourceState.kind === "error" && (
          <div className="mb-8">
            <LoadFailure
              what="the document this estimate is built from"
              message={sourceState.message}
              announce={false}
              uiBridgeId="overview.estimate-editor.source.error"
            />
          </div>
        )}
        {estimates.list.state === "ready" &&
          chosen === null &&
          // Wait for the document too, so Create records it as the source.
          !sourceLoading && (
            <div className="space-y-8">
              {source && (
                <SourceBanner source={source} linked={false} creating />
              )}
              <CreateEstimate
                create={estimates.create}
                source={source}
                onSourceGone={() => source && setSourceDropped(source)}
              />
            </div>
          )}
        {estimate.record.state === "ready" &&
          chosen !== null &&
          estimate.record.item.id === chosen.id &&
          // The editor seeds its gantt box from the source once, on mount:
          // wait for the document so the chart is there when it does.
          !sourceLoading && (
            <EstimateEditor
              // The viewer is part of the draft key: a working copy read under
              // one viewer must never be written under another.
              key={`${projectId}:${viewerId}:${chosen.id}`}
              record={estimate.record.item}
              update={estimate.update}
              source={source}
              onSourceDropped={() => source && setSourceDropped(source)}
              projectId={projectId}
              viewerId={viewerId}
              updateSchema={descriptor?.schemas.update}
            />
          )}
      </EditGate>
    </div>
  );
}
