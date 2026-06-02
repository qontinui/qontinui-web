"use client";

/**
 * /settings/co-pilot — per-user durable opt-in toggle for the UI Bridge
 * AI co-pilot (§4.5 of the production-safe plan).
 *
 * This page does NOT host the per-session consent decision — that's the
 * job of ``<CoPilotConsentModal>``, mounted globally in the UI Bridge
 * provider. The toggle here flips the DURABLE preference; once on, a
 * fresh browser session still needs an explicit grant via the modal.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import Link from "next/link";
import { Bot, Info, Loader2, ScrollText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CoPilotReadyStatus } from "@/components/co-pilot/CoPilotReadyStatus";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";

export default function CoPilotSettingsPage() {
  const { enabled, isLoading, isMutating, mutate } = useCoPilotPreference();

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">AI Co-Pilot</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Let the AI co-pilot drive this account on your behalf.
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Account-level opt-in</h3>
            <p className="text-xs text-muted-foreground">
              Persists across sessions and devices.
            </p>
          </div>
          <CoPilotReadyStatus />
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <Label
                htmlFor="co-pilot-enabled"
                className="text-sm text-foreground"
              >
                Enable AI co-pilot in this account
              </Label>
              <p className="text-xs text-muted-foreground">
                When on, the AI may drive a browser tab after you grant
                per-session consent.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(isLoading || isMutating) && (
                <Loader2
                  className="size-4 animate-spin text-muted-foreground"
                  data-testid="co-pilot-preference-spinner"
                />
              )}
              <Switch
                id="co-pilot-enabled"
                data-testid="co-pilot-preference-switch"
                checked={enabled}
                disabled={isLoading || isMutating}
                onCheckedChange={(next: boolean) => {
                  void mutate(next);
                }}
              />
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                When enabled, the AI co-pilot can read and click on
                elements of this app on your behalf.
              </p>
              <p>
                You{"'"}ll see a banner at the top of every page when the
                co-pilot is active. You can revoke at any time from there
                or by turning this toggle off.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Activity log link */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium">Activity</h3>
          <p className="text-xs text-muted-foreground">
            Every command the AI co-pilot issues against your account is
            audit-logged.
          </p>
        </div>
        <div className="p-4">
          <Link
            href="/settings/co-pilot/activity"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            data-testid="co-pilot-activity-link"
          >
            <ScrollText className="size-4" />
            View activity log
          </Link>
        </div>
      </div>
    </div>
  );
}
