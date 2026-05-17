"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  createPost,
  editPost,
  getThread,
  resolveThread,
  softDeletePost,
  type StrategyPost,
  type StrategyThreadDetail,
} from "@/lib/api/strategy";

import { MentionAwareMarkdown } from "./MentionAwareMarkdown";
import { PostComposer } from "./PostComposer";
import { extractMentionedUserIds } from "./mention-marker";
import { useUserCache } from "./use-user-cache";

interface ThreadViewProps {
  threadId: string;
  /** UUID of the currently signed-in user (for author-only edit/delete UX). */
  currentUserId: string;
  /** Optional close handler (e.g. modal/sidebar collapse). */
  onClose?: () => void;
}

function threadQueryKey(threadId: string) {
  return ["strategy", "thread", threadId] as const;
}

/**
 * Renders a single thread with its posts in chronological order.
 *
 * Optimistic UX:
 *  - Reply submit: append a placeholder post with a client-side UUID;
 *    on server response replace it with the canonical row. On error,
 *    drop the placeholder + toast.
 *  - Edit: swap body in place, roll back on error.
 *  - Soft-delete: mark `deleted_at` locally, roll back on error.
 */
export function ThreadView({
  threadId,
  currentUserId,
  onClose,
}: ThreadViewProps) {
  const queryClient = useQueryClient();
  const userCache = useUserCache();

  const { data, isLoading, error } = useQuery<StrategyThreadDetail>({
    queryKey: threadQueryKey(threadId),
    queryFn: () => getThread(threadId),
  });

  // Prime the user cache with all mention-targets in this thread's
  // posts on first load. Subsequent renders re-use the cache.
  useEffect(() => {
    if (!data) return;
    const ids = new Set<string>();
    for (const post of data.posts) {
      for (const id of extractMentionedUserIds(post.body_markdown)) {
        ids.add(id);
      }
      ids.add(post.author_id);
    }
    if (ids.size > 0) {
      void userCache.prime(Array.from(ids));
    }
  }, [data, userCache]);

  // -- reply mutation (optimistic append) --------------------------------

  const reply = useMutation({
    mutationFn: (body_markdown: string) =>
      createPost(threadId, { body_markdown }),
    onMutate: async (body_markdown) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
      const prev = queryClient.getQueryData<StrategyThreadDetail>(
        threadQueryKey(threadId)
      );
      if (!prev) return { prev };
      const optimistic: StrategyPost = {
        post_id: `optimistic-${crypto.randomUUID()}`,
        thread_id: threadId,
        parent_post_id: null,
        author_id: currentUserId,
        body_markdown,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
      };
      queryClient.setQueryData<StrategyThreadDetail>(threadQueryKey(threadId), {
        ...prev,
        posts: [...prev.posts, optimistic],
      });
      return { prev, optimisticId: optimistic.post_id };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(threadQueryKey(threadId), ctx.prev);
      }
      toast.error("Failed to post reply");
    },
    onSuccess: (server, _vars, ctx) => {
      queryClient.setQueryData<StrategyThreadDetail>(
        threadQueryKey(threadId),
        (current) => {
          if (!current) return current;
          return {
            ...current,
            posts: current.posts.map((p) =>
              p.post_id === ctx?.optimisticId ? server : p
            ),
          };
        }
      );
    },
  });

  const resolve = useMutation({
    mutationFn: () => resolveThread(threadId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) }),
    onError: () => toast.error("Failed to resolve thread"),
  });

  if (isLoading) {
    return (
      <div
        data-testid="thread-view-loading"
        className="p-4 text-sm text-muted-foreground"
      >
        Loading thread…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load thread: {(error as Error)?.message ?? "unknown"}
      </div>
    );
  }

  const { thread, posts } = data;
  const isResolved = thread.resolved_at !== null;
  const canResolve =
    !isResolved &&
    (currentUserId === thread.created_by ||
      posts.some((p) => p.author_id === currentUserId));

  return (
    <div className="flex h-full flex-col" data-testid="thread-view">
      <header className="flex items-start justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{thread.title}</h3>
          {thread.anchor && (
            <p className="text-xs text-muted-foreground">
              Anchored to: {thread.anchor}
            </p>
          )}
          {isResolved && (
            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
              Resolved
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {canResolve && (
            <button
              type="button"
              onClick={() => resolve.mutate()}
              disabled={resolve.isPending}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              data-testid="thread-resolve"
            >
              Resolve
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close thread"
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <ul
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        data-testid="thread-post-list"
      >
        {posts.map((p) => (
          <PostRow
            key={p.post_id}
            post={p}
            isAuthor={p.author_id === currentUserId}
            threadId={threadId}
          />
        ))}
        {posts.length === 0 && (
          <li className="text-sm text-muted-foreground">No posts yet.</li>
        )}
      </ul>

      {!isResolved && (
        <div className="border-t border-border p-3">
          <PostComposer
            busy={reply.isPending}
            onSubmit={(body) =>
              reply.mutateAsync(body).then(
                () => {},
                () => {
                  // onError already toasts + rolls back optimistic state.
                  // Absorb here so the click handler doesn't leak an
                  // unhandled rejection.
                }
              )
            }
            submitLabel="Reply"
          />
        </div>
      )}
    </div>
  );
}

interface PostRowProps {
  post: StrategyPost;
  isAuthor: boolean;
  threadId: string;
}

function PostRow({ post, isAuthor, threadId }: PostRowProps) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const userCache = useUserCache();
  const author = userCache.get(post.author_id);
  const authorLabel = author?.display ?? "Unknown";

  const isDeleted = post.deleted_at !== null;
  const isOptimistic = post.post_id.startsWith("optimistic-");

  const editMut = useMutation({
    mutationFn: (body: string) => editPost(post.post_id, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({
        queryKey: ["strategy", "thread", threadId],
      });
      const key = ["strategy", "thread", threadId] as const;
      const prev = queryClient.getQueryData<StrategyThreadDetail>(key);
      if (!prev) return { prev };
      queryClient.setQueryData<StrategyThreadDetail>(key, {
        ...prev,
        posts: prev.posts.map((p) =>
          p.post_id === post.post_id
            ? { ...p, body_markdown: body, edited_at: new Date().toISOString() }
            : p
        ),
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["strategy", "thread", threadId], ctx.prev);
      }
      toast.error("Failed to save edit");
    },
    onSuccess: () => setEditing(false),
  });

  const deleteMut = useMutation({
    mutationFn: () => softDeletePost(post.post_id),
    onMutate: async () => {
      const key = ["strategy", "thread", threadId] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<StrategyThreadDetail>(key);
      if (!prev) return { prev };
      queryClient.setQueryData<StrategyThreadDetail>(key, {
        ...prev,
        posts: prev.posts.map((p) =>
          p.post_id === post.post_id
            ? { ...p, deleted_at: new Date().toISOString() }
            : p
        ),
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["strategy", "thread", threadId], ctx.prev);
      }
      toast.error("Failed to delete post");
    },
  });

  const created = useMemo(
    () => new Date(post.created_at).toLocaleString(),
    [post.created_at]
  );

  return (
    <li
      className={cn(
        "rounded-md border border-border p-3",
        isOptimistic && "opacity-70",
        isDeleted && "italic text-muted-foreground"
      )}
      data-testid={`post-row-${post.post_id}`}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{authorLabel}</span>
          {" · "}
          {created}
          {post.edited_at && " · edited"}
        </span>
        {isAuthor && !isDeleted && !isOptimistic && (
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="hover:text-foreground"
              data-testid={`post-edit-${post.post_id}`}
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              type="button"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="hover:text-destructive"
              data-testid={`post-delete-${post.post_id}`}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      {isDeleted ? (
        <p>[deleted]</p>
      ) : editing ? (
        <PostComposer
          initialValue={post.body_markdown}
          submitLabel="Save"
          cancelLabel="Cancel"
          busy={editMut.isPending}
          onSubmit={(body) =>
            editMut.mutateAsync(body).then(
              () => {},
              () => {}
            )
          }
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <MentionAwareMarkdown>{post.body_markdown}</MentionAwareMarkdown>
        </div>
      )}
    </li>
  );
}
