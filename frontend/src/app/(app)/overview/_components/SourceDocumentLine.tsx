"use client";

/** "Built from <document>": the delivery plan an estimate records as its
 *  source, named and linked. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ResourceError, getResource } from "@/components/overview/editing/api";
import type { PageRecord } from "../_lib/pages";

type State =
  | { state: "loading" }
  | { state: "ready"; title: string }
  /** The id no longer names a document here (the column has no FK). */
  | { state: "gone" }
  | { state: "error" };

export function SourceDocumentLine({
  pageId,
  uiBridgeId,
}: {
  pageId: string;
  uiBridgeId: string;
}) {
  const [doc, setDoc] = useState<State>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setDoc({ state: "loading" });
    getResource<PageRecord>("pages", pageId).then(
      ({ item }) => live && setDoc({ state: "ready", title: item.title }),
      (err: unknown) =>
        live &&
        setDoc(
          err instanceof ResourceError && err.status === 404
            ? { state: "gone" }
            : { state: "error" }
        )
    );
    return () => {
      live = false;
    };
  }, [pageId]);

  if (doc.state === "loading") return null;
  return (
    <p className="text-sm text-muted-foreground" data-ui-bridge-id={uiBridgeId}>
      {doc.state === "ready" && (
        <>
          Built from{" "}
          <Link
            href={`/overview/documents/${encodeURIComponent(pageId)}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {doc.title}
          </Link>
        </>
      )}
      {doc.state === "gone" &&
        "Built from a document that has since been deleted."}
      {doc.state === "error" &&
        "Built from a document whose name couldn’t be loaded right now."}
    </p>
  );
}
