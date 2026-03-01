"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AdvancedSettingsCardProps {
  expanded: boolean;
  onToggle: () => void;
  timeout: number;
  onTimeoutChange: (value: number) => void;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}

export function AdvancedSettingsCard({
  expanded,
  onToggle,
  timeout,
  onTimeoutChange,
  enabled,
  onEnabledChange,
}: AdvancedSettingsCardProps) {
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <CardTitle>Advanced Settings</CardTitle>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {/* Timeout */}
          <div className="space-y-2">
            <Label htmlFor="timeout">Test Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              value={timeout}
              onChange={(e) => onTimeoutChange(Number(e.target.value))}
              min={0}
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="enabled">Test enabled</Label>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
