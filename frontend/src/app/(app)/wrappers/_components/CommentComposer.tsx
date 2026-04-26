"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CommentComposerProps {
  onSubmit: (body: string) => Promise<void> | void;
  isSubmitting?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export function CommentComposer({
  onSubmit,
  isSubmitting = false,
  placeholder = "Share your thoughts about this wrapper…",
  submitLabel = "Post comment",
  onCancel,
  autoFocus,
  className,
}: CommentComposerProps) {
  const [body, setBody] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || isSubmitting) return;
    await onSubmit(trimmed);
    setBody("");
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-2", className)}>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        disabled={isSubmitting}
        className="resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!body.trim() || isSubmitting}>
          {isSubmitting ? "Posting…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
