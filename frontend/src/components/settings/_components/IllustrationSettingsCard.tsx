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
import type { SettingsCardProps } from "../settings-types";

export function IllustrationSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Illustration Settings</CardTitle>
        <CardDescription>Visual feedback and annotations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="illustration_enabled">Enable Illustrations</Label>
          <Switch
            id="illustration_enabled"
            checked={settings.illustration.enabled}
            onCheckedChange={(checked) =>
              updateSetting("illustration", "enabled", checked)
            }
            data-ui-id="settings-illustration-enabled-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="show_click">Show Clicks</Label>
          <Switch
            id="show_click"
            checked={settings.illustration.show_click}
            onCheckedChange={(checked) =>
              updateSetting("illustration", "show_click", checked)
            }
            data-ui-id="settings-illustration-show-click-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="show_drag">Show Drags</Label>
          <Switch
            id="show_drag"
            checked={settings.illustration.show_drag}
            onCheckedChange={(checked) =>
              updateSetting("illustration", "show_drag", checked)
            }
            data-ui-id="settings-illustration-show-drag-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="show_find">Show Finds</Label>
          <Switch
            id="show_find"
            checked={settings.illustration.show_find}
            onCheckedChange={(checked) =>
              updateSetting("illustration", "show_find", checked)
            }
            data-ui-id="settings-illustration-show-find-toggle"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="highlight_color">Highlight Color</Label>
          <Input
            id="highlight_color"
            value={settings.illustration.highlight_color}
            onChange={(e) =>
              updateSetting("illustration", "highlight_color", e.target.value)
            }
            data-ui-id="settings-illustration-highlight-color-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="highlight_thickness">
            Highlight Thickness (1-10)
          </Label>
          <Input
            id="highlight_thickness"
            type="number"
            min="1"
            max="10"
            value={settings.illustration.highlight_thickness}
            onChange={(e) =>
              updateSetting(
                "illustration",
                "highlight_thickness",
                parseInt(e.target.value)
              )
            }
            data-ui-id="settings-illustration-highlight-thickness-input"
          />
        </div>
      </CardContent>
    </Card>
  );
}
