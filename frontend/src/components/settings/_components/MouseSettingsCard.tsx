"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SettingsCardProps } from "../settings-types";

export function MouseSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mouse Settings</CardTitle>
        <CardDescription>Mouse action timing and behavior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="move_delay">Move Delay (seconds)</Label>
          <Input
            id="move_delay"
            type="number"
            step="0.1"
            value={settings.mouse.move_delay}
            onChange={(e) =>
              updateSetting("mouse", "move_delay", parseFloat(e.target.value))
            }
            data-ui-id="settings-mouse-move-delay-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pause_before_down">
            Pause Before Mouse Down (seconds)
          </Label>
          <Input
            id="pause_before_down"
            type="number"
            step="0.1"
            value={settings.mouse.pause_before_down}
            onChange={(e) =>
              updateSetting(
                "mouse",
                "pause_before_down",
                parseFloat(e.target.value)
              )
            }
            data-ui-id="settings-mouse-pause-before-down-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pause_after_down">
            Pause After Mouse Down (seconds)
          </Label>
          <Input
            id="pause_after_down"
            type="number"
            step="0.1"
            value={settings.mouse.pause_after_down}
            onChange={(e) =>
              updateSetting(
                "mouse",
                "pause_after_down",
                parseFloat(e.target.value)
              )
            }
            data-ui-id="settings-mouse-pause-after-down-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="click_delay">Click Delay (seconds)</Label>
          <Input
            id="click_delay"
            type="number"
            step="0.1"
            value={settings.mouse.click_delay}
            onChange={(e) =>
              updateSetting("mouse", "click_delay", parseFloat(e.target.value))
            }
            data-ui-id="settings-mouse-click-delay-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="drag_delay">Drag Delay (seconds)</Label>
          <Input
            id="drag_delay"
            type="number"
            step="0.1"
            value={settings.mouse.drag_delay}
            onChange={(e) =>
              updateSetting("mouse", "drag_delay", parseFloat(e.target.value))
            }
            data-ui-id="settings-mouse-drag-delay-input"
          />
        </div>
      </CardContent>
    </Card>
  );
}
