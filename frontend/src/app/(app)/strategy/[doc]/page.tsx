"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  listStrategyDocs,
  getStrategyDoc,
  type StrategyDoc,
  type StrategyDocSummary,
} from "@/lib/api/strategy";
import { StrategySidebar } from "../_components/StrategySidebar";

/**
 * /strategy/[doc] — read-only Markdown viewer + git provenance.
 * Phase 1: no comments panel / composer / mention rendering (Phase 2).
 */
export default function StrategyDocPage() {
  const params = useParams<{ doc: string }>();
  const name = decodeURIComponent(params.doc);

  const [docs, setDocs] = useState<StrategyDocSummary[]>([]);
  const [doc, setDoc] = useState<StrategyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStrategyDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => {
    setDoc(null);
    setError(null);
    getStrategyDoc(name)
      .then(setDoc)
      .catch((e) => setError(e.message));
  }, [name]);

  return (
    <div className="flex h-full">
      <StrategySidebar docs={docs} activeName={name} />
      <main className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-6 text-sm text-destructive">
            Failed to load “{name}”: {error}
          </div>
        ) : doc === null ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <article className="mx-auto max-w-3xl px-8 py-6">
            <header className="mb-4 border-b border-border pb-3">
              <h1 className="text-2xl font-semibold">{doc.title}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {doc.provenance.commit_sha.slice(0, 8)} ·{" "}
                {doc.provenance.author} · {doc.provenance.committed_at}
              </p>
            </header>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.content}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
