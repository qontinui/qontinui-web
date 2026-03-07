"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { DASHBOARD_API, POLL_INTERVAL_MS } from "./utils";

interface OutputViewerProps {
  runnerId: string;
  taskRunId: string;
}

/**
 * Live output viewer that fetches AI output from a runner via the backend proxy.
 * Polls every 5 seconds and auto-scrolls to the bottom.
 */
export function OutputViewer({ runnerId, taskRunId }: OutputViewerProps) {
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const fetchOutput = useCallback(async () => {
    try {
      const url = `${DASHBOARD_API}/fleet/runners/${encodeURIComponent(runnerId)}/output?task_run_id=${encodeURIComponent(taskRunId)}&tail_chars=8000`;
      const res = await fetch(url);

      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        setError(`Failed to fetch output: ${res.status} - ${text}`);
        return;
      }

      const data = await res.json();
      setOutput(data.output ?? data.text ?? JSON.stringify(data, null, 2));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch task output"
      );
    } finally {
      setLoading(false);
    }
  }, [runnerId, taskRunId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchOutput();
    const interval = setInterval(fetchOutput, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchOutput]);

  // Auto-scroll when output changes
  useEffect(() => {
    if (shouldAutoScroll.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [output]);

  if (loading && !output) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading output...
      </div>
    );
  }

  if (error && !output) {
    return (
      <div className="py-4 px-3 text-sm text-destructive bg-destructive/10 rounded-md">
        {error}
      </div>
    );
  }

  return (
    <ScrollArea
      className="h-[320px] rounded-md border border-border bg-black/80"
      onScrollCapture={() => {
        // Disable auto-scroll if user scrolls up
        const el = bottomRef.current;
        if (el) {
          const container = el.parentElement;
          if (container) {
            const atBottom =
              container.scrollHeight -
                container.scrollTop -
                container.clientHeight <
              40;
            shouldAutoScroll.current = atBottom;
          }
        }
      }}
    >
      <pre className="p-3 text-xs leading-relaxed font-mono text-green-400 whitespace-pre-wrap break-words">
        {output || "(no output yet)"}
        <div ref={bottomRef} />
      </pre>
    </ScrollArea>
  );
}
