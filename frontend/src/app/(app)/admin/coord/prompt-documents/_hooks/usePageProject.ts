"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalTenant } from "@/contexts/tenant-context";
import { readActiveTenantId, type ProjectPin } from "@/services/http-client";

/** The prompt-documents page's project, as {@link usePageProject} resolves it. */
export interface PageProject {
  /**
   * The project stored when this page mounted (`null`: none stored yet) —
   * the one its first status read is pinned to. Captured once, before any
   * request was sent.
   */
  mountTenant: string | null;
  /** The layout's tenant provider; `null` when mounted outside one. */
  tenantContext: ReturnType<typeof useOptionalTenant>;
  /**
   * The page's project: as first resolved, until THIS tab switches project
   * through the provider — then the page follows it (and re-reads). Another
   * tab's switch is not followed: it is detected (`usePageWriteGuard`) and
   * every write is withheld until the page is reloaded. `undefined` while
   * UNKNOWN, and UNKNOWN offers nothing.
   */
  pageTenant: string | null | undefined;
  /**
   * The project the cross-tab GUARD compares against: the page's project, or
   * — once that has been known — the last one known while it is UNKNOWN
   * again. A provider `refresh()` (a project rename, for one) puts the
   * provider back into `loading`, which makes `pageTenant` UNKNOWN for that
   * round trip; the rows on screen are still the last known project's, so
   * the guard must not lift. Only the guard and the pin read this: Adopt all
   * and the list re-reads keep treating UNKNOWN as offering nothing.
   */
  guardTenant: string | null | undefined;
  /**
   * The project every row read and write is SENT in, on every attempt — the
   * HTTP client otherwise reads the stored project per attempt, so a request
   * retried or replayed after another tab's switch would land in, or answer
   * from, that project. Taken from `guardTenant`, not bare `pageTenant`, so a
   * provider `refresh()` neither drops the pin for its round trip nor flips
   * the pinned readers' identity, which would re-fire an open dialog's reads.
   *
   * Only a NAMED project is pinned. `undefined` while the page's project has
   * never been known, and while it is `null` (none selected): a `null` pin
   * sends no header, so the client would fill in whatever project is stored on
   * every attempt — another tab's, after a switch — and it would also give up
   * the request's retries. Without a pin, the list's dialog readers are
   * refused at call time instead, like its write doors. One identity until
   * the project it names changes.
   */
  pin: ProjectPin | undefined;
}

/**
 * Which project the prompt-documents page shows, and which one its requests
 * are pinned to (plan `2026-11-09-prompt-documents-cross-tab-write-guard` D1:
 * the one source of the page's project, read by `PageWriteGuardProvider`).
 */
export function usePageProject(): PageProject {
  const [mountTenant] = useState<string | null>(() => readActiveTenantId());
  const tenantContext = useOptionalTenant();
  // Whether the provider was still loading when this page mounted — i.e.
  // whether its reconcile is of the SAME stored project this page's first
  // reads carried. The layout's provider outlives client-side navigation and
  // never follows another tab's write, so one that had loaded earlier can name
  // a project this page was never served in.
  const [providerLoadingAtMount] = useState<boolean>(
    () => tenantContext !== null && tenantContext.loading
  );
  /**
   * The project this page's reads were SERVED in — `undefined` while that is
   * not known — as first resolved.
   *
   * - No provider (mounted standalone, under test): the project the page
   *   loaded with.
   * - The project the page loaded with is in the provider's membership list:
   *   that project — coord serves a member id as asked.
   * - It is not (none stored yet, or a stale id), and the provider was still
   *   loading when this page mounted: the provider's RECONCILED project. Those
   *   first reads were served the home project (coord's override is
   *   fail-soft), and the provider's reconcile of that same stored value is
   *   the home project too — so a fresh browser's seed is not a switch.
   * - It is not, and the provider had loaded before this page mounted (a
   *   client-side navigation): UNKNOWN. The provider's project then predates
   *   this page and says nothing about what its reads were served.
   * - The provider is loading, or failed: UNKNOWN.
   *
   * UNKNOWN offers nothing.
   */
  const resolvedPageTenant: string | null | undefined = (() => {
    if (tenantContext === null) return mountTenant;
    if (tenantContext.loading || tenantContext.error !== null) {
      return undefined;
    }
    if (
      mountTenant !== null &&
      tenantContext.tenants.some((t) => t.id === mountTenant)
    ) {
      return mountTenant;
    }
    return providerLoadingAtMount ? tenantContext.activeTenantId : undefined;
  })();
  const providerReady =
    tenantContext !== null &&
    !tenantContext.loading &&
    tenantContext.error === null;
  // The provider's project as this page last saw it loaded, and the project
  // the page followed it to. A CHANGE of the provider's project is THIS tab
  // switching project through the provider (another tab's write never
  // reaches this tab's provider), and the page follows it — to whichever
  // project it changed to, the one the provider had loaded in included.
  const providerTenant = providerReady
    ? tenantContext.activeTenantId
    : undefined;
  const [seenProviderTenant, setSeenProviderTenant] = useState<
    string | null | undefined
  >(providerTenant);
  const [followedTenant, setFollowedTenant] = useState<
    string | null | undefined
  >(undefined);
  useEffect(() => {
    if (providerTenant === undefined || providerTenant === seenProviderTenant) {
      return;
    }
    if (seenProviderTenant !== undefined) setFollowedTenant(providerTenant);
    setSeenProviderTenant(providerTenant);
  }, [providerTenant, seenProviderTenant]);
  const pageTenant: string | null | undefined =
    followedTenant !== undefined ? followedTenant : resolvedPageTenant;

  const lastKnownPageTenant = useRef<string | null | undefined>(undefined);
  if (pageTenant !== undefined) lastKnownPageTenant.current = pageTenant;
  const guardTenant: string | null | undefined =
    pageTenant !== undefined ? pageTenant : lastKnownPageTenant.current;

  const pin = useMemo<ProjectPin | undefined>(
    () =>
      typeof guardTenant === "string" ? { tenant: guardTenant } : undefined,
    [guardTenant]
  );

  return { mountTenant, tenantContext, pageTenant, guardTenant, pin };
}
