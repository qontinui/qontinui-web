"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatSessionState } from "@/hooks/useChatWebSocket";

interface ChatInputProps {
  sessionState: ChatSessionState;
  onSendMessage: (content: string) => void;
  onInterrupt: () => void;
  onGenerateWorkflow: () => void;
  isGeneratingWorkflow: boolean;
  messageCount: number;
  disabled?: boolean;
}

export function ChatInput({
  sessionState,
  onSendMessage,
  onInterrupt,
  onGenerateWorkflow,
  isGeneratingWorkflow,
  messageCount,
  disabled,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend =
    !disabled &&
    message.trim().length > 0 &&
    (sessionState === "ready" || sessionState === "processing");

  const canInterrupt = sessionState === "processing";
  const showGenerateWorkflow = messageCount >= 2;

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [message, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (canSend) {
          handleSend();
        }
      }
    },
    [canSend, handleSend]
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [message]);

  const stateLabel =
    sessionState === "ready"
      ? "Ready"
      : sessionState === "processing"
        ? "Processing..."
        : sessionState === "connecting"
          ? "Connecting..."
          : sessionState === "disconnected"
            ? "Disconnected"
            : sessionState === "closed"
              ? "Session Closed"
              : "";

  const stateColor =
    sessionState === "ready"
      ? "text-green-400"
      : sessionState === "processing"
        ? "text-amber-400"
        : "text-text-muted";

  return (
    <div
      data-ui-id="chat-input"
      className="border-t border-border-subtle/50 p-4"
    >
      {/* State indicator and toolbar */}
      <div className="flex items-center justify-between mb-2">
        <span data-ui-id="chat-input-state" className={`text-xs ${stateColor}`}>
          {stateLabel}
        </span>
        <div className="flex items-center gap-2">
          {showGenerateWorkflow && (
            <Button
              data-ui-id="chat-input-generate-workflow-btn"
              variant="outline"
              size="sm"
              onClick={onGenerateWorkflow}
              disabled={isGeneratingWorkflow || disabled}
              className="text-xs h-7 px-2.5 gap-1.5 border-purple-800/50 text-purple-300 hover:bg-purple-900/30 hover:text-purple-200"
            >
              {isGeneratingWorkflow ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {isGeneratingWorkflow ? "Generating..." : "Generate Workflow"}
            </Button>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <textarea
          data-ui-id="chat-input-textarea"
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionState === "disconnected"
              ? "Disconnected from runner..."
              : sessionState === "closed"
                ? "Session is closed"
                : "Type a message... (Enter to send, Shift+Enter for newline)"
          }
          disabled={
            disabled ||
            sessionState === "disconnected" ||
            sessionState === "closed"
          }
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border-subtle/50 bg-surface-canvas/50 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: "42px", maxHeight: "120px" }}
        />

        {canInterrupt ? (
          <Button
            data-ui-id="chat-input-interrupt-btn"
            variant="outline"
            size="sm"
            onClick={onInterrupt}
            className="h-[42px] px-3 border-amber-800/50 text-amber-400 hover:bg-amber-900/30"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            data-ui-id="chat-input-send-btn"
            size="sm"
            onClick={handleSend}
            disabled={!canSend}
            className="h-[42px] px-3 bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-30"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
