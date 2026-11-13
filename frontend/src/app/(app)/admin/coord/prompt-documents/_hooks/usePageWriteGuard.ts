"use client";

import {
  useCallback,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  ACTIVE_TENANT_STORAGE_KEY,
  readActiveTenantId,
} from "@/services/http-client";

/**
 * Why the page is locked. It names only the cause the page OBSERVED (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D4):
 *
 * - `another_tab` — a `storage` event delivered the project stored now. That
 *   event fires only in OTHER documents, so its arrival proves another tab
 *   changed it.
 * - `unattributed` — the stored project differs from the page's and no event
 *   has delivered it: the change was read at call time, ahead of its event, or
 *   this tab made it without the page following.
 */
export type CrossTabLock = "another_tab" | "unattributed";

/** The first sentence of the notice and of the refusal toast, for `cause`. */
export function crossTabHeadline(cause: CrossTabLock): string {
  return cause === "another_tab"
    ? "The active project was changed in another tab — reload to continue."
    : "The active project changed since this page loaded — reload to continue.";
}

/**
 * Whether a `storage` event can have changed the stored project: an event for
 * its own key, or one whose key is `null`. A `null` key is another tab's
 * `localStorage.clear()`, which empties the selection too.
 */
function concernsTheProject(event: StorageEvent): boolean {
  return event.key === null || event.key === ACTIVE_TENANT_STORAGE_KEY;
}

/**
 * The cause of a difference between `stored` and the page's project.
 * `eventStored` is the project the newest `storage` event left stored
 * (`undefined`: no event yet), and it names another tab only when it is
 * `stored` itself.
 */
function attribute(
  stored: string | null,
  eventStored: string | null | undefined
): CrossTabLock {
  return eventStored === stored ? "another_tab" : "unattributed";
}

/** What {@link usePageWriteGuard} answers. */
export interface PageWriteGuardState {
  /**
   * Why the page is locked, or `null` while it is not. It is locked while the
   * stored project differs from the page's. The HTTP client reads the stored
   * project per request, so from then on every unpinned write would land in
   * that project while this page shows its own rows. So the page's controls
   * are disabled, writes are refused at call time, and the page asks to be
   * reloaded.
   */
  locked: CrossTabLock | null;
  /** The project stored now (`null`: none), as of this render. */
  stored: string | null;
  /**
   * The call-time half of the guard: `locked` covers what is on screen, and
   * this covers the race (a switch whose event has not arrived, or a dialog
   * already open). `true` lets the request go. `false` sends nothing, says
   * why, and raises the notice. One identity for the page's lifetime.
   */
  writeAllowed: () => boolean;
  /**
   * Whether the stored project differs from the page's at this moment, read
   * at call time, ahead of any event. When it does, the notice is raised. For
   * a caller that refuses in its own words, as adopt-all's dialog does, so
   * the page locks beside that refusal. `writeAllowed` is built on it. One
   * identity for the page's lifetime.
   */
  crossTabInEffect: () => boolean;
}

/**
 * The prompt-documents page's cross-tab write guard (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1, D3, D4), against
 * `reference`: the project the page shows (`usePageProject` `guardTenant`).
 * That is the page's project, else the last one known, else, while it has
 * never been known, the project stored at mount. The reference is never
 * absent, so the guard is never off.
 *
 * The lock is DERIVED at render (D3). The stored project is read through
 * `useSyncExternalStore`, subscribed to `storage` from mount, and compared
 * with the reference on every render. There is no anchor step to forget and
 * no listener gap while the page's project is UNKNOWN. Another tab switching
 * back clears it.
 */
export function usePageWriteGuard(
  reference: string | null
): PageWriteGuardState {
  // The project the newest `storage` event left stored: what another tab is
  // PROVEN to have stored (`undefined`: no event yet). A state, so an event
  // that arrives after the call-time check already found its change still
  // re-renders to name that tab; the ref is the same value for the call-time
  // toast.
  const [eventStored, setEventStored] = useState<string | null | undefined>(
    undefined
  );
  const eventStoredRef = useRef<string | null | undefined>(undefined);
  const subscribe = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (!concernsTheProject(event)) return;
      const now = readActiveTenantId();
      eventStoredRef.current = now;
      setEventStored(now);
      onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const stored = useSyncExternalStore(
    subscribe,
    readActiveTenantId,
    readActiveTenantId
  );
  const locked = stored === reference ? null : attribute(stored, eventStored);

  // Read through a ref so `crossTabInEffect` and `writeAllowed`, and every
  // guarded door built on them, keep ONE identity for the page's lifetime. A
  // door with a new identity per render would re-fire a dialog's effect and
  // reset the operator's selection.
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  // Re-renders the page, so the lock derived above reads the store again and
  // shows a change the call-time check found before its event arrived.
  const [, raise] = useReducer((renders: number) => renders + 1, 0);

  const crossTabInEffect = useCallback((): boolean => {
    if (readActiveTenantId() === referenceRef.current) return false;
    raise();
    return true;
  }, []);

  const writeAllowed = useCallback((): boolean => {
    if (!crossTabInEffect()) return true;
    const cause = attribute(readActiveTenantId(), eventStoredRef.current);
    toast.error(`${crossTabHeadline(cause)} Nothing was sent.`);
    return false;
  }, [crossTabInEffect]);

  return { locked, stored, writeAllowed, crossTabInEffect };
}
