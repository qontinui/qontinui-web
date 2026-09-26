"use client";

/**
 * One wiki page. A link to a page nobody has written arrives here too
 * (`?create=<title>`), where an editor is offered to write it.
 */

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useFocusAfterRender } from "@/components/overview/editing/focus";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { formatRelativeTime } from "@/lib/time-utils";
import { NewPageForm } from "../../_components/NewPageForm";
import { PageBody, useWikiLinkOptions } from "../../_components/PageBody";
import { TitleEditor } from "../../_components/TitleEditor";
import { useOverviewProject } from "../../_hooks/useOverviewProject";
import { usePage, useWikiSlugs } from "../../_hooks/usePages";
import { pageHref } from "../../_lib/pages";
import { slugify, wikiHref } from "@/components/overview/wiki-links";

function BackToIndex() {
  return (
    <Link
      href="/overview/wiki"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      data-ui-bridge-id="overview.wiki-page.back"
    >
      All wiki pages
    </Link>
  );
}

/** The route's slug as text. Decoded defensively: a slug never contains
 *  `%`, so decoding a segment that is already text changes nothing. */
function segment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// `useSearchParams` needs a Suspense boundary above it.
export default function WikiPageRoute() {
  return (
    <Suspense>
      <WikiPageView />
    </Suspense>
  );
}

function WikiPageView() {
  const params = useParams<{ slug: string }>();
  const slug = segment(params.slug);
  const createTitle = useSearchParams().get("create");
  const router = useRouter();
  const { projectId, hold, tenantsError, viewerId } = useOverviewProject();
  const canEdit = useCanEdit("pages");
  const { state, replace, save } = usePage(
    { kind: "wiki", slug },
    { hold, reloadKey: projectId }
  );
  const wikiSlugs = useWikiSlugs({ hold, reloadKey: projectId });
  const wikiLinks = useWikiLinkOptions(wikiSlugs, canEdit);
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const doneRenaming = () => {
    setRenaming(false);
    // Back to where the writer started, not the top of the page.
    focusAfterRender(renameButton);
  };

  // A hand-typed or hand-linked address (`/overview/wiki/Getting Started`)
  // moves to the page's own, so the address bar and every link agree.
  const canonical = slugify(slug);
  useEffect(() => {
    if (canonical && canonical !== slug) {
      router.replace(
        wikiHref(canonical, createTitle ? { title: createTitle } : undefined)
      );
    }
  }, [canonical, slug, createTitle, router]);

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.wiki-page.tenants.error"
      />
    );
  }

  return (
    <article
      className="max-w-[48rem] space-y-6"
      data-ui-bridge-id="overview.wiki-page"
    >
      <BackToIndex />
      {state.state === "loading" && (
        <p className="text-sm text-muted-foreground">Loading the page…</p>
      )}
      {state.state === "error" && (
        <LoadFailure
          what="this wiki page"
          message={state.message}
          uiBridgeId="overview.wiki-page.error"
        />
      )}
      {state.state === "missing" && (
        <section data-ui-bridge-id="overview.wiki-page.missing">
          <h2 className="font-[family-name:var(--font-overview-serif)] text-2xl text-foreground">
            {createTitle ?? slug}
          </h2>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Nobody has written this page yet.
          </p>
          {canEdit && (
            <div className="mt-4">
              <NewPageForm
                kind="wiki"
                initialTitle={createTitle ?? ""}
                onCreated={(page) => {
                  // The same address would not re-read: show it directly.
                  if (page.slug === canonical) replace(page);
                  // Replace, not push: the address already names this page
                  // (or, renamed in the form, the one it now names).
                  router.replace(pageHref(page));
                }}
                uiBridgeId="overview.wiki-page.create"
              />
            </div>
          )}
        </section>
      )}
      {state.state === "ready" && (
        <>
          <header>
            {renaming ? (
              <TitleEditor
                page={state.page}
                save={save}
                onDone={doneRenaming}
                uiBridgeId="overview.wiki-page.rename"
              />
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2
                  className="font-[family-name:var(--font-overview-serif)] text-3xl leading-tight text-foreground"
                  data-ui-bridge-id="overview.wiki-page.title"
                >
                  {state.page.title}
                </h2>
                {canEdit && (
                  <button
                    ref={renameButton}
                    type="button"
                    onClick={() => setRenaming(true)}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-ui-bridge-id="overview.wiki-page.rename-open"
                  >
                    Rename
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Edited {formatRelativeTime(state.page.updated_at)}
              {state.page.updated_by ? ` by ${state.page.updated_by}` : ""}
              {canEdit && (
                <>
                  {" · "}Link to it with{" "}
                  <code className="text-xs">[[{state.page.slug}]]</code>
                </>
              )}
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
            emptyText="This page has no text yet."
            uiBridgeId="overview.wiki-page"
          />
        </>
      )}
    </article>
  );
}
