"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  createThread,
  listThreads,
  type StrategyThread,
  type StrategyThreadDetail,
} from "@/lib/api/strategy";

import { PostComposer } from "./PostComposer";
import { ThreadView } from "./ThreadView";

interface CommentsPanelProps {
  docName: string;
  /** UUID of the currently signed-in user (forwarded to ThreadView). */
  currentUserId: string;
}

function threadsQueryKey(docName: string) {
  return ["strategy", "threads", docName] as const;
}

/**
 * Right-rail panel showing every thread for a strategy doc.
 *
 *  - Header shows unresolved-thread count
 *  - "+ new thread" composer (title + opening body)
 *  - Click a thread → opens `<ThreadView>` inline below the list
 *
 * Real-time refresh (Phase 2.4 WS) is intentionally NOT wired here —
 * just request/response over the existing proxy.
 */
export function CommentsPanel({ docName, currentUserId }: CommentsPanelProps) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [activeThread, setActiveThread] = useState<string | null>(null);

  const threadsQuery = useQuery<StrategyThread[]>({
    queryKey: threadsQueryKey(docName),
    queryFn: () => listThreads(docName),
  });

  const newThread = useMutation({
    mutationFn: ({
      title,
      body_markdown,
    }: {
      title: string;
      body_markdown: string;
    }) => createThread(docName, { title, body_markdown }),
    onMutate: async ({ title, body_markdown }) => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey(docName) });
      const prev = queryClient.getQueryData<StrategyThread[]>(
        threadsQueryKey(docName)
      );
      const optimistic: StrategyThread = {
        thread_id: `optimistic-${crypto.randomUUID()}`,
        doc_id: "",
        title,
        anchor: null,
        created_by: currentUserId,
        created_at: new Date().toISOString(),
        resolved_at: null,
        resolved_by: null,
        post_count: 1,
      };
      // Used by test seam too — silence the unused-var lint:
      void body_markdown;
      queryClient.setQueryData<StrategyThread[]>(threadsQueryKey(docName), [
        optimistic,
        ...(prev ?? []),
      ]);
      return { prev, optimisticId: optimistic.thread_id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(threadsQueryKey(docName), ctx.prev);
      }
      toast.error("Failed to create thread");
    },
    onSuccess: (server: StrategyThreadDetail, _vars, ctx) => {
      queryClient.setQueryData<StrategyThread[]>(
        threadsQueryKey(docName),
        (current) => {
          const list = current ?? [];
          return list.map((t) =>
            t.thread_id === ctx?.optimisticId ? server.thread : t
          );
        }
      );
      // Pre-seed the thread cache so opening it is instant.
      queryClient.setQueryData(
        ["strategy", "thread", server.thread.thread_id],
        server
      );
      setComposing(false);
      setTitle("");
      setActiveThread(server.thread.thread_id);
    },
  });

  const threads = threadsQuery.data ?? [];
  const unresolvedCount = threads.filter((t) => t.resolved_at === null).length;

  return (
    <aside
      data-testid="comments-panel"
      className="flex w-full flex-col border-l border-border md:w-96"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          Comments{" "}
          <span className="text-muted-foreground">
            ({unresolvedCount} open / {threads.length} total)
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setComposing((c) => !c)}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          data-testid="new-thread-button"
        >
          {composing ? "Close" : "+ New"}
        </button>
      </header>

      {composing && (
        <div className="border-b border-border p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Thread title"
            data-testid="new-thread-title"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <PostComposer
            placeholder="Opening comment… use @ to mention someone"
            submitLabel="Create thread"
            busy={newThread.isPending}
            onSubmit={(body) => {
              if (!title.trim()) {
                toast.error("Thread title required");
                return Promise.resolve();
              }
              return newThread
                .mutateAsync({
                  title: title.trim(),
                  body_markdown: body,
                })
                .then(
                  () => {},
                  () => {}
                );
            }}
            onCancel={() => {
              setComposing(false);
              setTitle("");
            }}
          />
        </div>
      )}

      {!activeThread ? (
        <ul className="flex-1 overflow-y-auto" data-testid="thread-list">
          {threadsQuery.isLoading && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              Loading…
            </li>
          )}
          {!threadsQuery.isLoading && threads.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              No threads yet. Start one with “+ New”.
            </li>
          )}
          {threads.map((t) => (
            <li key={t.thread_id}>
              <button
                type="button"
                onClick={() => setActiveThread(t.thread_id)}
                className={cn(
                  "block w-full px-4 py-2 text-left text-sm hover:bg-accent",
                  t.resolved_at !== null && "text-muted-foreground"
                )}
                data-testid={`thread-row-${t.thread_id}`}
              >
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.created_at).toLocaleString()}
                  {t.resolved_at !== null && " · resolved"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ThreadView
          threadId={activeThread}
          currentUserId={currentUserId}
          onClose={() => setActiveThread(null)}
        />
      )}
    </aside>
  );
}
