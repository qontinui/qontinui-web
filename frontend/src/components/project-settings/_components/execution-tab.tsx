"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExecutionSettings } from "@/types/project-settings";

interface ExecutionTabProps {
  execution: ExecutionSettings;
  onUpdate: (key: keyof ExecutionSettings, value: number | string) => void;
}

export function ExecutionTab({ execution, onUpdate }: ExecutionTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">Execution Settings</CardTitle>
        <CardDescription>
          Global execution behavior and error handling
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Default Timeout (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="100"
              value={execution.default_timeout}
              onChange={(e) =>
                onUpdate("default_timeout", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Maximum time to wait for actions to complete
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Default Retry Count
            </Label>
            <Input
              type="number"
              min="0"
              max="10"
              value={execution.default_retry_count}
              onChange={(e) =>
                onUpdate("default_retry_count", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Number of times to retry failed actions
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">Action Delay (ms)</Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={execution.action_delay}
              onChange={(e) => onUpdate("action_delay", Number(e.target.value))}
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay between consecutive actions
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">Failure Strategy</Label>
            <Select
              value={execution.failure_strategy}
              onValueChange={(value) => onUpdate("failure_strategy", value)}
            >
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
                <SelectItem value="stop">Stop on Failure</SelectItem>
                <SelectItem value="continue">Continue on Failure</SelectItem>
                <SelectItem value="pause">Pause on Failure</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              What to do when an action fails
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
