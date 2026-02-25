"use client";

import type { TaskRun } from "@/lib/runner-api";
import type { WidgetId, WidgetConfig } from "../_lib";
import { FullWidget } from "./WidgetPanel";

interface RunOutputPanelProps {
  widgetId: WidgetId;
  runId: string;
  run: TaskRun;
  config: WidgetConfig;
}

/**
 * Renders the primary active widget panel showing full content
 * (AI conversation, timeline, screenshots, etc.).
 */
export function RunOutputPanel({
  widgetId,
  runId,
  run,
  config,
}: RunOutputPanelProps) {
  return (
    <FullWidget widgetId={widgetId} runId={runId} run={run} config={config} />
  );
}
