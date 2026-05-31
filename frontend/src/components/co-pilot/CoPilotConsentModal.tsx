"use client";

/**
 * CoPilotConsentModal — per-SESSION consent prompt for the UI Bridge AI
 * co-pilot.
 *
 * Renders ONLY when the per-user durable preference is ON AND the
 * per-session consent decision is still ``null`` (i.e. this is the first
 * authenticated visit in this browser session since the user opted in).
 *
 * Hard rules (consent SAFETY rails — must not regress):
 *   - A click on the modal's backdrop / overlay = "Not now" (revoke), NOT
 *     "Allow". Defaulting to allow would defeat consent.
 *   - ESC = same as "Not now" (revoke). Closing the modal without an
 *     explicit grant must NEVER enable the relay listener.
 *   - The grant button is the ONLY path to ``state === "granted"``.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";

export function CoPilotConsentModal() {
  const preference = useCoPilotPreference();
  const consent = useCoPilotSessionConsent();

  // Gate: the user has opted in at the account level AND has not yet made
  // a per-session decision.
  const shouldRender = preference.enabled && consent.state === null;

  const handleOpenChange = (open: boolean) => {
    // Radix fires onOpenChange(false) for: ESC, overlay click, programmatic
    // close. ALL of those are explicit non-grants — revoke.
    if (!open) {
      consent.revoke();
    }
  };

  return (
    <Dialog open={shouldRender} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="co-pilot-consent-modal"
        // Don't render the X close button — buttons below are the only
        // two valid choices and we already revoke on overlay/ESC.
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-primary" />
            <DialogTitle>Allow AI Co-Pilot for this session?</DialogTitle>
          </div>
          <DialogDescription>
            You enabled the AI co-pilot in your account settings. Before it
            can drive this tab on your behalf, we need a per-session OK.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            This decision applies to this browser session only. Closing the
            tab or signing out will re-prompt next time.
          </p>
          <p>
            While the co-pilot is active, you{"'"}ll see a banner at the
            top of every page. You can revoke at any time from there.
          </p>
        </div>

        <DialogFooter>
          {/* "Not now" is NOT destructive in the §4.4 sense — refusing
              consent IS the safe default. We WANT a synthetic click here
              to land if anything (UI Bridge, test harness) closes the
              modal, because the resulting state ("revoked") keeps the
              relay listener un-mounted. Wrapping in DestructiveButton
              would gate that safe-fail path. */}
          <Button
            variant="ghost"
            // eslint-disable-next-line @qontinui-web/no-unwrapped-destructive-handler
            onClick={() => consent.revoke()}
            data-testid="co-pilot-consent-not-now"
          >
            Not now
          </Button>
          <Button
            variant="default"
            onClick={() => consent.grant()}
            data-testid="co-pilot-consent-allow"
          >
            Allow this session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
