"use client";

import { useRef, useEffect } from "react";
import type { TaskRun } from "@/lib/runner";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PlayCircle, Lock, Hash } from "lucide-react";

function CompactRunCard({
  run,
  index,
  isSelected,
  onSelect,
}: {
  run: TaskRun;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { data: orchState } = useEventTriggeredFetch<{
    active_agent?: string;
    activity_type?: string;
    current_action?: string;
    is_paused?: boolean;
    bridges_count?: number;
    gui_locked?: boolean;
    plan_phase?: string;
    plan_total_phases?: number;
  }>("orchestrator-state-change", `/task-runs/${run.id}/orchestrator-state`, {
    fallbackPollMs: 10000,
  });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0",
        isSelected
          ? "bg-brand-primary/10 border border-brand-primary/40 text-text-primary"
          : "bg-surface-raised/50 border border-border-subtle/50 text-text-muted hover:border-border-default"
      )}
    >
      <span className="text-[9px] text-text-muted/50 font-mono">
        {index + 1}
      </span>

      <PlayCircle className="size-3 text-blue-500 animate-pulse" />
      <span
        className="font-medium truncate max-w-[120px]"
        data-content-role="label"
        data-content-label="active-run-name"
      >
        {run.task_name}
      </span>
      <Badge variant="outline" className="text-[10px]">
        {run.phase || "\u2014"}
      </Badge>

      {orchState?.gui_locked && <Lock className="size-3 text-amber-400" />}

      {orchState?.bridges_count != null && orchState.bridges_count > 0 && (
        <Badge
          variant="outline"
          className="text-[9px] gap-0.5 text-cyan-400 border-cyan-500/20"
        >
          <Hash className="size-2" />
          {orchState.bridges_count}
        </Badge>
      )}
    </button>
  );
}

export function ActiveRunsBar({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: TaskRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (runs.length <= 1) return;
      const currentIdx = runs.findIndex((r) => r.id === selectedRunId);

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : runs.length - 1;
        onSelect(runs[prev]!.id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIdx < runs.length - 1 ? currentIdx + 1 : 0;
        onSelect(runs[next]!.id);
      } else if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < runs.length) {
          onSelect(runs[idx]!.id);
        }
      } else if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const next = e.shiftKey
          ? currentIdx > 0
            ? currentIdx - 1
            : runs.length - 1
          : currentIdx < runs.length - 1
            ? currentIdx + 1
            : 0;
        onSelect(runs[next]!.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runs, selectedRunId, onSelect]);

  if (runs.length <= 1) return null;

  return (
    <div
      ref={containerRef}
      className="flex gap-2 px-4 py-2 bg-surface-canvas/50 border-b border-border-subtle/50 overflow-x-auto items-center"
    >
      {runs.map((run, idx) => (
        <CompactRunCard
          key={run.id}
          run={run}
          index={idx}
          isSelected={selectedRunId === run.id}
          onSelect={() => onSelect(run.id)}
        />
      ))}
    </div>
  );
}
