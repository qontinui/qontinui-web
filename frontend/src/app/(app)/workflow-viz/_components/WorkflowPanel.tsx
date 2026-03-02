import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkflowStructurePanel } from "@/components/workflow-viz/WorkflowStructurePanel";
import type { WorkflowWithProject } from "../types";

interface WorkflowPanelProps {
  workflow: WorkflowWithProject;
  currentActionIndex: number;
  onActionSelect: (actionIndex: number, success: boolean) => void;
}

export function WorkflowPanel({
  workflow,
  currentActionIndex,
  onActionSelect,
}: WorkflowPanelProps) {
  return (
    <Card className="lg:col-span-1 flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="bg-muted px-2 py-0.5 rounded text-sm font-medium">
              Workflow
            </span>
            {workflow.name}
          </span>
          <Badge
            variant={
              workflow.metadata?.viewMode === "graph" ? "default" : "secondary"
            }
          >
            {workflow.metadata?.viewMode || "graph"}
          </Badge>
        </CardTitle>
        <CardDescription>{workflow.actions.length} action(s)</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <WorkflowStructurePanel
          workflow={workflow}
          currentActionIndex={currentActionIndex}
          onActionSelect={onActionSelect}
        />
      </CardContent>
    </Card>
  );
}
