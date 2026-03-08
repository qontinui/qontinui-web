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

export function MockSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mock Mode Settings</CardTitle>
        <CardDescription>Simulated action timings for testing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="click_duration">Click Duration (seconds)</Label>
          <Input
            id="click_duration"
            type="number"
            step="0.1"
            value={settings.mock.click_duration}
            onChange={(e) =>
              updateSetting(
                "mock",
                "click_duration",
                parseFloat(e.target.value)
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type_duration">Type Duration (seconds)</Label>
          <Input
            id="type_duration"
            type="number"
            step="0.1"
            value={settings.mock.type_duration}
            onChange={(e) =>
              updateSetting("mock", "type_duration", parseFloat(e.target.value))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="find_duration">Find Duration (seconds)</Label>
          <Input
            id="find_duration"
            type="number"
            step="0.1"
            value={settings.mock.find_duration}
            onChange={(e) =>
              updateSetting("mock", "find_duration", parseFloat(e.target.value))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="drag_duration">Drag Duration (seconds)</Label>
          <Input
            id="drag_duration"
            type="number"
            step="0.1"
            value={settings.mock.drag_duration}
            onChange={(e) =>
              updateSetting("mock", "drag_duration", parseFloat(e.target.value))
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
