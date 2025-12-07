"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Mail,
  UserPlus,
  FolderPlus,
  Send,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

interface NotificationSettings {
  id: string;
  notification_email: string;
  notify_on_user_signup: boolean;
  notify_on_project_created: boolean;
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export default function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [notifyOnSignup, setNotifyOnSignup] = useState(true);
  const [notifyOnProject, setNotifyOnProject] = useState(true);
  const [enabled, setEnabled] = useState(true);

  // Track if form has unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      const changed =
        email !== settings.notification_email ||
        notifyOnSignup !== settings.notify_on_user_signup ||
        notifyOnProject !== settings.notify_on_project_created ||
        enabled !== settings.notifications_enabled;
      setHasChanges(changed);
    }
  }, [email, notifyOnSignup, notifyOnProject, enabled, settings]);

  const loadSettings = async () => {
    try {
      const response = await httpClient.fetch(
        "/api/v1/admin/notifications/settings"
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setEmail(data.notification_email);
        setNotifyOnSignup(data.notify_on_user_signup);
        setNotifyOnProject(data.notify_on_project_created);
        setEnabled(data.notifications_enabled);
        setError(null);
      } else {
        const errorText = await response.text().catch(() => "Unknown error");
        setError(`Failed to load notification settings: ${errorText}`);
        toast.error("Failed to load notification settings");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to load notification settings: ${errorMsg}`);
      toast.error("Failed to load notification settings");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSaving(true);
    try {
      const response = await httpClient.fetch(
        "/api/v1/admin/notifications/settings",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            notification_email: email,
            notify_on_user_signup: notifyOnSignup,
            notify_on_project_created: notifyOnProject,
            notifications_enabled: enabled,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setHasChanges(false);
        toast.success("Notification settings saved");
      } else {
        const errorText = await response.text().catch(() => "Unknown error");
        toast.error(`Failed to save settings: ${errorText}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to save settings: ${errorMsg}`);
    } finally {
      setSaving(false);
    }
  };

  const sendTestNotification = async () => {
    setSendingTest(true);
    try {
      const response = await httpClient.fetch(
        "/api/v1/admin/notifications/test",
        {
          method: "POST",
        }
      );

      if (response.ok) {
        const data = await response.json();
        toast.success(data.message || "Test notification sent");
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.detail || "Failed to send test notification");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to send test notification: ${errorMsg}`);
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="text-center text-red-500 space-y-2">
        <AlertCircle className="h-12 w-12 mx-auto" />
        <div>Error loading notification settings</div>
        <div className="text-sm text-muted-foreground">{error}</div>
        <Button onClick={loadSettings} variant="outline" className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Email Notifications</h3>
          <p className="text-sm text-muted-foreground">
            Configure email notifications for admin events
          </p>
        </div>
        <Badge
          variant={enabled ? "default" : "secondary"}
          className={enabled ? "bg-green-500/10 text-green-500" : ""}
        >
          {enabled ? (
            <>
              <CheckCircle className="h-3 w-3 mr-1" />
              Enabled
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3 mr-1" />
              Disabled
            </>
          )}
        </Badge>
      </div>

      {/* Main Settings Card */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <CardTitle>Notification Settings</CardTitle>
          </div>
          <CardDescription>
            Receive email notifications when important events occur
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">
                Enable Notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Master toggle for all admin email notifications
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enable notifications"
            />
          </div>

          {/* Email Input */}
          <div className="space-y-2">
            <Label
              htmlFor="notification-email"
              className="flex items-center gap-2"
            >
              <Mail className="h-4 w-4" />
              Notification Email
            </Label>
            <Input
              id="notification-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!enabled}
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground">
              All admin notifications will be sent to this email address
            </p>
          </div>

          {/* Event Toggles */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Event Types</Label>

            <div className="space-y-3">
              {/* User Signup */}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <UserPlus className="h-5 w-5 text-blue-500" />
                  <div>
                    <Label className="font-medium">New User Signup</Label>
                    <p className="text-sm text-muted-foreground">
                      Notify when a new user registers
                    </p>
                  </div>
                </div>
                <Switch
                  checked={notifyOnSignup}
                  onCheckedChange={setNotifyOnSignup}
                  disabled={!enabled}
                  aria-label="Notify on user signup"
                />
              </div>

              {/* Project Created */}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <FolderPlus className="h-5 w-5 text-green-500" />
                  <div>
                    <Label className="font-medium">New Project Created</Label>
                    <p className="text-sm text-muted-foreground">
                      Notify when a user creates a new project
                    </p>
                  </div>
                </div>
                <Switch
                  checked={notifyOnProject}
                  onCheckedChange={setNotifyOnProject}
                  disabled={!enabled}
                  aria-label="Notify on project creation"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={sendTestNotification}
          disabled={!enabled || sendingTest}
        >
          {sendingTest ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Send Test Email
        </Button>

        <div className="flex items-center gap-4">
          {hasChanges && (
            <span className="text-sm text-muted-foreground">
              You have unsaved changes
            </span>
          )}
          <Button onClick={saveSettings} disabled={saving || !hasChanges}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Save Settings
          </Button>
        </div>
      </div>

      {/* Info */}
      {settings && (
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Last updated: {new Date(settings.updated_at).toLocaleString()}
              </p>
              <p>
                Settings created:{" "}
                {new Date(settings.created_at).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
