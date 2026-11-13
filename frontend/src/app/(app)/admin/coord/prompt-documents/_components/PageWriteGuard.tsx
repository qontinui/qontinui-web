"use client";

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageProject } from "../_hooks/usePageProject";
import {
  CROSS_TAB_MESSAGE,
  usePageWriteGuard,
} from "../_hooks/usePageWriteGuard";
import {
  PageWriteGuardContext,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";

export {
  usePageWriteGuardContext,
  useRequiredPageWriteGuard,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";

/**
 * The prompt-documents page's ONE cross-tab write guard (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1): the page's project
 * (`usePageProject`) and the guard against another tab's switch
 * (`usePageWriteGuard`), each taken once, for the list's rows and the settings
 * beside them alike.
 *
 * Everything under it reads them from the context
 * (`usePageWriteGuardContext`) — no guard is handed up through a ref, and
 * none is threaded down as a prop a caller could leave out. It renders the
 * notice and ONE fieldset around all of its children: a disabled fieldset is
 * the one switch that reaches every control on the page. The notice stays
 * outside it, so Reload is never disabled. Dialogs and confirmations portal
 * out of the fieldset, so their doors are refused at call time instead
 * (`writeAllowed`).
 */
export function PageWriteGuardProvider({ children }: { children: ReactNode }) {
  const { mountTenant, tenantContext, pageTenant, guardTenant, pin } =
    usePageProject();
  const { locked, writeAllowed } = usePageWriteGuard(guardTenant);
  // Asked as each request is sent, through a ref: one identity for the page's
  // lifetime, so a hook mounted before the page's project resolves neither
  // re-fires its mount read nor rebuilds its callbacks when the pin changes.
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const resolvePin = useCallback(() => pinRef.current, []);
  const value = useMemo<PageWriteGuardValue>(
    () => ({
      pageTenant,
      mountTenant,
      tenantContext,
      locked,
      writeAllowed,
      pin,
      resolvePin,
    }),
    [
      pageTenant,
      mountTenant,
      tenantContext,
      locked,
      writeAllowed,
      pin,
      resolvePin,
    ]
  );
  return (
    <PageWriteGuardContext.Provider value={value}>
      <div className="space-y-6">
        {locked ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
            role="alert"
            data-testid="prompt-documents-cross-tab"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">
              {CROSS_TAB_MESSAGE} Until then this page sends no changes: its
              controls are disabled, and a change confirmed in a dialog or
              settings confirmation that was already open is refused. The
              documents shown are still this page&apos;s project, and the active
              project is now a different one.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.location.reload()}
              data-testid="prompt-documents-cross-tab-reload"
            >
              <RotateCw className="size-4" />
              Reload
            </Button>
          </div>
        ) : null}
        <fieldset
          disabled={locked}
          className="m-0 min-w-0 border-0 p-0"
          data-testid="prompt-documents-controls"
        >
          {children}
        </fieldset>
      </div>
    </PageWriteGuardContext.Provider>
  );
}
