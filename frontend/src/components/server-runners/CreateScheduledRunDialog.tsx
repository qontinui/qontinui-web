"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Loader2, Server } from "lucide-react";
import {
  useCreateScheduledRun,
  useUpdateScheduledRun,
  useRunners,
} from "@/hooks/useServerRunners";
import { describeCron } from "./cron-preview";
import type {
  CreateScheduledRunRequest,
  ScheduledWorkflowRun,
} from "@/types/server-runner";

interface CreateScheduledRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected workflow id. Hides the workflow field if provided. */
  workflowId?: string;
  /** Fallback list of workflows to pick from when workflowId isn't fixed. */
  workflows?: Array<{ id: string; name: string }>;
  /** If set, dialog edits this existing schedule instead of creating. */
  editing?: ScheduledWorkflowRun | null;
}

const DEFAULT_CRON = "0 * * * *";

export function CreateScheduledRunDialog({
  open,
  onOpenChange,
  workflowId,
  workflows,
  editing,
}: CreateScheduledRunDialogProps) {
  const isEdit = Boolean(editing);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cron, setCron] = useState(DEFAULT_CRON);
  const [target, setTarget] = useState<string>("auto");
  const [enabled, setEnabled] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    workflowId ?? ""
  );

  const { data: runners } = useRunners();
  const createMutation = useCreateScheduledRun();
  const updateMutation = useUpdateScheduledRun();

  const healthyRunners = useMemo(() => {
    if (!runners) return [];
    return runners.filter((r) => r.server_mode);
  }, [runners]);

  // Reset / hydrate when dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? "");
      setCron(editing.cron_expression);
      setTarget(editing.target);
      setEnabled(editing.enabled);
      setSelectedWorkflowId(editing.workflow_id);
    } else {
      setName("");
      setDescription("");
      setCron(DEFAULT_CRON);
      setTarget("auto");
      setEnabled(true);
      setSelectedWorkflowId(workflowId ?? "");
    }
  }, [open, editing, workflowId]);

  const cronPreview = useMemo(() => describeCron(cron), [cron]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !cron.trim() || !selectedWorkflowId) return;
    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: {
            name: name.trim(),
            description: description.trim() || null,
            cron_expression: cron.trim(),
            target,
            enabled,
          },
        });
      } else {
        const payload: CreateScheduledRunRequest = {
          workflow_id: selectedWorkflowId,
          name: name.trim(),
          cron_expression: cron.trim(),
          target,
          enabled,
        };
        if (description.trim()) payload.description = description.trim();
        await createMutation.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      // Toast handled in hook.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface-raised border-border-subtle sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-primary" />
            {isEdit ? "Edit schedule" : "Create schedule"}
          </DialogTitle>
          <DialogDescription>
            Cron-style recurring dispatch. Schedules are interpreted in UTC.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nightly smoke test"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-description">Description (optional)</Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this schedule does"
            />
          </div>

          {!workflowId && !isEdit && (
            <div className="space-y-2">
              <Label htmlFor="schedule-workflow">Workflow</Label>
              <Select
                value={selectedWorkflowId}
                onValueChange={setSelectedWorkflowId}
              >
                <SelectTrigger id="schedule-workflow">
                  <SelectValue placeholder="Pick a workflow" />
                </SelectTrigger>
                <SelectContent>
                  {(workflows ?? []).map((wf) => (
                    <SelectItem key={wf.id} value={wf.id}>
                      {wf.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="schedule-cron">Cron expression</Label>
            <Input
              id="schedule-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="e.g. 0 9 * * *"
              required
              className="font-mono"
              aria-describedby="schedule-cron-preview"
            />
            <p id="schedule-cron-preview" className="text-xs text-text-muted">
              {cronPreview || "Enter a 5-field cron expression"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-target">Target runner</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="schedule-target">
                <SelectValue placeholder="Pick a target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <span className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-brand-primary" />
                    Auto (any healthy runner)
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
          </div>

          <div className="flex items-center justify-between rounded-md border border-border-subtle p-3">
            <div>
              <Label htmlFor="schedule-enabled" className="text-sm">
                Enabled
              </Label>
              <p className="text-xs text-text-muted">
                Disabled schedules will not fire until re-enabled.
              </p>
            </div>
            <Switch
              id="schedule-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="border-border-default"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || !name.trim() || !cron.trim() || !selectedWorkflowId
              }
              className="bg-brand-primary hover:bg-brand-primary/80 text-black"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEdit ? "Saving..." : "Creating..."}
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create schedule"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
