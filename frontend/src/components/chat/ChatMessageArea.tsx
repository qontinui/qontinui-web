"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/hooks/useChatWebSocket";

interface ChatMessageAreaProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
}

export function ChatMessageArea({
  messages,
  streamingContent,
  isStreaming,
}: ChatMessageAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLenRef = useRef(0);

  // Auto-scroll on new content
  useEffect(() => {
    const totalLen = messages.length + streamingContent.length;
    if (autoScroll && totalLen !== prevLenRef.current) {
      prevLenRef.current = totalLen;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
  }, [messages, streamingContent, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div
      data-ui-id="chat-messages"
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-2 py-4"
    >
      {messages.length === 0 && !streamingContent && (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <Bot className="size-12 mb-3 opacity-30" />
          <p className="text-sm">Start a conversation with Claude</p>
          <p className="text-xs mt-1 opacity-60">
            Discuss features, plan workflows, then generate them
          </p>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} index={i} />
      ))}

      {/* Streaming indicator */}
      {isStreaming && streamingContent && (
        <div
          data-ui-id="chat-messages-streaming"
          className="flex gap-3 items-start"
        >
          <div className="shrink-0 w-7 h-7 rounded-full bg-purple-900/50 flex items-center justify-center">
            <Bot className="size-4 text-purple-400" />
          </div>
          <div className="max-w-[85%] rounded-lg px-4 py-3 bg-surface-raised/30 border border-border-subtle/30">
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
            </div>
            <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {/* Streaming with no content yet */}
      {isStreaming && !streamingContent && (
        <div
          data-ui-id="chat-messages-streaming"
          className="flex gap-3 items-start"
        >
          <div className="shrink-0 w-7 h-7 rounded-full bg-purple-900/50 flex items-center justify-center">
            <Bot className="size-4 text-purple-400" />
          </div>
          <div className="rounded-lg px-4 py-3 bg-surface-raised/30 border border-border-subtle/30">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          data-ui-id="chat-messages-scroll-btn"
          onClick={scrollToBottom}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-surface-raised border border-border-subtle/50 text-text-secondary text-xs hover:bg-surface-hover flex items-center gap-1.5 shadow-lg"
        >
          <ArrowDown className="size-3" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  index,
}: {
  message: ChatMessage;
  index: number;
}) {
  if (message.role === "user") {
    return (
      <div
        data-ui-id={`chat-message-user-${index}`}
        className="flex gap-3 items-start justify-end"
      >
        <div className="max-w-[85%] rounded-lg px-4 py-3 bg-brand-primary/10 border border-brand-primary/30">
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
        <div className="shrink-0 w-7 h-7 rounded-full bg-brand-primary/20 flex items-center justify-center">
          <User className="size-4 text-brand-primary" />
        </div>
      </div>
    );
  }

  return (
    <div
      data-ui-id={`chat-message-ai-${index}`}
      className="flex gap-3 items-start"
    >
      <div className="shrink-0 w-7 h-7 rounded-full bg-purple-900/50 flex items-center justify-center">
        <Bot className="size-4 text-purple-400" />
      </div>
      <div className="max-w-[85%] rounded-lg px-4 py-3 bg-surface-raised/30 border border-border-subtle/30">
        <div className="prose prose-invert prose-sm max-w-none [&_pre]:bg-black/30 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:text-purple-300 [&_code]:text-xs [&_a]:text-brand-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
