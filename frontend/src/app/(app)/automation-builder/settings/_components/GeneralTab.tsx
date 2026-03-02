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
import { TabsContent } from "@/components/ui/tabs";
import { AutomationSettings } from "../types";

interface GeneralTabProps {
  settings: AutomationSettings;
  updateSetting: <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => void;
}

export function GeneralTab({ settings, updateSetting }: GeneralTabProps) {
  return (
    <TabsContent value="general" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Project Settings</CardTitle>
          <CardDescription>
            Configure general project preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-save</Label>
              <p className="text-sm text-muted-foreground">
                Automatically save changes while working
              </p>
            </div>
            <Switch
              checked={settings.autoSave}
              onCheckedChange={(checked) => updateSetting("autoSave", checked)}
              data-ui-id="automation-settings-auto-save-toggle"
            />
          </div>

          {settings.autoSave && (
            <div className="space-y-2">
              <Label htmlFor="autoSaveInterval">
                Auto-save Interval (seconds)
              </Label>
              <Input
                id="autoSaveInterval"
                type="number"
                value={settings.autoSaveInterval}
                onChange={(e) =>
                  updateSetting("autoSaveInterval", parseInt(e.target.value))
                }
                data-ui-id="automation-settings-auto-save-interval-input"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
