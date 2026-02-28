"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

export default function NotificationsSection() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [email, setEmail] = useState("");
  const [notifyOnSignup, setNotifyOnSignup] = useState(true);
  const [notifyOnProject, setNotifyOnProject] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setHasChanges(
        email !== settings.notification_email ||
          notifyOnSignup !== settings.notify_on_user_signup ||
          notifyOnProject !== settings.notify_on_project_created ||
          enabled !== settings.notifications_enabled
      );
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
      } else {
        toast.error("Failed to load notification settings");
      }
    } catch {
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notification_email: email,
            notify_on_user_signup: notifyOnSignup,
            notify_on_project_created: notifyOnProject,
            notifications_enabled: enabled,
          }),
        }
      );
      if (response.ok) {
        setSettings(await response.json());
        setHasChanges(false);
        toast.success("Settings saved");
      } else {
        toast.error("Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const sendTestNotification = async () => {
    setSendingTest(true);
    try {
      const response = await httpClient.fetch(
        "/api/v1/admin/notifications/test",
        { method: "POST" }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success(data.message || "Test notification sent");
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error(data.detail || "Failed to send test notification");
      }
    } catch {
      toast.error("Failed to send test notification");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading notification settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mb-2" />
        <span className="text-sm">Failed to load notification settings.</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSettings}
          className="mt-2"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Master toggle row */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Email Notifications</div>
            <div className="text-xs text-muted-foreground">
              Master toggle for all admin notifications
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={enabled ? "default" : "secondary"}
            className={
              enabled ? "bg-green-500/10 text-green-500 text-xs" : "text-xs"
            }
          >
            {enabled ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1" /> Enabled
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3 mr-1" /> Disabled
              </>
            )}
          </Badge>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable notifications"
          />
        </div>
      </div>

      {/* Email row */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm whitespace-nowrap">Send to:</span>
          <Input
            type="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!enabled}
            className="h-8 text-sm max-w-sm"
          />
        </div>
      </div>

      {/* Event toggles */}
      <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
        Event Types
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <UserPlus className="h-4 w-4 text-blue-500" />
            <div>
              <div className="text-sm font-medium">New User Signup</div>
              <div className="text-xs text-muted-foreground">
                Notify when a new user registers
              </div>
            </div>
          </div>
          <Switch
            checked={notifyOnSignup}
            onCheckedChange={setNotifyOnSignup}
            disabled={!enabled}
            aria-label="Notify on user signup"
          />
        </div>
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <FolderPlus className="h-4 w-4 text-green-500" />
            <div>
              <div className="text-sm font-medium">New Project Created</div>
              <div className="text-xs text-muted-foreground">
                Notify when a user creates a new project
              </div>
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

      {/* Actions */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={sendTestNotification}
            disabled={!enabled || sendingTest}
          >
            {sendingTest ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            Test Email
          </Button>
          {settings && (
            <span className="text-xs text-muted-foreground">
              Updated: {new Date(settings.updated_at).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          )}
          <Button
            size="sm"
            onClick={saveSettings}
            disabled={saving || !hasChanges}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
