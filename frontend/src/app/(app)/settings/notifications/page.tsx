"use client";

/**
 * /settings/notifications -- per-type notification delivery preferences.
 *
 * Renders a generic, schema-driven panel with one row per notification
 * category and two toggle columns (in-app / email).  Preferences are
 * persisted via PUT /api/v1/notifications/preferences.
 *
 * This is the canonical notification-delivery prefs surface -- it is NOT
 * the automation-builder NotificationsTab (which configures workflow-
 * execution events via AutomationSettings).
 */

import { Bell } from "lucide-react";
import { NotificationPreferencesPanel } from "./_components/NotificationPreferencesPanel";

export default function NotificationsSettingsPage() {
  return (
    <div
      className="p-6 space-y-6 max-w-2xl"
      data-page-id="settings-notifications"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bell className="size-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which notification types reach you in-app and by email.
            Toggle off any category to opt out entirely.
          </p>
        </div>
      </div>

      {/* Panel */}
      <NotificationPreferencesPanel />
    </div>
  );
}
