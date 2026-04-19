"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Rocket, Server } from "lucide-react";
import { toast } from "sonner";
import {
  useRunners,
  useDispatchWorkflow,
  DispatchError,
} from "@/hooks/useServerRunners";

interface DispatchWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName?: string;
  /** Navigation target. Defaults to /runs/{execution_id} — the existing run detail view. */
  executionRouteTemplate?: string;
}

const DEFAULT_ROUTE_TEMPLATE = "/runs/{execution_id}";

function dispatchErrorMessage(err: unknown): string {
  if (err instanceof DispatchError) {
    switch (err.status) {
      case 503:
        return "No healthy runners available. Register and start a server-mode runner from the Fleet page.";
      case 502:
        return "Runner unreachable. It may have just gone offline — try again, or pick a different target.";
      case 504:
        return "Runner timed out accepting the dispatch. Try again, or pick a different target.";
      case 409:
        return "Selected target is not a server-mode runner.";
      case 404:
        return "Workflow or runner not found (or not owned by you).";
      default:
        return err.message || "Failed to dispatch workflow.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Failed to dispatch workflow.";
}

export function DispatchWorkflowDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  executionRouteTemplate = DEFAULT_ROUTE_TEMPLATE,
}: DispatchWorkflowDialogProps) {
  const router = useRouter();
  const { data: runners, isLoading: runnersLoading } = useRunners();
  const [target, setTarget] = useState<string>("auto");
  const dispatchMutation = useDispatchWorkflow();

  const healthyRunners = useMemo(() => {
    if (!runners) return [];
    return runners.filter((r) => r.server_mode && r.status === "healthy");
  }, [runners]);

  const handleSubmit = async () => {
    try {
      const result = await dispatchMutation.mutateAsync({
        workflowId,
        data: { target },
      });
      toast.success(`Dispatched to ${result.runner_hostname}`, {
        description: `Execution ID: ${result.execution_id.slice(0, 8)}...`,
      });
      onOpenChange(false);
      const route = executionRouteTemplate.replace(
        "{execution_id}",
        encodeURIComponent(result.execution_id)
      );
      router.push(route);
    } catch (err) {
      toast.error(dispatchErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-raised border-border-subtle sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-brand-primary" />
            Dispatch to a runner
          </DialogTitle>
          <DialogDescription>
            Dispatches
            {workflowName ? (
              <>
                {" "}
                <strong className="text-white">{workflowName}</strong>
              </>
            ) : (
              " this workflow"
            )}{" "}
            to the selected runner. You will be redirected to the execution
            view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="dispatch-target">Target runner</Label>
          <Select
            value={target}
            onValueChange={setTarget}
            disabled={runnersLoading || dispatchMutation.isPending}
          >
            <SelectTrigger id="dispatch-target" aria-label="Target runner">
              <SelectValue placeholder="Select a runner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                <span className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-brand-primary" />
                  Auto (pick any healthy runner)
                </span>
              </SelectItem>
              {healthyRunners.map((runner) => (
                <SelectItem key={runner.id} value={runner.id}>
                  {runner.name}{" "}
                  <span className="text-text-muted">
                    ({runner.hostname}:{runner.port})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!runnersLoading && healthyRunners.length === 0 && (
            <p className="text-xs text-amber-400">
              No healthy server-mode runners found. Use Auto to still try (may
              fail with 503), or register one from the Fleet page.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={dispatchMutation.isPending}
            className="border-border-default"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={dispatchMutation.isPending}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            {dispatchMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Dispatching...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 mr-2" />
                Dispatch
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
