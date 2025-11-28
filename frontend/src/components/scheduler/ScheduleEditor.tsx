"use client";

import React, { useState, useEffect } from "react";
import { useAutomation } from "@/contexts/automation-context";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  Schedule,
  TriggerType,
  CheckMode,
  ScheduleType,
} from "@/contexts/automation-context";

interface ScheduleEditorProps {
  schedule: Schedule | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ScheduleEditor({
  schedule,
  isOpen,
  onClose,
}: ScheduleEditorProps) {
  const { workflows, addSchedule, updateSchedule } = useAutomation();

  const [formData, setFormData] = useState<Partial<Schedule>>({
    id: "",
    name: "",
    processId: "",
    description: "",
    triggerType: "MANUAL",
    checkMode: "CHECK_ALL",
    scheduleType: "FIXED_RATE",
    cronExpression: "",
    intervalSeconds: 60,
    triggerState: "",
    maxIterations: undefined,
    stateCheckDelaySeconds: 5,
    stateRebuildDelaySeconds: 10,
    failureThreshold: 3,
    enabled: true,
  });

  useEffect(() => {
    if (schedule) {
      setFormData(schedule);
    } else {
      // Reset to defaults for new schedule
      setFormData({
        id: `schedule-${Date.now()}`,
        name: "",
        processId: "",
        description: "",
        triggerType: "MANUAL",
        checkMode: "CHECK_ALL",
        scheduleType: "FIXED_RATE",
        cronExpression: "",
        intervalSeconds: 60,
        triggerState: "",
        maxIterations: undefined,
        stateCheckDelaySeconds: 5,
        stateRebuildDelaySeconds: 10,
        failureThreshold: 3,
        enabled: true,
        createdAt: new Date(),
      });
    }
  }, [schedule]);

  const handleSave = () => {
    if (!formData.name || !formData.processId) {
      alert("Please fill in all required fields");
      return;
    }

    const scheduleData: Schedule = {
      id: formData.id || `schedule-${Date.now()}`,
      name: formData.name,
      processId: formData.processId,
      description: formData.description || "",
      triggerType: formData.triggerType as TriggerType,
      checkMode: formData.checkMode as CheckMode,
      scheduleType: formData.scheduleType as ScheduleType,
      cronExpression: formData.cronExpression,
      intervalSeconds: formData.intervalSeconds,
      triggerState: formData.triggerState,
      maxIterations: formData.maxIterations,
      stateCheckDelaySeconds: formData.stateCheckDelaySeconds || 5,
      stateRebuildDelaySeconds: formData.stateRebuildDelaySeconds || 10,
      failureThreshold: formData.failureThreshold || 3,
      enabled: formData.enabled !== undefined ? formData.enabled : true,
      createdAt: formData.createdAt || new Date(),
      lastExecutedAt: formData.lastExecutedAt,
      projectName: formData.projectName,
    };

    if (schedule) {
      updateSchedule(scheduleData);
    } else {
      addSchedule(scheduleData);
    }

    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {schedule ? "Edit Schedule" : "Create New Schedule"}
          </DialogTitle>
          <DialogDescription>
            Configure automated process execution schedule
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Basic Information */}
            <div className="space-y-2">
              <Label htmlFor="name">Schedule Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Enter schedule name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Enter schedule description"
                rows={3}
              />
            </div>

            {/* Process Selection */}
            <div className="space-y-2">
              <Label htmlFor="processId">Process *</Label>
              <Select
                value={formData.processId}
                onValueChange={(value) =>
                  setFormData({ ...formData, processId: value })
                }
              >
                <SelectTrigger id="processId">
                  <SelectValue placeholder="Select a process" />
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

            {/* Trigger Configuration */}
            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Type</Label>
              <Select
                value={formData.triggerType}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    triggerType: value as TriggerType,
                  })
                }
              >
                <SelectTrigger id="triggerType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                  <SelectItem value="TIME">Time-based (Cron)</SelectItem>
                  <SelectItem value="INTERVAL">Interval-based</SelectItem>
                  <SelectItem value="STATE">State-based</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Conditional Trigger Fields */}
            {formData.triggerType === "TIME" && (
              <div className="space-y-2">
                <Label htmlFor="cronExpression">Cron Expression</Label>
                <Input
                  id="cronExpression"
                  value={formData.cronExpression}
                  onChange={(e) =>
                    setFormData({ ...formData, cronExpression: e.target.value })
                  }
                  placeholder="0 */5 * * * (every 5 minutes)"
                />
                <p className="text-xs text-muted-foreground">
                  Format: second minute hour day month weekday
                </p>
              </div>
            )}

            {formData.triggerType === "INTERVAL" && (
              <div className="space-y-2">
                <Label htmlFor="intervalSeconds">Interval (seconds)</Label>
                <Input
                  id="intervalSeconds"
                  type="number"
                  value={formData.intervalSeconds}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      intervalSeconds: parseInt(e.target.value) || 60,
                    })
                  }
                  min={1}
                />
              </div>
            )}

            {formData.triggerType === "STATE" && (
              <div className="space-y-2">
                <Label htmlFor="triggerState">Trigger State ID</Label>
                <Input
                  id="triggerState"
                  value={formData.triggerState}
                  onChange={(e) =>
                    setFormData({ ...formData, triggerState: e.target.value })
                  }
                  placeholder="Enter state ID"
                />
              </div>
            )}

            {/* Schedule Type */}
            <div className="space-y-2">
              <Label htmlFor="scheduleType">Schedule Type</Label>
              <Select
                value={formData.scheduleType}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    scheduleType: value as ScheduleType,
                  })
                }
              >
                <SelectTrigger id="scheduleType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED_RATE">
                    Fixed Rate (start every interval)
                  </SelectItem>
                  <SelectItem value="FIXED_DELAY">
                    Fixed Delay (wait between executions)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Check Mode */}
            <div className="space-y-2">
              <Label htmlFor="checkMode">State Check Mode</Label>
              <Select
                value={formData.checkMode}
                onValueChange={(value) =>
                  setFormData({ ...formData, checkMode: value as CheckMode })
                }
              >
                <SelectTrigger id="checkMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHECK_ALL">Check All States</SelectItem>
                  <SelectItem value="CHECK_INACTIVE_ONLY">
                    Check Inactive Only
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Execution Limits */}
            <div className="space-y-2">
              <Label htmlFor="maxIterations">Max Iterations (optional)</Label>
              <Input
                id="maxIterations"
                type="number"
                value={formData.maxIterations || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxIterations: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                placeholder="Leave empty for unlimited"
                min={1}
              />
            </div>

            {/* State Check Configuration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stateCheckDelay">State Check Delay (s)</Label>
                <Input
                  id="stateCheckDelay"
                  type="number"
                  value={formData.stateCheckDelaySeconds}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      stateCheckDelaySeconds: parseInt(e.target.value) || 5,
                    })
                  }
                  min={1}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stateRebuildDelay">
                  State Rebuild Delay (s)
                </Label>
                <Input
                  id="stateRebuildDelay"
                  type="number"
                  value={formData.stateRebuildDelaySeconds}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      stateRebuildDelaySeconds: parseInt(e.target.value) || 10,
                    })
                  }
                  min={1}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="failureThreshold">Failure Threshold</Label>
              <Input
                id="failureThreshold"
                type="number"
                value={formData.failureThreshold}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    failureThreshold: parseInt(e.target.value) || 3,
                  })
                }
                min={1}
              />
              <p className="text-xs text-muted-foreground">
                Number of consecutive failures before triggering rebuild
              </p>
            </div>

            {/* Enabled Toggle */}
            <div className="flex items-center justify-between py-2">
              <Label htmlFor="enabled">Schedule Enabled</Label>
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, enabled: checked })
                }
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {schedule ? "Update Schedule" : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
