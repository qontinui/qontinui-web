"use client";

/**
 * One document written here: its details (number, status, owner, related
 * documents), its text, the files attached to it, its version history and
 * the pages that link to it.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useFocusAfterRender } from "@/components/overview/editing/focus";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { useResourceList } from "@/components/overview/editing/useResource";
import { formatRelativeTime } from "@/lib/time-utils";
import {
  DocumentDetailsForm,
  DocumentMetaLine,
  RelatedDocuments,
} from "../../_components/DocumentDetails";
import { FilesPanel } from "../../_components/FilesPanel";
import { PageBody, useWikiLinkOptions } from "../../_components/PageBody";
import { useOverviewProject } from "../../_hooks/useOverviewProject";
import { usePage, useWikiSlugs } from "../../_hooks/usePages";
import type { FileRecord, PageRecord } from "../../_lib/pages";

function BackToDocuments() {
  return (
    <Link
      href="/overview/documents"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      data-ui-bridge-id="overview.document.back"
    >
      All documents
    </Link>
  );
}

export default function DocumentView() {
  const { id } = useParams<{ id: string }>();
  const { projectId, hold, tenantsError, viewerId } = useOverviewProject();
  const canEdit = useCanEdit("pages");
  const canEditFiles = useCanEdit("files");
  const { state, replace, save } = usePage(
    { id },
    { hold, reloadKey: projectId }
  );
  const documents = useResourceList<PageRecord>("pages", {
    params: { kind: "document" },
    hold,
    reloadKey: projectId,
  });
  const attachments = useResourceList<FileRecord>("files", {
    params: { page_id: id },
    hold,
    reloadKey: projectId,
  });
  const wikiSlugs = useWikiSlugs({ hold, reloadKey: projectId });
  const wikiLinks = useWikiLinkOptions(wikiSlugs, canEdit);
  const [editingDetails, setEditingDetails] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const doneWithDetails = () => {
    setEditingDetails(false);
    // Back to where the writer started, not the top of the page.
    focusAfterRender(detailsButton);
  };
  const documentList =
    documents.list.state === "ready" ? documents.list.items : null;

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.document.tenants.error"
      />
    );
  }

  return (
    <article
      className="max-w-[48rem] space-y-6"
      data-ui-bridge-id="overview.document"
    >
      <BackToDocuments />
      {state.state === "loading" && (
        <p className="text-sm text-muted-foreground">Loading the document…</p>
      )}
      {state.state === "error" && (
        <LoadFailure
          what="this document"
          message={state.message}
          uiBridgeId="overview.document.error"
        />
      )}
      {state.state === "missing" && (
        <p
          className="text-[15px] text-muted-foreground"
          data-ui-bridge-id="overview.document.missing"
        >
          This project has no such document. It may have been deleted.
        </p>
      )}
      {state.state === "ready" && state.page.kind !== "document" && (
        <p className="text-[15px] text-muted-foreground">
          That is a wiki page, not a document.
        </p>
      )}
      {state.state === "ready" && state.page.kind === "document" && (
        <>
          <header className="space-y-1.5">
            {editingDetails ? (
              <DocumentDetailsForm
                page={state.page}
                documents={documents.list}
                save={save}
                onDone={doneWithDetails}
                uiBridgeId="overview.document.details"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2
                    className="font-[family-name:var(--font-overview-serif)] text-3xl leading-tight text-foreground"
                    data-ui-bridge-id="overview.document.title"
                  >
                    {state.page.title}
                  </h2>
                  {canEdit && (
                    <button
                      ref={detailsButton}
                      type="button"
                      onClick={() => setEditingDetails(true)}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      data-ui-bridge-id="overview.document.details-open"
                    >
                      Edit details
                    </button>
                  )}
                </div>
                <DocumentMetaLine page={state.page} />
                <RelatedDocuments
                  page={state.page}
                  documents={documentList}
                  uiBridgeId="overview.document.related"
                />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Version {state.page.version} · edited{" "}
              {formatRelativeTime(state.page.updated_at)}
              {state.page.updated_by ? ` by ${state.page.updated_by}` : ""}
            </p>
          </header>
          <PageBody
            page={state.page}
            canEdit={canEdit}
            projectId={projectId}
            viewerId={viewerId}
            wikiLinks={wikiLinks}
            save={save}
            onReplaced={replace}
            emptyText="This document has no text yet."
            afterBody={
              <section
                aria-labelledby="document-files-heading"
                className="space-y-3"
                data-ui-bridge-id="overview.document.files-section"
              >
                <h2
                  id="document-files-heading"
                  className="font-[family-name:var(--font-overview-serif)] text-lg text-foreground"
                >
                  Attached files
                </h2>
                <FilesPanel
                  files={attachments.list}
                  canEdit={canEditFiles}
                  pageId={state.page.id}
                  onChanged={attachments.reload}
                  emptyText="No file is attached to this document."
                  uiBridgeId="overview.document.files"
                />
              </section>
            }
            uiBridgeId="overview.document"
          />
        </>
      )}
    </article>
  );
}
