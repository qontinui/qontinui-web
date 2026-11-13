"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useOptionalTenant } from "@/contexts/tenant-context";
import { usePageProject } from "../_hooks/usePageProject";
import {
  crossTabHeadline,
  usePageWriteGuard,
} from "../_hooks/usePageWriteGuard";
import {
  PageWriteGuardContext,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";
import { projectLabel } from "../_lib/projectLabel";

export {
  usePageWriteGuardContext,
  useRequiredPageWriteGuard,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";

/**
 * An open modal dialog, whose focus the lock must not take. The app's own
 * modals say so with `aria-modal`. A Radix dialog (every dialog and
 * confirmation on this page) does not: it renders `role="dialog"` or
 * `role="alertdialog"` with `data-state="open"`, traps focus inside itself,
 * and hides the rest of the page from assistive technology. Focus moved
 * behind it would land on a control hidden from a screen reader, or be pulled
 * straight back.
 */
const OPEN_MODAL_DIALOG = [
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(", ");

/**
 * A project as the notice names it: `projectLabel`'s name for it. While the
 * layout's membership list has not been read (no provider, still reading, or
 * failed), a project the list does not hold is not "not in this page's
 * project list" but UNKNOWN, and is named by its id alone.
 */
function noticeProjectLabel(
  tenantContext: ReturnType<typeof useOptionalTenant>,
  id: string | null
): string {
  const listRead =
    tenantContext !== null &&
    !tenantContext.loading &&
    tenantContext.error === null;
  if (
    !listRead &&
    id !== null &&
    !tenantContext?.tenants.some((t) => t.id === id)
  ) {
    return `project ${id}`;
  }
  return projectLabel(tenantContext?.tenants, id);
}

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
 *
 * The notice is RED (D5, `docs/console-ui-style-guide.md` R3): it is the
 * operator's move, now. Only the operator's Reload clears it, or the operator
 * switching back in the other tab; nothing will clear it by itself, which is
 * what amber would promise. It names only the cause it observed (D4). When the
 * page locks, focus moves to Reload from a control the fieldset just disabled
 * (or from `<body>`, where a browser drops it), unless a modal dialog holds it
 * (#9).
 */
export function PageWriteGuardProvider({ children }: { children: ReactNode }) {
  const { mountTenant, tenantContext, pageTenant, guardTenant, pin } =
    usePageProject();
  const { locked, stored, writeAllowed, crossTabInEffect } =
    usePageWriteGuard(guardTenant);
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
      crossTabInEffect,
      pin,
      resolvePin,
    }),
    [
      pageTenant,
      mountTenant,
      tenantContext,
      locked,
      writeAllowed,
      crossTabInEffect,
      pin,
      resolvePin,
    ]
  );

  const isLocked = locked !== null;
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  // #9: the fieldset has just disabled the control the operator was on, and a
  // browser drops focus from a disabled control to `<body>`. `role="alert"`
  // announces the notice, but focus is left nowhere. Move it to Reload, the
  // one way on. Focus anywhere else is the operator's, and is left alone,
  // most of all inside an open modal dialog, which portals outside the
  // fieldset.
  useEffect(() => {
    if (!isLocked) return;
    const focused = document.activeElement;
    const dropped = focused === null || focused === document.body;
    const disabledUnderIt =
      focused !== null && (fieldsetRef.current?.contains(focused) ?? false);
    if (!dropped && !disabledUnderIt) return;
    if (document.querySelector(OPEN_MODAL_DIALOG) !== null) return;
    reloadRef.current?.focus();
  }, [isLocked]);

  return (
    <PageWriteGuardContext.Provider value={value}>
      <div className="space-y-6">
        {locked !== null ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400"
            role="alert"
            data-testid="prompt-documents-cross-tab"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">
              {crossTabHeadline(locked)} Until you reload, no change made on
              this page is sent: everything below belongs to{" "}
              {noticeProjectLabel(tenantContext, guardTenant)}, and the active
              project is now {noticeProjectLabel(tenantContext, stored)}.
            </p>
            <Button
              ref={reloadRef}
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
          ref={fieldsetRef}
          disabled={isLocked}
          className="m-0 min-w-0 border-0 p-0"
          data-testid="prompt-documents-controls"
        >
          {children}
        </fieldset>
      </div>
    </PageWriteGuardContext.Provider>
  );
}
