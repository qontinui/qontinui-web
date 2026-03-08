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

export function CoreSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Core Settings</CardTitle>
        <CardDescription>Essential framework configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="image_path">Image Path</Label>
          <Input
            id="image_path"
            value={settings.core.image_path}
            onChange={(e) =>
              updateSetting("core", "image_path", e.target.value)
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="mock">Mock Mode</Label>
          <Switch
            id="mock"
            checked={settings.core.mock}
            onCheckedChange={(checked) =>
              updateSetting("core", "mock", checked)
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="headless">Headless Mode</Label>
          <Switch
            id="headless"
            checked={settings.core.headless}
            onCheckedChange={(checked) =>
              updateSetting("core", "headless", checked)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="image_cache_size">Image Cache Size</Label>
          <Input
            id="image_cache_size"
            type="number"
            value={settings.core.image_cache_size}
            onChange={(e) =>
              updateSetting(
                "core",
                "image_cache_size",
                parseInt(e.target.value)
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auto_wait_timeout">Auto Wait Timeout (seconds)</Label>
          <Input
            id="auto_wait_timeout"
            type="number"
            step="0.1"
            value={settings.core.auto_wait_timeout}
            onChange={(e) =>
              updateSetting(
                "core",
                "auto_wait_timeout",
                parseFloat(e.target.value)
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
