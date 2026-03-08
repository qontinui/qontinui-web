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

export function DatasetSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dataset Settings</CardTitle>
        <CardDescription>AI training data collection</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="dataset_collect">Collect Dataset</Label>
          <Switch
            id="dataset_collect"
            checked={settings.dataset.collect}
            onCheckedChange={(checked) =>
              updateSetting("dataset", "collect", checked)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dataset_path">Dataset Path</Label>
          <Input
            id="dataset_path"
            value={settings.dataset.path}
            onChange={(e) => updateSetting("dataset", "path", e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include_screenshots">Include Screenshots</Label>
          <Switch
            id="include_screenshots"
            checked={settings.dataset.include_screenshots}
            onCheckedChange={(checked) =>
              updateSetting("dataset", "include_screenshots", checked)
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include_actions">Include Actions</Label>
          <Switch
            id="include_actions"
            checked={settings.dataset.include_actions}
            onCheckedChange={(checked) =>
              updateSetting("dataset", "include_actions", checked)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dataset_format">Format</Label>
          <Select
            value={settings.dataset.format}
            onValueChange={(value) => updateSetting("dataset", "format", value)}
          >
            <SelectTrigger id="dataset_format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="parquet">Parquet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
