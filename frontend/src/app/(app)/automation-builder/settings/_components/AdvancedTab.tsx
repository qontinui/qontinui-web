import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { AutomationSettings } from "../types";

interface AdvancedTabProps {
  settings: AutomationSettings;
  updateSetting: <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => void;
}

export function AdvancedTab({ settings, updateSetting }: AdvancedTabProps) {
  return (
    <TabsContent value="advanced" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Advanced configuration options</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Debug Mode</Label>
              <p className="text-sm text-muted-foreground">
                Enable detailed logging and debugging information
              </p>
            </div>
            <Switch
              checked={settings.enableDebugMode}
              onCheckedChange={(checked) =>
                updateSetting("enableDebugMode", checked)
              }
              data-ui-id="automation-settings-enable-debug-mode-toggle"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logLevel">Log Level</Label>
            <Select
              value={settings.logLevel}
              onValueChange={(value) => updateSetting("logLevel", value)}
            >
              <SelectTrigger
                id="logLevel"
                data-ui-id="automation-settings-log-level-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Telemetry</Label>
              <p className="text-sm text-muted-foreground">
                Help improve the product by sharing anonymous usage data
              </p>
            </div>
            <Switch
              checked={settings.enableTelemetry}
              onCheckedChange={(checked) =>
                updateSetting("enableTelemetry", checked)
              }
              data-ui-id="automation-settings-enable-telemetry-toggle"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions - proceed with caution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Clear All Data</p>
              <p className="text-sm text-muted-foreground">
                Delete all workflows, settings, and data
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              data-ui-id="automation-settings-clear-data-btn"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Data
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
