"use client";

/**
 * A page's text, as documents and wiki pages both show it: rendered with its
 * `[[wiki links]]`, editable in place by an editor (drafts, conflicts and the
 * leave guard come from `EditableSection`), then its version history and the
 * pages that link to it.
 */

import { useMemo } from "react";
import { MarkdownView } from "@/components/overview/MarkdownView";
import {
  EditableSection,
  type EditableText,
} from "@/components/overview/editing/EditableSection";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type { WikiLinkOptions } from "@/components/overview/wiki-links";
import type { PageRecord } from "../_lib/pages";
import { Backlinks } from "./Backlinks";
import { PageHistory } from "./PageHistory";

function asText(page: PageRecord): EditableText {
  return {
    text: page.body_md ?? "",
    version: page.version,
    updatedBy: page.updated_by,
    updatedAt: page.updated_at,
  };
}

function asEditableResult(
  result: SaveResult<PageRecord>
): SaveResult<EditableText> {
  if (result.ok) return { ok: true, item: asText(result.item) };
  if ("conflict" in result)
    return { ok: false, conflict: asText(result.conflict) };
  return result;
}

/** The link options for the project's wiki: unknown existence is drawn as
 *  existing, never as "nobody wrote this". */
export function useWikiLinkOptions(
  slugs: ReadonlySet<string> | null,
  canEdit: boolean
): WikiLinkOptions {
  return useMemo(
    () => ({
      exists: (slug: string) => (slugs ? slugs.has(slug) : true),
      canCreate: canEdit,
    }),
    [slugs, canEdit]
  );
}

export function PageBody({
  page,
  canEdit,
  projectId,
  viewerId,
  wikiLinks,
  save,
  onReplaced,
  emptyText,
  afterBody,
  uiBridgeId,
}: {
  page: PageRecord;
  canEdit: boolean;
  projectId: string | null;
  viewerId: string | null;
  wikiLinks: WikiLinkOptions;
  save: (
    page: PageRecord,
    patch: Record<string, unknown>,
    version?: number
  ) => Promise<SaveResult<PageRecord>>;
  /** A restore (or a newer copy it met) replaced the page. */
  onReplaced: (page: PageRecord) => void;
  emptyText: string;
  /** Shown between the text and its history (a document's files). */
  afterBody?: React.ReactNode;
  uiBridgeId: string;
}) {
  const body = page.body_md ?? "";
  return (
    <div className="space-y-10">
      <EditableSection
        projectId={projectId}
        resource="pages"
        recordId={page.id}
        viewerId={viewerId}
        record={asText(page)}
        canEdit={canEdit}
        label={page.title}
        wikiLinks={wikiLinks}
        onSave={async (text, version) =>
          asEditableResult(await save(page, { body_md: text }, version))
        }
        uiBridgeId={`${uiBridgeId}.body`}
      >
        {body.trim() ? (
          <MarkdownView headingOffset={1} wikiLinks={wikiLinks}>
            {body}
          </MarkdownView>
        ) : (
          <p
            className="text-[15px] text-muted-foreground"
            data-ui-bridge-id={`${uiBridgeId}.body.empty`}
          >
            {emptyText}
          </p>
        )}
      </EditableSection>
      {afterBody}
      <PageHistory
        page={page}
        canEdit={canEdit}
        onRestored={onReplaced}
        uiBridgeId={`${uiBridgeId}.history`}
      />
      <Backlinks
        pageId={page.id}
        reloadKey={page.version}
        uiBridgeId={`${uiBridgeId}.backlinks`}
      />
    </div>
  );
}
