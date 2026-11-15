"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackendErrorMessage } from "@/components/console/BackendErrorMessage";
import type { useOptionalTenant } from "@/contexts/tenant-context";
import { isTenantsListUnauthorized } from "@/lib/api/operations/tenantsListFailure";
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

/** The layout's provider, as the page's guard hands it on. */
type LayoutTenants = ReturnType<typeof useOptionalTenant>;

/** The provider said its membership read failed, and is not reading it now. */
function listReadFailed(tenantContext: LayoutTenants): boolean {
  return (
    tenantContext !== null &&
    !tenantContext.loading &&
    tenantContext.error !== null
  );
}

/**
 * A project as the notice names it: `projectLabel`'s name for it. While the
 * layout's membership list has not been read (no provider, still reading, or
 * failed), a project the list does not hold is not "not in this page's
 * project list" but UNKNOWN, and is named by its id alone.
 */
function noticeProjectLabel(
  tenantContext: LayoutTenants,
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
 * The page's OWN project as the notice names it. A project the page has
 * never known (`pageTenant` UNKNOWN, and the guard naming none) is named as
 * such, never "your home project (none selected)", which would name a project
 * no read confirmed beside sections waiting for the page's project: unknown
 * once the provider's list could not be read, not yet learned while its read
 * is still in flight.
 */
function pageProjectLabel(
  tenantContext: LayoutTenants,
  pageTenant: string | null | undefined,
  id: string | null
): string {
  if (id === null && pageTenant === undefined) {
    return listReadFailed(tenantContext)
      ? "an unknown project (the list of your projects could not be read)"
      : "a project this page has not yet learned";
  }
  return noticeProjectLabel(tenantContext, id);
}

/**
 * One of the page's must-act notices: the route's must-act red (D5,
 * `docs/console-ui-style-guide.md` R3), an alert, its text, and the
 * operator's move beside it. Both of the page's notices are this one
 * component, so the two cannot drift apart.
 */
function MustActNotice({
  testId,
  id,
  children,
  action,
}: {
  testId: string;
  id?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400"
      id={id}
      role="alert"
      data-testid={testId}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
      {action}
    </div>
  );
}

/** The notices' Reload: a fresh page reads the stored project and the list. */
function ReloadButton({
  testId,
  ref,
}: {
  testId: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={ref}
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => window.location.reload()}
      data-testid={testId}
    >
      <RotateCw className="size-4" />
      Reload
    </Button>
  );
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
 * (#9). The fieldset is a named group (a visually hidden `<legend>`), and while
 * locked it is described by the notice (`aria-describedby`): that is the
 * markup assistive technology reads to tie the disabled controls' group to
 * its reason. How a given screen reader voices it was not measured.
 *
 * It renders one more notice, in the same red and for the same reason: the
 * layout's provider has said its membership read failed, and the page has no
 * project to pin a request to (nothing stored at mount). Nothing on this page
 * reads that list again, so no setting is read and no change is sent unless
 * the operator acts (R3's red row: nothing on the page will resolve it). It
 * shows the provider's error text as "Details" (the server's answer, or the
 * client's own when no answer came: a timeout, an offline browser), so a
 * failure a reload may clear reads differently from one it repeats. Coord's
 * refusal to list the account's projects (`tenant_not_resolved`, which
 * coord answers at its operator-role layer, so a reload and a project create
 * are refused alike: `isTenantsListUnauthorized`) is named as that, with the
 * project admin's operator role as the way out, and no Reload. It sits
 * outside the fieldset, so its Reload is never disabled, and shows
 * only while the page is not locked: the cross-tab notice then says the
 * same thing (the page's project unknown, Reload the way on), and two alerts
 * would ask twice. The settings sections waiting for the page's project point
 * to whichever notice is up rather than repeat it (`projectListFailed`).
 */
export function PageWriteGuardProvider({ children }: { children: ReactNode }) {
  const { mountTenant, tenantContext, pageTenant, guardTenant, pin } =
    usePageProject();
  const { locked, stored, writeAllowed, projectUnchanged, crossTabInEffect } =
    usePageWriteGuard(guardTenant, pin !== undefined);
  // Asked as each request is sent, through a ref: one identity for the page's
  // lifetime, so a hook mounted before the page's project resolves neither
  // re-fires its mount read nor rebuilds its callbacks when the pin changes.
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const resolvePin = useCallback(() => pinRef.current, []);
  // The provider said its membership read failed, and nothing pins the page's
  // requests: nothing on this page reads the list again.
  const projectListFailed = pin === undefined && listReadFailed(tenantContext);
  const value = useMemo<PageWriteGuardValue>(
    () => ({
      pageTenant,
      mountTenant,
      tenantContext,
      projectListFailed,
      locked,
      writeAllowed,
      projectUnchanged,
      crossTabInEffect,
      pin,
      resolvePin,
    }),
    [
      pageTenant,
      mountTenant,
      tenantContext,
      projectListFailed,
      locked,
      writeAllowed,
      projectUnchanged,
      crossTabInEffect,
      pin,
      resolvePin,
    ]
  );

  const isLocked = locked !== null;
  const listRefused = isTenantsListUnauthorized(tenantContext?.error ?? null);
  const noticeId = useId();
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
          <MustActNotice
            testId="prompt-documents-cross-tab"
            id={noticeId}
            action={
              <ReloadButton
                ref={reloadRef}
                testId="prompt-documents-cross-tab-reload"
              />
            }
          >
            <p>
              {crossTabHeadline(locked)} Until you reload, no change made on
              this page is sent: everything below belongs to{" "}
              {pageProjectLabel(tenantContext, pageTenant, guardTenant)}, and
              the active project is now{" "}
              {noticeProjectLabel(tenantContext, stored)}.
            </p>
          </MustActNotice>
        ) : null}
        {projectListFailed && locked === null ? (
          <MustActNotice
            testId="prompt-documents-project-list-failed"
            action={
              listRefused ? null : (
                <ReloadButton testId="prompt-documents-project-list-failed-reload" />
              )
            }
          >
            {listRefused ? (
              <p>
                Coord would not list your projects (tenant_not_resolved): your
                account has no role that can read them, so no setting on this
                page is read and no change made on it is sent. Ask your
                project&apos;s admin for the operator role.
              </p>
            ) : (
              <p>
                The list of your projects could not be read, so this page&apos;s
                project is unknown. Until you reload, no setting on this page is
                read and no change made on it is sent.
              </p>
            )}
            <p className="text-xs">
              Details:{" "}
              <BackendErrorMessage
                error={tenantContext?.error}
                data-testid="prompt-documents-project-list-failed-error"
              />
            </p>
          </MustActNotice>
        ) : null}
        <fieldset
          ref={fieldsetRef}
          disabled={isLocked}
          aria-describedby={isLocked ? noticeId : undefined}
          className="m-0 min-w-0 border-0 p-0"
          data-testid="prompt-documents-controls"
        >
          {/* The group's accessible name; the first legend, so it names it. */}
          <legend className="sr-only">
            Prompt documents and their settings
          </legend>
          {children}
        </fieldset>
      </div>
    </PageWriteGuardContext.Provider>
  );
}
