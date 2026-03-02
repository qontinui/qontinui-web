import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity } from "lucide-react";
import type { WorkflowWithProject } from "../types";

interface PageHeaderProps {
  projects: string[];
  selectedProject: string;
  onProjectChange: (value: string) => void;
  workflows: WorkflowWithProject[];
  selectedWorkflowId: string | null;
  onWorkflowChange: (value: string) => void;
}

export function PageHeader({
  projects,
  selectedProject,
  onProjectChange,
  workflows,
  selectedWorkflowId,
  onWorkflowChange,
}: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">
          Workflow Visualization
        </h1>
      </div>
      <div className="flex gap-4 items-end">
        {projects.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Project</p>
            <Select value={selectedProject} onValueChange={onProjectChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project} value={project}>
                    {project}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Workflow</p>
          <Select
            value={selectedWorkflowId || ""}
            onValueChange={onWorkflowChange}
          >
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select workflow" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
