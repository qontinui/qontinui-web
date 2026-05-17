"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAuth } from "@/contexts/auth-context";
import {
  listStrategyDocs,
  getStrategyDoc,
  type StrategyDoc,
  type StrategyDocSummary,
} from "@/lib/api/strategy";
import { StrategySidebar } from "../_components/StrategySidebar";
import { PresenceIndicator } from "../_components/PresenceIndicator";
import { CommentsPanel } from "../_components/CommentsPanel";
import { usePresenceHeartbeat } from "@/lib/strategy/presence";

/**
 * /strategy/[doc] — Markdown viewer + collaborative comments panel
 * (Phase 2.3) + real-time presence indicator (Phase 2.4).
 *
 * - Right-rail `<CommentsPanel>` renders threads/posts/mention
 *   autocomplete on top of the read-only doc body. Doc bodies use
 *   plain ReactMarkdown; only post bodies route through
 *   `<MentionAwareMarkdown>` (post bodies carry `@[user_id:<uuid>]`
 *   markers; doc bodies don't).
 * - `usePresenceHeartbeat` drives the 30 s heartbeat ping to coord
 *   and `<PresenceIndicator>` renders the aggregate viewer count.
 */
export default function StrategyDocPage() {
  const params = useParams<{ doc: string }>();
  const name = decodeURIComponent(params.doc);
  const { user } = useAuth();

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

  // Strategy Phase 2.4 — drive presence heartbeats while the page is
  // mounted. Returns the resolved doc_id so <PresenceIndicator> can
  // subscribe to the per-doc aggregate channel.
  const presenceDocId = usePresenceHeartbeat({ docName: name });

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
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{doc.title}</h1>
                <PresenceIndicator docId={presenceDocId} />
              </div>
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
      {user && doc && <CommentsPanel docName={name} currentUserId={user.id} />}
    </div>
  );
}
