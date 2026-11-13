"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ACTIVE_TENANT_STORAGE_KEY,
  readActiveTenantId,
} from "@/services/http-client";

/** What the page says when another tab has changed the stored project. */
export const CROSS_TAB_MESSAGE =
  "The active project was changed in another tab — reload to continue.";

/** What {@link usePageWriteGuard} answers. */
export interface PageWriteGuardState {
  /**
   * True while the stored project differs from the page's because ANOTHER
   * tab changed it. The HTTP client reads the stored project per request, so
   * from then on every unpinned write would land in that project while this
   * page shows its own rows — so the page's controls are disabled, writes are
   * refused at call time, and the page asks to be reloaded.
   */
  locked: boolean;
  /**
   * The call-time half of the guard: `locked` covers what is on screen, this
   * covers the race (a switch whose event has not arrived, a dialog already
   * open). `true` lets the request go; `false` sends nothing, says why, and
   * raises the notice. One identity for the page's lifetime.
   */
  writeAllowed: () => boolean;
}

/**
 * The prompt-documents page's cross-tab write guard (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1), against
 * `guardTenant` — the page's project, kept through a provider refresh
 * (`usePageProject`).
 *
 * `locked` is computed against `guardTenant` whenever that is (re-)anchored —
 * first known, or followed to after THIS tab's own switch, whose storage
 * write has already happened by then — and on every `storage` event for the
 * key, which only OTHER tabs receive. Another tab switching back clears it. A
 * page whose project has never been known has nothing to compare and is not
 * guarded.
 */
export function usePageWriteGuard(
  guardTenant: string | null | undefined
): PageWriteGuardState {
  const [crossTabChange, setCrossTabChange] = useState(false);
  useEffect(() => {
    setCrossTabChange(
      guardTenant !== undefined && readActiveTenantId() !== guardTenant
    );
    if (guardTenant === undefined) return;
    const onStorage = (event: StorageEvent) => {
      // `null`: the other tab cleared storage — which clears the project too.
      if (event.key !== null && event.key !== ACTIVE_TENANT_STORAGE_KEY) return;
      setCrossTabChange(readActiveTenantId() !== guardTenant);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [guardTenant]);

  // Read through a ref so `writeAllowed` — and every guarded door built on it
  // — keeps ONE identity for the page's lifetime: a door with a new identity
  // per render would re-fire a dialog's effect and reset the operator's
  // selection.
  const guardTenantRef = useRef(guardTenant);
  guardTenantRef.current = guardTenant;

  // A page whose project has never been known keeps the unguarded behaviour.
  const writeAllowed = useCallback((): boolean => {
    const tenant = guardTenantRef.current;
    if (tenant === undefined || readActiveTenantId() === tenant) return true;
    setCrossTabChange(true);
    toast.error(`${CROSS_TAB_MESSAGE} Nothing was sent.`);
    return false;
  }, []);

  return { locked: crossTabChange, writeAllowed };
}
