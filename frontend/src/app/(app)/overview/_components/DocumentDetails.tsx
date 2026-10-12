"use client";

/**
 * A document's details: its number, status, owner and related documents,
 * read as a line under the title and, for an editor, changed in one form.
 */

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ListState,
  SaveResult,
} from "@/components/overview/editing/useResource";
import {
  PAGE_LIST_LIMIT,
  documentMeta,
  pageHref,
  type PageRecord,
} from "../_lib/pages";

/** Suggested, not enforced: a project may use its own words. */
const STATUS_SUGGESTIONS = [
  "Draft",
  "In review",
  "Approved",
  "Final",
  "Superseded",
];

interface Draft {
  title: string;
  doc_number: string;
  doc_status: string;
  owner: string;
  related: string[];
}

function draftOf(page: PageRecord): Draft {
  return {
    title: page.title,
    doc_number: page.doc_number ?? "",
    doc_status: page.doc_status ?? "",
    owner: page.owner ?? "",
    related: [...page.related],
  };
}

/** Only what changed; an emptied field is cleared. */
export function detailsPatch(
  page: PageRecord,
  draft: Draft
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.title.trim() !== page.title) patch.title = draft.title.trim();
  for (const field of ["doc_number", "doc_status", "owner"] as const) {
    const next = draft[field].trim() || null;
    if (next !== page[field]) patch[field] = next;
  }
  const same =
    draft.related.length === page.related.length &&
    [...draft.related]
      .sort()
      .every((s, i) => s === [...page.related].sort()[i]);
  if (!same) patch.related = draft.related;
  return patch;
}

export function RelatedDocuments({
  page,
  documents,
  uiBridgeId,
}: {
  page: PageRecord;
  /** The project's documents, to name the related ones; null while unknown. */
  documents: PageRecord[] | null;
  uiBridgeId: string;
}) {
  if (page.related.length === 0) return null;
  const bySlug = new Map((documents ?? []).map((d) => [d.slug, d]));
  return (
    <p className="text-sm text-muted-foreground" data-ui-bridge-id={uiBridgeId}>
      Related:{" "}
      {page.related.map((slug, i) => {
        const doc = bySlug.get(slug);
        return (
          <span key={slug}>
            {i > 0 && ", "}
            {doc ? (
              <Link
                href={pageHref(doc)}
                className="text-primary underline-offset-4 hover:underline"
              >
                {doc.title}
              </Link>
            ) : (
              // Named by slug: no document has it now (or the list is unread).
              <span>{slug}</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

export function DocumentDetailsForm({
  page,
  documents,
  save,
  onDone,
  uiBridgeId,
}: {
  page: PageRecord;
  /** The project's documents, for the related-documents choice. */
  documents: ListState<PageRecord>;
  save: (
    page: PageRecord,
    patch: Record<string, unknown>
  ) => Promise<SaveResult<PageRecord>>;
  onDone: () => void;
  uiBridgeId: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = {
    title: useId(),
    number: useId(),
    status: useId(),
    owner: useId(),
    list: useId(),
  };
  const others =
    documents.state === "ready"
      ? documents.items.filter((d) => d.id !== page.id)
      : [];
  // "No longer a document" is claimed only when the list is known complete:
  // a degraded or possibly cut-short list may just not show it.
  const complete =
    documents.state === "ready" &&
    documents.degraded === null &&
    documents.items.length < PAGE_LIST_LIMIT;
  const unlisted =
    documents.state === "ready"
      ? page.related.filter((slug) => !others.some((d) => d.slug === slug))
      : [];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setError("A document needs a title.");
      return;
    }
    const patch = detailsPatch(page, draft);
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await save(page, patch);
    setSaving(false);
    if (result.ok) {
      onDone();
    } else if ("conflict" in result) {
      setDraft(draftOf(result.conflict));
      setError(
        "Somebody saved this document since you opened it. Their details are shown now; make your changes again if you still want them."
      );
    } else {
      setError(result.error);
    }
  };

  const field = "mt-1";
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-4 rounded-md border border-border px-4 py-4 sm:grid-cols-2"
      data-ui-bridge-id={uiBridgeId}
    >
      <div className="sm:col-span-2">
        <label htmlFor={ids.title} className="text-sm text-muted-foreground">
          Title
        </label>
        <Input
          id={ids.title}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={200}
          // The button that opened the form is gone; start where the form does.
          autoFocus
          className={field}
          data-ui-bridge-id={`${uiBridgeId}.title`}
        />
      </div>
      <div>
        <label htmlFor={ids.number} className="text-sm text-muted-foreground">
          Document number
        </label>
        <Input
          id={ids.number}
          value={draft.doc_number}
          onChange={(e) => set("doc_number", e.target.value)}
          maxLength={200}
          placeholder="e.g. DP-001"
          className={field}
          data-ui-bridge-id={`${uiBridgeId}.number`}
        />
      </div>
      <div>
        <label htmlFor={ids.status} className="text-sm text-muted-foreground">
          Status
        </label>
        <Input
          id={ids.status}
          value={draft.doc_status}
          onChange={(e) => set("doc_status", e.target.value)}
          maxLength={200}
          list={ids.list}
          placeholder="e.g. Draft"
          className={field}
          data-ui-bridge-id={`${uiBridgeId}.status`}
        />
        <datalist id={ids.list}>
          {STATUS_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={ids.owner} className="text-sm text-muted-foreground">
          Owner
        </label>
        <Input
          id={ids.owner}
          value={draft.owner}
          onChange={(e) => set("owner", e.target.value)}
          maxLength={200}
          placeholder="Who answers for this document"
          className={field}
          data-ui-bridge-id={`${uiBridgeId}.owner`}
        />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm text-muted-foreground">
          Related documents
        </legend>
        {documents.state === "loading" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Loading the other documents…
          </p>
        ) : documents.state === "error" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            The other documents couldn&rsquo;t be loaded, so related documents
            can&rsquo;t be changed right now.
          </p>
        ) : others.length === 0 && unlisted.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            There are no other documents to relate this one to yet.
          </p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
            {[
              ...others.map((doc) => ({ slug: doc.slug, label: doc.title })),
              // Still named, but no document has that address now: listed so
              // it can be removed, which it otherwise never could be.
              ...unlisted.map((slug) => ({
                slug,
                label: complete ? `${slug} (no longer a document here)` : slug,
              })),
            ].map(({ slug, label }) => (
              <li key={slug}>
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.related.includes(slug)}
                    onChange={(e) =>
                      set(
                        "related",
                        e.target.checked
                          ? [...draft.related, slug]
                          : draft.related.filter((s) => s !== slug)
                      )
                    }
                    data-ui-bridge-id={`${uiBridgeId}.related-${slug}`}
                  />
                  {label}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button
          type="submit"
          disabled={saving}
          data-ui-bridge-id={`${uiBridgeId}.save`}
        >
          {saving ? "Saving…" : "Save details"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}

/** The details line under a document's title. */
export function DocumentMetaLine({ page }: { page: PageRecord }) {
  const meta = documentMeta(page);
  return meta ? <p className="text-sm text-foreground">{meta}</p> : null;
}
