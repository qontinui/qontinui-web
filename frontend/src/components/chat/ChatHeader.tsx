"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare, X, Check, Pencil, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatSessionState } from "@/hooks/useChatWebSocket";

interface ChatHeaderProps {
  sessionName: string;
  sessionState: ChatSessionState;
  isRunnerConnected: boolean;
  onRename: (name: string) => void;
  onClose: () => void;
}

export function ChatHeader({
  sessionName,
  sessionState,
  isRunnerConnected,
  onRename,
  onClose,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(sessionName);
  const [prevSessionName, setPrevSessionName] = useState(sessionName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset edit value when session name changes (adjust state during render)
  if (sessionName !== prevSessionName) {
    setPrevSessionName(sessionName);
    setEditValue(sessionName);
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== sessionName) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editValue, sessionName, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        setEditValue(sessionName);
        setIsEditing(false);
      }
    },
    [handleSave, sessionName]
  );

  const stateBadge = (() => {
    switch (sessionState) {
      case "ready":
        return (
          <Badge
            variant="outline"
            className="bg-green-900/30 border-green-800/50 text-green-400 text-[10px]"
          >
            Ready
          </Badge>
        );
      case "processing":
        return (
          <Badge
            variant="outline"
            className="bg-amber-900/30 border-amber-800/50 text-amber-400 text-[10px]"
          >
            Processing
          </Badge>
        );
      case "disconnected":
        return (
          <Badge
            variant="outline"
            className="bg-red-900/30 border-red-800/50 text-red-400 text-[10px]"
          >
            Disconnected
          </Badge>
        );
      case "closed":
        return (
          <Badge
            variant="outline"
            className="bg-zinc-900/30 border-zinc-700/50 text-zinc-400 text-[10px]"
          >
            Closed
          </Badge>
        );
      default:
        return null;
    }
  })();

  return (
    <div
      data-ui-id="chat-header"
      className="flex items-center justify-between px-4 py-3 border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3">
        <MessageSquare className="size-5 text-purple-400" />

        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="bg-surface-canvas border border-border-subtle/50 rounded px-2 py-0.5 text-sm text-text-primary focus:outline-none focus:border-brand-primary/50"
              maxLength={60}
            />
            <button
              onClick={handleSave}
              className="text-green-400 hover:text-green-300"
            >
              <Check className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            data-ui-id="chat-header-name"
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-text-primary hover:text-text-secondary group"
          >
            {sessionName}
            <Pencil className="size-3 opacity-0 group-hover:opacity-60" />
          </button>
        )}

        <span data-ui-id="chat-header-state">{stateBadge}</span>

        <span
          data-ui-id="chat-header-runner-status"
          className="flex items-center gap-1 text-[10px]"
        >
          {isRunnerConnected ? (
            <>
              <Wifi className="size-3 text-green-400" />
              <span className="text-green-400">Runner</span>
            </>
          ) : (
            <>
              <WifiOff className="size-3 text-red-400" />
              <span className="text-red-400">Runner offline</span>
            </>
          )}
        </span>
      </div>

      <Button
        data-ui-id="chat-header-close-btn"
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-7 w-7 p-0 text-text-muted hover:text-red-400"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
