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
import { AutomationSettings } from "../types";

interface NotificationsTabProps {
  settings: AutomationSettings;
  updateSetting: <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => void;
}

export function NotificationsTab({
  settings,
  updateSetting,
}: NotificationsTabProps) {
  return (
    <TabsContent value="notifications" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
          <CardDescription>
            Control when and how you receive notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notify on Success</Label>
              <p className="text-sm text-muted-foreground">
                Get notified when workflows complete successfully
              </p>
            </div>
            <Switch
              checked={settings.notifyOnSuccess}
              onCheckedChange={(checked) =>
                updateSetting("notifyOnSuccess", checked)
              }
              data-ui-id="automation-settings-notify-on-success-toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notify on Failure</Label>
              <p className="text-sm text-muted-foreground">
                Get notified when workflows fail
              </p>
            </div>
            <Switch
              checked={settings.notifyOnFailure}
              onCheckedChange={(checked) =>
                updateSetting("notifyOnFailure", checked)
              }
              data-ui-id="automation-settings-notify-on-failure-toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notify on Start</Label>
              <p className="text-sm text-muted-foreground">
                Get notified when workflows start executing
              </p>
            </div>
            <Switch
              checked={settings.notifyOnStart}
              onCheckedChange={(checked) =>
                updateSetting("notifyOnStart", checked)
              }
              data-ui-id="automation-settings-notify-on-start-toggle"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive notifications via email
              </p>
            </div>
            <Switch
              checked={settings.emailNotifications}
              onCheckedChange={(checked) =>
                updateSetting("emailNotifications", checked)
              }
              data-ui-id="automation-settings-email-notifications-toggle"
            />
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
