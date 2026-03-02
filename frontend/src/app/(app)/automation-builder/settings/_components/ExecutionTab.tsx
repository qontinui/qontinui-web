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
import { Separator } from "@/components/ui/separator";
import { AutomationSettings } from "../types";

interface ExecutionTabProps {
  settings: AutomationSettings;
  updateSetting: <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => void;
}

export function ExecutionTab({ settings, updateSetting }: ExecutionTabProps) {
  return (
    <TabsContent value="execution" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Execution Settings</CardTitle>
          <CardDescription>
            Configure workflow execution behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="maxConcurrent">Max Concurrent Workflows</Label>
            <Input
              id="maxConcurrent"
              type="number"
              min={1}
              max={20}
              value={settings.maxConcurrentWorkflows}
              onChange={(e) =>
                updateSetting(
                  "maxConcurrentWorkflows",
                  parseInt(e.target.value)
                )
              }
              data-ui-id="automation-settings-max-concurrent-workflows-input"
            />
            <p className="text-xs text-muted-foreground">
              Maximum number of workflows that can run simultaneously
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeout">Default Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              value={settings.defaultTimeout}
              onChange={(e) =>
                updateSetting("defaultTimeout", parseInt(e.target.value))
              }
              data-ui-id="automation-settings-default-timeout-input"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Retry on Failure</Label>
              <p className="text-sm text-muted-foreground">
                Automatically retry failed workflows
              </p>
            </div>
            <Switch
              checked={settings.retryOnFailure}
              onCheckedChange={(checked) =>
                updateSetting("retryOnFailure", checked)
              }
              data-ui-id="automation-settings-retry-on-failure-toggle"
            />
          </div>

          {settings.retryOnFailure && (
            <div className="space-y-2">
              <Label htmlFor="maxRetries">Max Retries</Label>
              <Input
                id="maxRetries"
                type="number"
                min={1}
                max={10}
                value={settings.maxRetries}
                onChange={(e) =>
                  updateSetting("maxRetries", parseInt(e.target.value))
                }
                data-ui-id="automation-settings-max-retries-input"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
