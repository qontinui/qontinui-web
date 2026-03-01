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

export function TestingSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Testing Settings</CardTitle>
        <CardDescription>Test execution configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="timeout_multiplier">Timeout Multiplier</Label>
          <Input
            id="timeout_multiplier"
            type="number"
            step="0.1"
            value={settings.testing.timeout_multiplier}
            onChange={(e) =>
              updateSetting(
                "testing",
                "timeout_multiplier",
                parseFloat(e.target.value)
              )
            }
            data-ui-id="settings-testing-timeout-multiplier-input"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="retry_failed">Retry Failed Tests</Label>
          <Switch
            id="retry_failed"
            checked={settings.testing.retry_failed}
            onCheckedChange={(checked) =>
              updateSetting("testing", "retry_failed", checked)
            }
            data-ui-id="settings-testing-retry-failed-toggle"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_retries">Max Retries</Label>
          <Input
            id="max_retries"
            type="number"
            value={settings.testing.max_retries}
            onChange={(e) =>
              updateSetting("testing", "max_retries", parseInt(e.target.value))
            }
            data-ui-id="settings-testing-max-retries-input"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="screenshot_on_failure">Screenshot on Failure</Label>
          <Switch
            id="screenshot_on_failure"
            checked={settings.testing.screenshot_on_failure}
            onCheckedChange={(checked) =>
              updateSetting("testing", "screenshot_on_failure", checked)
            }
            data-ui-id="settings-testing-screenshot-on-failure-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="verbose_logging">Verbose Logging</Label>
          <Switch
            id="verbose_logging"
            checked={settings.testing.verbose_logging}
            onCheckedChange={(checked) =>
              updateSetting("testing", "verbose_logging", checked)
            }
            data-ui-id="settings-testing-verbose-logging-toggle"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="parallel_execution">Parallel Execution</Label>
          <Switch
            id="parallel_execution"
            checked={settings.testing.parallel_execution}
            onCheckedChange={(checked) =>
              updateSetting("testing", "parallel_execution", checked)
            }
            data-ui-id="settings-testing-parallel-execution-toggle"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="test_iteration">Test Iteration</Label>
          <Input
            id="test_iteration"
            type="number"
            value={settings.testing.iteration}
            onChange={(e) =>
              updateSetting("testing", "iteration", parseInt(e.target.value))
            }
            data-ui-id="settings-testing-iteration-input"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="send_logs">Send Logs</Label>
          <Switch
            id="send_logs"
            checked={settings.testing.send_logs}
            onCheckedChange={(checked) =>
              updateSetting("testing", "send_logs", checked)
            }
            data-ui-id="settings-testing-send-logs-toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
