"use client";

import React, { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { WrapperComment } from "../_api";
import { CommentComposer } from "./CommentComposer";

interface CommentThreadProps {
  comments: WrapperComment[];
  /**
   * Called when the signed-in user posts a reply. When omitted, the reply
   * affordance is hidden (e.g. for unauthenticated visitors).
   */
  onReply?: (parentId: number, body: string) => Promise<void> | void;
  isPostingReply?: boolean;
  /**
   * Maximum thread depth. v1 keeps this at 1 — replies to replies are flattened
   * into the same depth as their parent's siblings.
   */
  maxDepth?: number;
  className?: string;
}

interface ThreadedComment extends WrapperComment {
  children: ThreadedComment[];
}

function buildTree(comments: WrapperComment[]): ThreadedComment[] {
  const byId = new Map<number, ThreadedComment>();
  for (const c of comments) byId.set(c.id, { ...c, children: [] });

  const roots: ThreadedComment[] = [];
  for (const c of byId.values()) {
    if (c.parentId !== null && byId.has(c.parentId)) {
      const parent = byId.get(c.parentId);
      if (parent) {
        parent.children.push(c);
        continue;
      }
    }
    roots.push(c);
  }

  // Sort: oldest first within a level
  const sortRecursive = (list: ThreadedComment[]) => {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of list) sortRecursive(item.children);
  };
  sortRecursive(roots);

  return roots;
}

function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    if (Number.isNaN(diff) || diff < 0) return "";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  } catch {
    return "";
  }
}

interface NodeProps {
  comment: ThreadedComment;
  depth: number;
  maxDepth: number;
  onReply?: (parentId: number, body: string) => Promise<void> | void;
  isPostingReply: boolean;
}

function CommentNode({
  comment,
  depth,
  maxDepth,
  onReply,
  isPostingReply,
}: NodeProps) {
  const [replying, setReplying] = useState(false);

  const handleReply = async (body: string) => {
    if (!onReply) return;
    await onReply(comment.id, body);
    setReplying(false);
  };

  const canReply = !!onReply && depth < maxDepth;
  const initial = comment.user.name.charAt(0).toUpperCase() || "?";

  return (
    <div
      className={cn("space-y-2", depth > 0 && "pl-6 border-l border-border")}
    >
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 text-xs font-semibold text-white">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">
              {comment.user.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {timeAgo(comment.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {comment.body}
          </p>
          {canReply && !replying && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setReplying(true)}
            >
              <MessageCircle className="mr-1 h-3 w-3" />
              Reply
            </Button>
          )}
          {replying && (
            <div className="mt-2">
              <CommentComposer
                onSubmit={handleReply}
                isSubmitting={isPostingReply}
                onCancel={() => setReplying(false)}
                placeholder={`Reply to ${comment.user.name}…`}
                submitLabel="Post reply"
                autoFocus
              />
            </div>
          )}
        </div>
      </div>

      {comment.children.length > 0 && (
        <div className="space-y-3">
          {comment.children.map((child) => (
            <CommentNode
              key={child.id}
              comment={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              onReply={onReply}
              isPostingReply={isPostingReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentThread({
  comments,
  onReply,
  isPostingReply = false,
  maxDepth = 1,
  className,
}: CommentThreadProps) {
  const tree = useMemo(() => buildTree(comments), [comments]);

  if (tree.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground",
          className
        )}
      >
        No comments yet. Be the first to share your experience.
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      {tree.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          depth={0}
          maxDepth={maxDepth}
          onReply={onReply}
          isPostingReply={isPostingReply}
        />
      ))}
    </div>
  );
}
