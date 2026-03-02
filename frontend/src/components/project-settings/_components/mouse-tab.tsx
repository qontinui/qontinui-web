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
import { Switch } from "@/components/ui/switch";
import type { MouseSettings } from "@/types/project-settings";

interface MouseTabProps {
  mouse: MouseSettings;
  onUpdate: (key: keyof MouseSettings, value: number | boolean) => void;
}

export function MouseTab({ mouse, onUpdate }: MouseTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">
          Mouse Action Timing
        </CardTitle>
        <CardDescription>
          Default timing parameters for mouse actions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Click Hold Duration (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.click_hold_duration}
              onChange={(e) =>
                onUpdate("click_hold_duration", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              How long to hold button during click
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Click Release Delay (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.click_release_delay}
              onChange={(e) =>
                onUpdate("click_release_delay", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay after releasing button
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Double Click Interval (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.double_click_interval}
              onChange={(e) =>
                onUpdate("double_click_interval", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Time between double clicks
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-text-muted">
                Click Safety Release
              </Label>
              <Switch
                checked={mouse.click_safety_release}
                onCheckedChange={(checked) =>
                  onUpdate("click_safety_release", checked)
                }
              />
            </div>
            <p className="text-xs text-text-muted">
              Release all buttons before clicking
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Drag Start Delay (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.drag_start_delay}
              onChange={(e) =>
                onUpdate("drag_start_delay", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay before starting drag
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Drag End Delay (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.drag_end_delay}
              onChange={(e) =>
                onUpdate("drag_end_delay", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">Delay after ending drag</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Drag Default Duration (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.drag_default_duration}
              onChange={(e) =>
                onUpdate("drag_default_duration", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Default drag animation duration
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Move Default Duration (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.move_default_duration}
              onChange={(e) =>
                onUpdate("move_default_duration", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Default move animation duration
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Safety Release Delay (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={mouse.safety_release_delay}
              onChange={(e) =>
                onUpdate("safety_release_delay", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay after safety release
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
