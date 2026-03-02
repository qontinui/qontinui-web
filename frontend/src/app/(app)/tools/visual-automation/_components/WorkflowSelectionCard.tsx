import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Play, Search, AlertCircle, CheckCircle2 } from "lucide-react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface WorkflowSelectionCardProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  workflowsLoading: boolean;
  workflowsError: string | null;
  filteredWorkflows: UnifiedWorkflow[];
  selectedWorkflowId: string | null;
  onSelectWorkflow: (id: string | null) => void;
}

export function WorkflowSelectionCard({
  searchQuery,
  onSearchChange,
  workflowsLoading,
  workflowsError,
  filteredWorkflows,
  selectedWorkflowId,
  onSelectWorkflow,
}: WorkflowSelectionCardProps) {
  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle className="text-lg text-white flex items-center gap-2">
          <Play className="w-5 h-5" />
          Select Workflow
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Choose a workflow to execute on the connected runner
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
          />
        </div>

        {workflowsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-muted/50 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : workflowsError ? (
          <div className="flex items-center gap-2 text-red-400 py-4">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">Failed to load workflows</p>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="text-center py-8">
            <Play className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? "No workflows match your search"
                : "No workflows available. Create one in the automation builder."}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {filteredWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() =>
                  onSelectWorkflow(
                    selectedWorkflowId === workflow.id ? null : workflow.id
                  )
                }
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  selectedWorkflowId === workflow.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {workflow.name}
                    </p>
                    {workflow.description && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {workflow.description}
                      </p>
                    )}
                  </div>
                  {selectedWorkflowId === workflow.id && (
                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 ml-3" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
