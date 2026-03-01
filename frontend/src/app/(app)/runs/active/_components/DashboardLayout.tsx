"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TaskRun, CurrentExecutionStepsResponse } from "@/lib/runner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getWidgetConfig, type WidgetId } from "../_lib";
import { FullWidget } from "./WidgetPanel";
import { SummaryCard, SummaryContent } from "./SummaryCards";

const MIN_WIDTH = 30;
const MAX_WIDTH = 80;
const STORAGE_KEY = "qontinui-web-dashboard-panel-width";

export function DashboardLayout({
  activeWidget,
  summaryWidgets,
  runId,
  run,
  onWidgetClick,
  stepsData,
}: {
  activeWidget: WidgetId;
  summaryWidgets: WidgetId[];
  runId: string;
  run: TaskRun;
  onWidgetClick: (id: WidgetId) => void;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [leftWidthPercent, setLeftWidthPercent] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val >= MIN_WIDTH && val <= MAX_WIDTH) return val;
      }
    }
    return 65;
  });

  const isRunning = run.status === "running";
  const activeConfig = getWidgetConfig(activeWidget);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(leftWidthPercent));
  }, [leftWidthPercent]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      setLeftWidthPercent(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pct)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  if (summaryWidgets.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-4">
        <FullWidget
          widgetId={activeWidget}
          runId={runId}
          run={run}
          config={activeConfig}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 p-4 gap-0">
      <div className="min-h-0" style={{ width: `${leftWidthPercent}%` }}>
        <FullWidget
          widgetId={activeWidget}
          runId={runId}
          run={run}
          config={activeConfig}
        />
      </div>

      <div
        onMouseDown={handleMouseDown}
        className="w-1.5 mx-1 flex items-center justify-center cursor-col-resize group shrink-0"
      >
        <div className="w-0.5 h-12 bg-border-subtle/50 rounded-full group-hover:bg-white/30 group-hover:h-16 transition-all" />
      </div>

      <div className="min-h-0" style={{ width: `${100 - leftWidthPercent}%` }}>
        <ScrollArea className="h-full">
          <div className="space-y-3 pr-1">
            {summaryWidgets.map((widgetId) => {
              const config = getWidgetConfig(widgetId);
              return (
                <SummaryCard
                  key={widgetId}
                  config={config}
                  isRunning={isRunning}
                  onClick={() => onWidgetClick(widgetId)}
                >
                  <SummaryContent
                    widgetId={widgetId}
                    runId={runId}
                    run={run}
                    stepsData={stepsData}
                  />
                </SummaryCard>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
