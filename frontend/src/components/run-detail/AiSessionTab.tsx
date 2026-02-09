"use client";

import { useMemo, useState } from "react";
import { useTaskRunOutput } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw,
  MessageSquare,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

interface AiSessionTabProps {
  runId: string;
}

interface SessionChunk {
  sessionNumber: number;
  content: string;
}

function parseSessionChunks(outputLog: string): SessionChunk[] {
  const sessionRegex = /\[SESSION_START:(\d+)\]/g;
  const matches = [...outputLog.matchAll(sessionRegex)];

  if (matches.length === 0) {
    return [{ sessionNumber: 1, content: outputLog }];
  }

  const chunks: SessionChunk[] = [];

  // Content before the first session marker
  const firstMatch = matches[0];
  const firstIndex = firstMatch ? (firstMatch.index ?? 0) : 0;
  if (firstIndex > 0) {
    const preamble = outputLog.substring(0, firstIndex).trim();
    if (preamble) {
      chunks.push({ sessionNumber: 0, content: preamble });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match) continue;
    const captured = match[1] ?? "0";
    const sessionNumber = parseInt(captured, 10);
    const startIndex = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[i + 1];
    const endIndex = nextMatch
      ? (nextMatch.index ?? outputLog.length)
      : outputLog.length;
    const content = outputLog.substring(startIndex, endIndex).trim();
    if (content) {
      chunks.push({ sessionNumber, content });
    }
  }

  return chunks;
}

function SessionSection({ chunk }: { chunk: SessionChunk }) {
  const [isOpen, setIsOpen] = useState(chunk.sessionNumber <= 1);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 rounded-lg bg-surface-raised/30 border border-border-subtle/50 hover:bg-surface-raised/50 transition-colors">
        {isOpen ? (
          <ChevronDown className="size-4 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-text-muted shrink-0" />
        )}
        <Badge variant="info" className="text-xs">
          {chunk.sessionNumber === 0
            ? "Preamble"
            : `Session ${chunk.sessionNumber}`}
        </Badge>
        <span className="text-xs text-text-muted ml-auto">
          {chunk.content.length.toLocaleString()} chars
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-4 bg-surface-canvas/50 rounded-lg border border-border-subtle/30">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
            {chunk.content}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AiSessionTab({ runId }: AiSessionTabProps) {
  const { data, isLoading, error } = useTaskRunOutput(runId);

  const chunks = useMemo(() => {
    if (!data?.output_log) return [];
    return parseSessionChunks(data.output_log);
  }, [data]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading AI session data...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data?.output_log) {
    return (
      <div className="text-center py-12 text-text-muted">
        <MessageSquare className="size-12 mx-auto mb-4" />
        <p>No AI session data available for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">
          {chunks.length} session{chunks.length !== 1 ? "s" : ""}
        </Badge>
        <span className="text-xs text-text-muted">
          Total output: {data.output_log.length.toLocaleString()} chars
        </span>
      </div>

      <ScrollArea className="h-[700px]">
        <div className="space-y-3 pr-4">
          {chunks.map((chunk) => (
            <SessionSection key={chunk.sessionNumber} chunk={chunk} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
