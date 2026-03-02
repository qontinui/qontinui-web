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
import type { WaitSettings } from "@/types/project-settings";

interface WaitTabProps {
  wait: WaitSettings;
  onUpdate: (key: keyof WaitSettings, value: number) => void;
}

export function WaitTab({ wait, onUpdate }: WaitTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">
          Action Pause Settings
        </CardTitle>
        <CardDescription>Global pauses applied to all actions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Global Pause Before Action (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={wait.pause_before_action}
              onChange={(e) =>
                onUpdate("pause_before_action", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Pause before every action begins
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Global Pause After Action (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={wait.pause_after_action}
              onChange={(e) =>
                onUpdate("pause_after_action", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Pause after every action completes
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
