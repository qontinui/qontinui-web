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

export function MonitorSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitor Settings</CardTitle>
        <CardDescription>Multi-monitor configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="default_screen_index">
            Default Monitor Index (-1 for primary)
          </Label>
          <Input
            id="default_screen_index"
            type="number"
            value={settings.monitor.default_screen_index}
            onChange={(e) =>
              updateSetting(
                "monitor",
                "default_screen_index",
                parseInt(e.target.value)
              )
            }
            data-ui-id="settings-monitor-default-screen-index-input"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="multi_monitor_enabled">Multi-Monitor Support</Label>
          <Switch
            id="multi_monitor_enabled"
            checked={settings.monitor.multi_monitor_enabled}
            onCheckedChange={(checked) =>
              updateSetting("monitor", "multi_monitor_enabled", checked)
            }
            data-ui-id="settings-monitor-multi-monitor-enabled-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="search_all_monitors">Search All Monitors</Label>
          <Switch
            id="search_all_monitors"
            checked={settings.monitor.search_all_monitors}
            onCheckedChange={(checked) =>
              updateSetting("monitor", "search_all_monitors", checked)
            }
            data-ui-id="settings-monitor-search-all-monitors-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="log_monitor_info">Log Monitor Info</Label>
          <Switch
            id="log_monitor_info"
            checked={settings.monitor.log_monitor_info}
            onCheckedChange={(checked) =>
              updateSetting("monitor", "log_monitor_info", checked)
            }
            data-ui-id="settings-monitor-log-monitor-info-toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
