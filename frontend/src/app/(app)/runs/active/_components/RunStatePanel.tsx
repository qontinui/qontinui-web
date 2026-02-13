"use client";

import type { TaskRun, CurrentExecutionStepsResponse } from "@/lib/runner-api";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WidgetId } from "../_lib";
import { getWidgetConfig } from "../_lib";
import { SummaryCard, SummaryContent } from "./SummaryCards";

interface RunStatePanelProps {
  run: TaskRun;
  runId: string;
  summaryWidgets: WidgetId[];
  stepsData: CurrentExecutionStepsResponse | null;
  onWidgetClick: (id: WidgetId) => void;
}

/**
 * Renders the summary sidebar showing state of all detected widgets.
 */
export function RunStatePanel({
  run,
  runId,
  summaryWidgets,
  stepsData,
  onWidgetClick,
}: RunStatePanelProps) {
  const isRunning = run.status === "running";

  return (
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
  );
}
