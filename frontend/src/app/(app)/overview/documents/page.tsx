"use client";

/**
 * Documents: briefs, delivery plans, contracts and reports. Two kinds side by
 * side — documents written here (versioned, with a number, status and owner)
 * and files uploaded as they are — searched together.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { useResourceList } from "@/components/overview/editing/useResource";
import { formatRelativeTime } from "@/lib/time-utils";
import { FilesPanel } from "../_components/FilesPanel";
import { NewPageForm } from "../_components/NewPageForm";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import {
  documentMeta,
  pageHref,
  type FileRecord,
  type PageRecord,
} from "../_lib/pages";

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function DocumentsPage() {
  const router = useRouter();
  const { projectId, hold, tenantsError } = useOverviewProject();
  const canEditPages = useCanEdit("pages");
  const canEditFiles = useCanEdit("files");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const pages = useResourceList<PageRecord>("pages", {
    params: q ? { kind: "document", q } : { kind: "document" },
    hold,
    reloadKey: projectId,
  });
  // Every document, unfiltered: an attached file names its document even
  // when a search has left that document out of the list above.
  const allDocuments = useResourceList<PageRecord>("pages", {
    params: { kind: "document" },
    hold,
    reloadKey: projectId,
  });
  const files = useResourceList<FileRecord>("files", {
    params: q ? { q } : undefined,
    hold,
    reloadKey: projectId,
  });
  const [creating, setCreating] = useState(false);

  // Attached files name their document.
  const titles = useMemo(() => {
    const map = new Map<string, PageRecord>();
    if (allDocuments.list.state === "ready") {
      for (const p of allDocuments.list.items) map.set(p.id, p);
    }
    return map;
  }, [allDocuments.list]);

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.documents.tenants.error"
      />
    );
  }

  return (
    <div className="space-y-8" data-ui-bridge-id="overview.documents">
      <div className="flex max-w-[48rem] flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="documents-search"
            className="text-sm text-muted-foreground"
          >
            Search documents and files
          </label>
          <Input
            id="documents-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A title, a phrase, a file name…"
            className="mt-1"
            data-ui-bridge-id="overview.documents.search"
          />
        </div>
        {canEditPages && !creating && (
          <Button
            onClick={() => setCreating(true)}
            data-ui-bridge-id="overview.documents.new"
          >
            New document
          </Button>
        )}
      </div>

      {creating && (
        <div className="max-w-[48rem]">
          <NewPageForm
            kind="document"
            onCreated={(page) => router.push(pageHref(page))}
            onCancel={() => setCreating(false)}
            uiBridgeId="overview.documents.new-form"
          />
        </div>
      )}

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <section
          aria-labelledby="documents-written-heading"
          data-ui-bridge-id="overview.documents.written"
        >
          <h2
            id="documents-written-heading"
            className="font-[family-name:var(--font-overview-serif)] text-xl text-foreground"
          >
            Written here
          </h2>
          <div className="mt-4">
            {pages.list.state === "loading" && (
              <p className="text-sm text-muted-foreground">
                Loading documents…
              </p>
            )}
            {pages.list.state === "error" && (
              <LoadFailure
                what="the documents"
                message={pages.list.message}
                announce={false}
                uiBridgeId="overview.documents.written.error"
              />
            )}
            {pages.list.state === "ready" &&
              (pages.list.items.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-ui-bridge-id="overview.documents.written.empty"
                >
                  {q
                    ? `No document mentions “${q}”.`
                    : "No document has been written here yet."}
                </p>
              ) : (
                <ul
                  className="divide-y divide-border rounded-md border border-border"
                  data-ui-bridge-id="overview.documents.written.list"
                >
                  {pages.list.items.map((page) => {
                    const meta = documentMeta(page);
                    return (
                      <li key={page.id} className="px-4 py-3">
                        <Link
                          href={pageHref(page)}
                          className="text-[15px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                          data-ui-bridge-id={`overview.documents.written.open-${page.id}`}
                        >
                          {page.title}
                        </Link>
                        {meta && (
                          <p className="mt-0.5 text-sm text-foreground">
                            {meta}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Edited {formatRelativeTime(page.updated_at)} · version{" "}
                          {page.version}
                        </p>
                        {page.excerpt && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {page.excerpt}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        </section>

        <section
          aria-labelledby="documents-uploaded-heading"
          data-ui-bridge-id="overview.documents.uploaded"
        >
          <h2
            id="documents-uploaded-heading"
            className="font-[family-name:var(--font-overview-serif)] text-xl text-foreground"
          >
            Uploaded
          </h2>
          <div className="mt-4">
            <FilesPanel
              files={files.list}
              canEdit={canEditFiles}
              onChanged={files.reload}
              attachedTo={(pageId) => {
                const page = titles.get(pageId);
                return page
                  ? { title: page.title, href: pageHref(page) }
                  : null;
              }}
              emptyText={
                q
                  ? `No file name matches “${q}”.`
                  : "No file has been uploaded yet."
              }
              uiBridgeId="overview.documents.files"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
