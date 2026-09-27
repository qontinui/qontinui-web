"use client";

/**
 * The wiki: the project's terms and topics, one page each, listed A–Z and
 * searchable. Pages link to each other with `[[Page Title]]`; a link to a page
 * nobody has written yet is how a new page usually starts.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useResourceList } from "@/components/overview/editing/useResource";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { alphabeticalIndex, pageHref, type PageRecord } from "../_lib/pages";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import { NewPageForm } from "../_components/NewPageForm";

/** Wait for a pause in typing before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function WikiPage() {
  const router = useRouter();
  const { projectId, hold, tenantsError } = useOverviewProject();
  const canEdit = useCanEdit("pages");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const { list } = useResourceList<PageRecord>("pages", {
    params: q ? { kind: "wiki", q } : { kind: "wiki" },
    hold,
    reloadKey: projectId,
  });
  const [creating, setCreating] = useState(false);

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.wiki.tenants.error"
      />
    );
  }

  const groups =
    list.state === "ready" && !q ? alphabeticalIndex(list.items) : [];

  return (
    <div className="max-w-[48rem] space-y-8" data-ui-bridge-id="overview.wiki">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="wiki-search"
            className="text-sm text-muted-foreground"
          >
            Search the wiki
          </label>
          <Input
            id="wiki-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A term, a topic, a phrase…"
            className="mt-1"
            data-ui-bridge-id="overview.wiki.search"
          />
        </div>
        {canEdit && !creating && (
          <Button
            onClick={() => setCreating(true)}
            data-ui-bridge-id="overview.wiki.new"
          >
            New page
          </Button>
        )}
      </div>

      {creating && (
        <NewPageForm
          kind="wiki"
          onCreated={(page) => router.push(pageHref(page))}
          onCancel={() => setCreating(false)}
          uiBridgeId="overview.wiki.new-form"
        />
      )}

      {list.state === "loading" && (
        <p className="text-sm text-muted-foreground">Loading the wiki…</p>
      )}
      {list.state === "error" && (
        <LoadFailure
          what="the wiki"
          message={list.message}
          uiBridgeId="overview.wiki.error"
        />
      )}

      {list.state === "ready" && q && (
        <section
          aria-label="Search results"
          data-ui-bridge-id="overview.wiki.results"
        >
          {list.items.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              No wiki page mentions &ldquo;{q}&rdquo;.
            </p>
          ) : (
            <ul className="space-y-4">
              {list.items.map((page) => (
                <li key={page.id}>
                  <Link
                    href={pageHref(page)}
                    className="text-[15px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-ui-bridge-id={`overview.wiki.result-${page.slug}`}
                  >
                    {page.title}
                  </Link>
                  {page.excerpt && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {page.excerpt}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {list.state === "ready" && !q && (
        <section
          aria-label="All pages, A to Z"
          data-ui-bridge-id="overview.wiki.index"
        >
          {groups.length === 0 ? (
            <p
              className="text-[15px] text-muted-foreground"
              data-ui-bridge-id="overview.wiki.empty"
            >
              {canEdit
                ? "Nobody has written a wiki page for this project yet. Start with the term people ask about most."
                : "Nobody has written a wiki page for this project yet."}
            </p>
          ) : (
            <>
              <nav
                aria-label="Jump to a letter"
                className="mb-6 flex flex-wrap gap-1"
              >
                {groups.map((g) => (
                  <a
                    key={g.letter}
                    href={`#wiki-${encodeURIComponent(g.letter)}`}
                    className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {g.letter}
                  </a>
                ))}
              </nav>
              <div className="space-y-8">
                {groups.map((g) => (
                  <section
                    key={g.letter}
                    id={`wiki-${g.letter}`}
                    aria-labelledby={`wiki-${g.letter}-heading`}
                  >
                    <h2
                      id={`wiki-${g.letter}-heading`}
                      className="font-[family-name:var(--font-overview-serif)] text-xl text-foreground"
                    >
                      {g.letter}
                    </h2>
                    <ul className="mt-2 space-y-3">
                      {g.items.map((page) => (
                        <li key={page.id}>
                          <Link
                            href={pageHref(page)}
                            className="text-[15px] text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            data-ui-bridge-id={`overview.wiki.page-${page.slug}`}
                          >
                            {page.title}
                          </Link>
                          {page.excerpt && (
                            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                              {page.excerpt}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
