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

export function ScreenshotSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Screenshot Settings</CardTitle>
        <CardDescription>
          Screen capture and history configuration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="save_snapshots">Save Snapshots</Label>
          <Switch
            id="save_snapshots"
            checked={settings.screenshot.save_snapshots}
            onCheckedChange={(checked) =>
              updateSetting("screenshot", "save_snapshots", checked)
            }
            data-ui-id="settings-screenshot-save-snapshots-toggle"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="screenshot_path">Screenshot Path</Label>
          <Input
            id="screenshot_path"
            value={settings.screenshot.path}
            onChange={(e) =>
              updateSetting("screenshot", "path", e.target.value)
            }
            data-ui-id="settings-screenshot-path-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_history">Max History</Label>
          <Input
            id="max_history"
            type="number"
            value={settings.screenshot.max_history}
            onChange={(e) =>
              updateSetting(
                "screenshot",
                "max_history",
                parseInt(e.target.value)
              )
            }
            data-ui-id="settings-screenshot-max-history-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="screenshot_format">Format</Label>
          <Select
            value={settings.screenshot.format}
            onValueChange={(value) =>
              updateSetting("screenshot", "format", value)
            }
          >
            <SelectTrigger
              id="screenshot_format"
              data-ui-id="settings-screenshot-format-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="jpg">JPG</SelectItem>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="bmp">BMP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quality">Quality (1-100)</Label>
          <Input
            id="quality"
            type="number"
            min="1"
            max="100"
            value={settings.screenshot.quality}
            onChange={(e) =>
              updateSetting("screenshot", "quality", parseInt(e.target.value))
            }
            data-ui-id="settings-screenshot-quality-input"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include_timestamp">Include Timestamp</Label>
          <Switch
            id="include_timestamp"
            checked={settings.screenshot.include_timestamp}
            onCheckedChange={(checked) =>
              updateSetting("screenshot", "include_timestamp", checked)
            }
            data-ui-id="settings-screenshot-include-timestamp-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="capture_on_error">Capture on Error</Label>
          <Switch
            id="capture_on_error"
            checked={settings.screenshot.capture_on_error}
            onCheckedChange={(checked) =>
              updateSetting("screenshot", "capture_on_error", checked)
            }
            data-ui-id="settings-screenshot-capture-on-error-toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
