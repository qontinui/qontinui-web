"use client";

import * as React from "react";
import {
  MessageSquare,
  Reply,
  MoreVertical,
  Edit2,
  Trash2,
  Check,
  X,
  AtSign,
  Send,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar?: string;
  content: string;
  created_at: Date | string;
  updated_at?: Date | string;
  parent_id?: string;
  mentions?: string[];
  position?: { x: number; y: number };
}

export interface CommentThread {
  id: string;
  resource_id: string;
  resource_type: string;
  status: "open" | "resolved";
  comments: Comment[];
  position?: { x: number; y: number };
}

interface CommentThreadProps {
  thread: CommentThread;
  currentUserId: string;
  currentUserName: string;
  availableUsers?: Array<{ id: string; name: string }>;
  onAddComment: (content: string, parentId?: string) => Promise<void>;
  onEditComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onResolve: () => Promise<void>;
  onReopen: () => Promise<void>;
  className?: string;
}

const DEFAULT_AVAILABLE_USERS: Array<{ id: string; name: string }> = [];

export function CommentThread({
  thread,
  currentUserId,
  currentUserName: _currentUserName,
  availableUsers = DEFAULT_AVAILABLE_USERS,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onResolve,
  onReopen,
  className,
}: CommentThreadProps) {
  const [newComment, setNewComment] = React.useState("");
  const [replyToId, setReplyToId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  };

  const handleSubmit = async (content: string, parentId?: string) => {
    if (!content.trim()) return;

    setLoading(true);
    try {
      await onAddComment(content, parentId);
      setNewComment("");
      setReplyToId(null);
      toast.success("Comment added");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add comment"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editContent.trim()) return;

    setActionLoading(commentId);
    try {
      await onEditComment(commentId, editContent);
      setEditingId(null);
      setEditContent("");
      toast.success("Comment updated");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update comment"
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;

    setActionLoading(commentId);
    try {
      await onDeleteComment(commentId);
      toast.success("Comment deleted");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete comment"
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async () => {
    setLoading(true);
    try {
      if (thread.status === "resolved") {
        await onReopen();
        toast.success("Discussion reopened");
      } else {
        await onResolve();
        toast.success("Discussion resolved");
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update status"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTextChange = (text: string) => {
    setNewComment(text);

    // Check for @ mentions
    const lastAtIndex = text.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      const textAfterAt = text.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(" ")) {
        setMentionQuery(textAfterAt);
        setShowMentions(true);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (userName: string) => {
    const lastAtIndex = newComment.lastIndexOf("@");
    const newText = newComment.slice(0, lastAtIndex) + `@${userName} `;
    setNewComment(newText);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const filteredUsers = availableUsers.filter((user) =>
    user.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  // Organize comments by parent
  const rootComments = thread.comments.filter((c) => !c.parent_id);
  const getReplies = (parentId: string) =>
    thread.comments.filter((c) => c.parent_id === parentId);

  const commentNode = (comment: Comment, depth = 0) => {
    const isAuthor = comment.author_id === currentUserId;
    const isEditing = editingId === comment.id;
    const isLoading = actionLoading === comment.id;
    const replies = getReplies(comment.id);

    return (
      <div key={comment.id} className={cn(depth > 0 && "ml-8 mt-2")}>
        <div className="flex gap-3 group">
          <Avatar
            src={comment.author_avatar}
            fallback={
              <span className="text-xs font-medium">
                {getInitials(comment.author_name)}
              </span>
            }
            className="h-8 w-8 mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium">{comment.author_name}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(comment.created_at)}
              </span>
              {comment.updated_at &&
                comment.updated_at !== comment.created_at && (
                  <span className="text-xs text-muted-foreground">
                    (edited)
                  </span>
                )}
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[80px]"
                  disabled={isLoading}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleEdit(comment.id)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(null);
                      setEditContent("");
                    }}
                    disabled={isLoading}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {comment.content}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setReplyToId(comment.id)}
                  >
                    <Reply className="mr-1 h-3 w-3" />
                    Reply
                  </Button>
                  {isAuthor && !isLoading && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 px-2">
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditContent(comment.content);
                          }}
                        >
                          <Edit2 className="mr-2 h-3 w-3" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(comment.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-3 w-3" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </>
            )}

            {/* Reply Input */}
            {replyToId === comment.id && (
              <div className="mt-3 space-y-2">
                <Textarea
                  placeholder={`Reply to ${comment.author_name}...`}
                  value={newComment}
                  onChange={(e) => handleTextChange(e.target.value)}
                  className="min-h-[80px]"
                  disabled={loading}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleSubmit(newComment, comment.id)}
                    disabled={loading || !newComment.trim()}
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-3 w-3" />
                    )}
                    Reply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReplyToId(null);
                      setNewComment("");
                    }}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Nested Replies */}
        {replies.length > 0 && (
          <div className="mt-2 space-y-2">
            {replies.map((reply) => commentNode(reply, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn("flex flex-col bg-background border rounded-lg", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="text-sm font-medium">
            Discussion ({thread.comments.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              thread.status === "resolved"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-blue-500/10 text-blue-500 border-blue-500/20"
            }
          >
            {thread.status === "resolved" ? (
              <>
                <Check className="mr-1 h-3 w-3" />
                Resolved
              </>
            ) : (
              "Open"
            )}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleResolve}
            disabled={loading}
          >
            {thread.status === "resolved" ? "Reopen" : "Resolve"}
          </Button>
        </div>
      </div>

      {/* Comments */}
      <ScrollArea className="flex-1 p-3 max-h-[400px]">
        <div className="space-y-4">
          {rootComments.map((comment) => commentNode(comment))}
          {rootComments.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No comments yet. Start the discussion!
            </div>
          )}
        </div>
      </ScrollArea>

      {/* New Comment Input */}
      {!replyToId && thread.status === "open" && (
        <div className="p-3 border-t space-y-2">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              placeholder="Add a comment... (Use @ to mention someone)"
              value={newComment}
              onChange={(e) => handleTextChange(e.target.value)}
              className="min-h-[80px]"
              disabled={loading}
            />
            {showMentions && filteredUsers.length > 0 && (
              <div className="absolute bottom-full mb-1 w-full bg-popover border rounded-md shadow-lg max-h-[150px] overflow-y-auto z-50">
                {filteredUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => insertMention(user.name)}
                    className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm"
                  >
                    <AtSign className="h-3 w-3" />
                    {user.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            onClick={() => handleSubmit(newComment)}
            disabled={loading || !newComment.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding Comment...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Add Comment
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
