"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  Send,
  Paperclip,
  AtSign,
  X,
  FileIcon,
  Download,
  User,
  Clock,
} from "lucide-react";
import { DeficiencyComment } from "@/types/deficiency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DeficiencyCommentsProps {
  deficiencyId: string;
  comments: DeficiencyComment[];
  onCommentAdd?: (
    content: string,
    mentions: string[],
    attachments: File[]
  ) => Promise<void>;
  className?: string;
}

/**
 * DeficiencyComments - Team comments and discussion
 *
 * Features:
 * - Add new comments with rich text
 * - @mention team members
 * - File attachments (images, documents)
 * - Comment thread chronological display
 * - User avatars and timestamps
 * - File download functionality
 * - Keyboard shortcuts (Ctrl+Enter to submit)
 */
export function DeficiencyComments({
  deficiencyId: _deficiencyId,
  comments,
  onCommentAdd,
  className,
}: DeficiencyCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      // Max 5MB per file
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`File ${file.name} is too large (max 5MB)`);
        return false;
      }
      return true;
    });
    setAttachments((prev) => [...prev, ...validFiles]);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!newComment.trim() && attachments.length === 0) {
      toast.error("Please enter a comment or attach a file");
      return;
    }

    if (!onCommentAdd) {
      toast.error("Comment submission not available");
      return;
    }

    setIsSubmitting(true);
    try {
      await onCommentAdd(newComment.trim(), mentions, attachments);
      setNewComment("");
      setAttachments([]);
      setMentions([]);
      toast.success("Comment added successfully");
    } catch (error) {
      toast.error("Failed to add comment");
      console.error("Comment submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit with Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Comments
        </CardTitle>
        <CardDescription>
          Collaborate with your team on this deficiency
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New Comment Form */}
        {onCommentAdd && (
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              placeholder="Add a comment... (use @username to mention someone, Ctrl+Enter to submit)"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              className="min-h-[100px] resize-y"
            />

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Attachments ({attachments.length})
                </p>
                <div className="space-y-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 rounded bg-muted/50 text-sm"
                    >
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAttachment(index)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.txt"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <Paperclip className="h-4 w-4 mr-2" />
                  Attach
                </Button>
                <span className="text-xs text-muted-foreground">
                  Max 5MB per file
                </span>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  (!newComment.trim() && attachments.length === 0)
                }
                size="sm"
              >
                {isSubmitting ? (
                  "Posting..."
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Post Comment
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Comments List */}
        <div className="space-y-4">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No comments yet. Be the first to add one!
            </p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <Avatar className="h-8 w-8">
                    <div className="h-full w-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  </Avatar>
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Comment Header */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {comment.user_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {comment.user_email}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                      {comment.updated_at !== comment.created_at && (
                        <Badge variant="outline" className="text-xs">
                          Edited
                        </Badge>
                      )}
                    </div>

                    {/* Comment Content */}
                    <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                      {comment.content}
                    </div>

                    {/* Mentions */}
                    {comment.mentions.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <AtSign className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Mentioned: {comment.mentions.length} user(s)
                        </span>
                      </div>
                    )}

                    {/* Attachments */}
                    {comment.attachments.length > 0 && (
                      <div className="space-y-2">
                        {comment.attachments.map((attachment, index) => (
                          <a
                            key={index}
                            href={attachment.url}
                            download={attachment.name}
                            className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <FileIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="flex-1 truncate">
                              {attachment.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatFileSize(attachment.size)}
                            </span>
                            <Download className="h-4 w-4 text-muted-foreground" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {comments.indexOf(comment) < comments.length - 1 && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
