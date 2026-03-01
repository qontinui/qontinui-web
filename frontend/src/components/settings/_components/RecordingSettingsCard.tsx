"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsCardProps } from "../settings-types";

export function RecordingSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording Settings</CardTitle>
        <CardDescription>Screen recording configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="recording_enabled">Enable Recording</Label>
          <Switch
            id="recording_enabled"
            checked={settings.recording.enabled}
            onCheckedChange={(checked) =>
              updateSetting("recording", "enabled", checked)
            }
            data-ui-id="settings-recording-enabled-toggle"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recording_path">Recording Path</Label>
          <Input
            id="recording_path"
            value={settings.recording.path}
            onChange={(e) => updateSetting("recording", "path", e.target.value)}
            data-ui-id="settings-recording-path-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fps">FPS</Label>
          <Input
            id="fps"
            type="number"
            value={settings.recording.fps}
            onChange={(e) =>
              updateSetting("recording", "fps", parseInt(e.target.value))
            }
            data-ui-id="settings-recording-fps-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recording_quality">Quality</Label>
          <Select
            value={settings.recording.quality}
            onValueChange={(value) =>
              updateSetting("recording", "quality", value)
            }
          >
            <SelectTrigger
              id="recording_quality"
              data-ui-id="settings-recording-quality-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_duration_minutes">Max Duration (minutes)</Label>
          <Input
            id="max_duration_minutes"
            type="number"
            value={settings.recording.max_duration_minutes}
            onChange={(e) =>
              updateSetting(
                "recording",
                "max_duration_minutes",
                parseInt(e.target.value)
              )
            }
            data-ui-id="settings-recording-max-duration-minutes-input"
          />
        </div>
      </CardContent>
    </Card>
  );
}
