"use client";

/** The pages that link here — by a `[[wiki link]]`, or by naming a document
 *  as related. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { readOverview } from "@/components/overview/editing/api";
import { pageHref, type PageRef } from "../_lib/pages";

type State =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; refs: PageRef[] };

export function Backlinks({
  pageId,
  reloadKey,
  uiBridgeId,
}: {
  pageId: string;
  /** Re-read when this changes (the page's version). */
  reloadKey: unknown;
  uiBridgeId: string;
}) {
  const [links, setLinks] = useState<State>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setLinks({ state: "loading" });
    readOverview<PageRef[]>(
      `pages/${encodeURIComponent(pageId)}/backlinks`
    ).then(
      (refs) => live && setLinks({ state: "ready", refs }),
      (err: unknown) =>
        live &&
        setLinks({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [pageId, reloadKey]);

  return (
    <section
      aria-labelledby={`${uiBridgeId}-heading`}
      className="text-sm"
      data-ui-bridge-id={uiBridgeId}
    >
      <h2
        id={`${uiBridgeId}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-lg text-foreground"
      >
        Linked from
      </h2>
      {links.state === "loading" && (
        <p className="mt-2 text-muted-foreground">Loading…</p>
      )}
      {links.state === "error" && (
        // Not "nothing links here": the list could not be read.
        <p className="mt-2 text-muted-foreground">
          The pages that link here couldn&rsquo;t be loaded right now.
        </p>
      )}
      {links.state === "ready" &&
        (links.refs.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            No other page links here yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {links.refs.map((ref) => (
              <li key={ref.id}>
                <Link
                  href={pageHref(ref)}
                  className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  data-ui-bridge-id={`${uiBridgeId}.link-${ref.slug}`}
                >
                  {ref.title}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">
                  {ref.kind === "wiki" ? "Wiki" : "Document"}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
