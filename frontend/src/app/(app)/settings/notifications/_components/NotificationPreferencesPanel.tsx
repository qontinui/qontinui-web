"use client";

/**
 * NotificationPreferencesPanel
 *
 * Generic, schema-driven panel that renders ALL per-type notification
 * delivery preferences in a 2-column (in-app / email) grid.  One row per
 * notification category derived from the backend NotificationPreferences
 * schema field pairs (in_app_* / email_*).
 *
 * Adding a new category to the backend automatically surfaces here with a
 * humanized fallback label.  Categories that have an explicit entry in
 * CATEGORY_META get a human label + optional description.
 *
 * Persistence: optimistic-update on every toggle change -- each toggle flip
 * immediately sends a PUT /api/v1/notifications/preferences for that single
 * field.  A spinner overlay is shown while any mutation is in flight; a
 * transient "Saved" confirmation fades out after 1.5 s.  Errors surface as
 * inline text with a retry link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useNotificationPreferences,
  type NotificationPreferencesShape,
  type NotificationPreferencesUpdate,
} from "@/hooks/useNotificationPreferences";

// ============================================================================
// Category metadata map
// stem (e.g. "mentions") -> label + optional description
// New backend stems without an entry here still render with a humanized label.
// ============================================================================

interface CategoryMeta {
  label: string;
  description?: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  mentions: {
    label: "Mentions",
    description: "When someone @mentions you in a comment or annotation",
  },
  comments: {
    label: "Comments",
    description: "New comments on projects or items you follow",
  },
  shares: {
    label: "Shares",
    description: "When a project or resource is shared with you",
  },
  replies: {
    label: "Replies",
    description: "Replies to your comments",
  },
  team_invites: {
    label: "Team invites",
    description: "Invitations to join a team or organization",
  },
  project_updates: {
    label: "Project updates",
    description: "Status changes and milestones on your projects",
  },
  gate_action: {
    label: "Merge-gate actions",
    description:
      "When the coord merge gate holds, approves, or acts on a PR you are responsible for",
  },
};

// ============================================================================
// Helpers
// ============================================================================

/** Convert a snake_case stem to a Title Case label as a fallback. */
function humanize(stem: string): string {
  return stem
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Derive the sorted list of (stem, inAppKey, emailKey) from a prefs object. */
interface CategoryRow {
  stem: string;
  inAppKey: keyof NotificationPreferencesShape;
  emailKey: keyof NotificationPreferencesShape | null;
  label: string;
  description?: string;
}

function deriveRows(prefs: NotificationPreferencesShape): CategoryRow[] {
  const allKeys = Object.keys(prefs) as Array<keyof NotificationPreferencesShape>;
  const inAppKeys = allKeys.filter((k) => (k as string).startsWith("in_app_"));

  return inAppKeys
    .map((inAppKey) => {
      const stem = (inAppKey as string).replace(/^in_app_/, "");
      const emailKey = `email_${stem}` as keyof NotificationPreferencesShape;
      const hasEmail = emailKey in prefs;
      const meta = CATEGORY_META[stem];
      return {
        stem,
        inAppKey,
        emailKey: hasEmail ? emailKey : null,
        label: meta?.label ?? humanize(stem),
        description: meta?.description,
      };
    })
    .sort((a, b) => {
      // Explicit meta entries first, then alphabetical by stem
      const aHas = !!CATEGORY_META[a.stem];
      const bHas = !!CATEGORY_META[b.stem];
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return a.stem.localeCompare(b.stem);
    });
}

// ============================================================================
// Row component
// ============================================================================

interface PreferenceRowProps {
  row: CategoryRow;
  prefs: NotificationPreferencesShape;
  disabled: boolean;
  onToggle: (field: keyof NotificationPreferencesShape, value: boolean) => void;
}

function PreferenceRow({ row, prefs, disabled, onToggle }: PreferenceRowProps) {
  const inAppVal = prefs[row.inAppKey] as boolean;
  const emailVal = row.emailKey ? (prefs[row.emailKey] as boolean) : null;

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-0.5 py-3 border-b border-border last:border-b-0"
      data-content-role="preference-row"
      data-content-label={`notification preference ${row.stem}`}
    >
      {/* Label + description */}
      <div className="min-w-0">
        <span className="text-sm text-foreground font-medium">{row.label}</span>
        {row.description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {row.description}
          </p>
        )}
      </div>

      {/* In-app toggle */}
      <div className="flex flex-col items-center gap-1 min-w-[52px]">
        <Switch
          id={`in-app-${row.stem}`}
          data-testid={`in-app-${row.stem}`}
          checked={inAppVal}
          disabled={disabled}
          onCheckedChange={(next) => onToggle(row.inAppKey, next)}
          aria-label={`In-app notifications for ${row.label}`}
        />
      </div>

      {/* Email toggle (or empty cell if no email counterpart) */}
      <div className="flex flex-col items-center gap-1 min-w-[52px]">
        {row.emailKey !== null && emailVal !== null ? (
          <Switch
            id={`email-${row.stem}`}
            data-testid={`email-${row.stem}`}
            checked={emailVal}
            disabled={disabled}
            onCheckedChange={(next) =>
              onToggle(row.emailKey as keyof NotificationPreferencesShape, next)
            }
            aria-label={`Email notifications for ${row.label}`}
          />
        ) : (
          <span className="size-9" aria-hidden />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main panel
// ============================================================================

export function NotificationPreferencesPanel() {
  const { preferences, isLoading, error, isMutating, save } =
    useNotificationPreferences();

  // Transient "Saved" indicator
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleToggle = useCallback(
    (field: keyof NotificationPreferencesShape, value: boolean) => {
      setSaveError(null);
      const update: NotificationPreferencesUpdate = { [field]: value };
      save(update)
        .then(() => {
          setShowSaved(true);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setShowSaved(false), 1500);
        })
        .catch((err: unknown) => {
          setSaveError(
            err instanceof Error ? err.message : "Failed to save preferences"
          );
        });
    },
    [save]
  );

  // ---- loading state ----
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-20"
        data-testid="notification-prefs-loading"
      >
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- error state ----
  if (error || !preferences) {
    return (
      <div
        className="p-6 rounded-lg border border-border text-sm text-muted-foreground"
        data-testid="notification-prefs-error"
      >
        <p className="text-destructive">
          {error?.message ?? "Could not load notification preferences."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 inline-flex items-center gap-1.5 text-primary hover:underline"
        >
          <RefreshCw className="size-3.5" />
          Reload
        </button>
      </div>
    );
  }

  const rows = deriveRows(preferences);

  return (
    <div className="space-y-6" data-testid="notification-prefs-panel">
      {/* Column header row */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-0 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Category
        </span>
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[52px] text-center">
          In-app
        </Label>
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[52px] text-center">
          Email
        </Label>
      </div>

      {/* Preference rows */}
      <div className="rounded-lg border border-border bg-background">
        <div className="px-4">
          {rows.map((row) => (
            <PreferenceRow
              key={row.stem}
              row={row}
              prefs={preferences}
              disabled={isMutating}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      {/* Save feedback */}
      <div className="h-5 flex items-center gap-2">
        {isMutating && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2
              className="size-3.5 animate-spin"
              data-testid="notification-prefs-saving-spinner"
            />
            Saving...
          </span>
        )}
        {!isMutating && showSaved && (
          <span
            className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400"
            data-testid="notification-prefs-saved"
          >
            <CheckCircle2 className="size-3.5" />
            Saved
          </span>
        )}
        {saveError && (
          <span
            className="text-xs text-destructive"
            data-testid="notification-prefs-save-error"
          >
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
