"use client";

import { useEffect, useMemo, useState } from "react";
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
        return "Runner is not WebSocket-connected. Wait for it to reconnect, or pick a different runner.";
      case 502:
        return "Runner unreachable. It may have just gone offline — try again, or pick a different target.";
      case 504:
        return "Runner timed out accepting the dispatch. Try again, or pick a different target.";
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
  const [target, setTarget] = useState<string>("");
  const dispatchMutation = useDispatchWorkflow();

  // Anything healthy is dispatchable. The unified Runner shape doesn't
  // carry a server_mode flag — it's gone in Phase 2.
  const healthyRunners = useMemo(() => {
    if (!runners) return [];
    return runners.filter((r) => r.derivedStatus === "healthy");
  }, [runners]);

  // Auto-pick the first healthy runner when the dialog opens / runners load.
  useEffect(() => {
    if (!open) return;
    if (target) return;
    if (healthyRunners.length > 0) {
      setTarget(healthyRunners[0]!.id);
    }
  }, [open, healthyRunners, target]);

  const handleSubmit = async () => {
    if (!target) {
      toast.error("Pick a healthy runner first.");
      return;
    }
    try {
      const result = await dispatchMutation.mutateAsync({
        runnerId: target,
        data: { workflow_id: workflowId },
      });
      toast.success(`Dispatched to ${result.runner_name}`, {
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
              {healthyRunners.map((runner) => (
                <SelectItem key={runner.id} value={runner.id}>
                  <span className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-brand-primary" />
                    {runner.name}{" "}
                    {runner.hostname ? (
                      <span className="text-text-muted">
                        ({runner.hostname}
                        {runner.port ? `:${runner.port}` : ""})
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!runnersLoading && healthyRunners.length === 0 && (
            <p className="text-xs text-amber-400">
              No healthy runners found. Register or wake one and try again.
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
            disabled={dispatchMutation.isPending || !target}
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
