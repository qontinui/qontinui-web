"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTaskRunOutput } from "@/lib/runner-api";
import { Button } from "@/components/ui/button";
import { RefreshCw, MessageSquare, ArrowDown } from "lucide-react";
import { parseOutputLog, computeStats } from "./_utils/ai-conversation-utils";
import { SegmentRenderer } from "./_components/ConversationSegments";
import { ConversationSummaryHeader } from "./_components/ConversationSummaryHeader";

interface AiConversationTabProps {
  runId: string;
}

export function AiConversationTab({ runId }: AiConversationTabProps) {
  const { data, isLoading, error } = useTaskRunOutput(runId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const segments = useMemo(() => {
    if (!data?.output_log) return [];
    return parseOutputLog(data.output_log);
  }, [data]);

  const stats = useMemo(() => computeStats(segments), [segments]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [segments, autoScroll]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading AI conversation...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (segments.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <MessageSquare className="size-12 mx-auto mb-4" />
        <p>No AI conversation output for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <ConversationSummaryHeader stats={stats} />
      </div>

      {/* Conversation Container */}
      <div className="relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-[650px] overflow-y-auto space-y-3 pr-2"
        >
          {segments.map((segment, index) => (
            <SegmentRenderer key={`seg-${index}`} segment={segment} />
          ))}
        </div>

        {/* Scroll to Bottom Button */}
        {!autoScroll && (
          <div className="absolute bottom-4 right-4">
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToBottom}
              className="rounded-full bg-surface-raised/80 border-border-subtle/80 shadow-lg"
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
