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
  type ProjectPin,
} from "@/services/http-client";
import type { ResolvePin } from "../../_shared/useSendTimePin";

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
 * Why a write is refused on a page with no project to pin it to: none is
 * selected, or the page's project has never been known and none was stored at
 * mount. Nothing can hold such a write, its 429 retries or its token-refresh
 * replay to the project the page's documents were read in: the client fills
 * in whatever project is stored when each attempt is made. While the layout's
 * provider is still reading the page's project, the refusal is
 * `LEARNING_REFUSAL` instead: that read may give the page a project to pin
 * the write to.
 */
export const NO_PIN_REFUSAL =
  "Nothing was sent: this page has no project to send a change in. Select a project, or reload the page.";

/**
 * Why a write is refused when coord refused to list the account's projects
 * (`tenant_not_resolved`): reloading repeats the refusal, so it asks for none
 * and points at the notice, which names the way out.
 */
export const LIST_REFUSED_REFUSAL =
  "Nothing was sent: coord refused to list your projects, so this page has no project to send a change in. The notice on this page says what to do.";

/**
 * Why a write, or a dialog, is refused while the page is still learning its
 * project (`usePageWriteGuard` `learning`): the stored project differs, or
 * the page has no project to pin a write to yet. Either may resolve by itself
 * once the page knows its project, so the refusal asks for no reload.
 */
export const LEARNING_REFUSAL =
  "Nothing was sent: this page's project is not known yet.";

/**
 * The pin a write on the page's behalf is sent in, asked right before it is
 * sent, beside the send. `undefined` sends nothing: the page's guard refused
 * the write and said why, or there is no project to pin it to, said here. So
 * no write goes out unpinned on the strength of a check made anywhere else.
 */
export function pinForWrite(
  writeAllowed: () => boolean,
  sendPin: ResolvePin
): ProjectPin | undefined {
  if (!writeAllowed()) return undefined;
  const pin = sendPin();
  if (pin === undefined) toast.error(NO_PIN_REFUSAL);
  return pin;
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
   * Asked right before every WRITE is sent: the call-time half of the guard.
   * `locked` covers what is on screen, and this covers the race (a switch
   * whose event has not arrived, or a dialog already open). `false` sends
   * nothing and says why. That is so while another project is stored, when
   * the notice is raised too, and while the page has no project to pin the
   * write to (`canPin`). `true` lets the write go. One identity for the
   * page's lifetime.
   */
  writeAllowed: () => boolean;
  /**
   * Asked before a dialog opens, and before a read that has no pin is sent:
   * `false` while another project is stored, raising the notice and saying
   * why. Unlike `writeAllowed` it does not ask for a pin: a page with no
   * project to pin a write to can still show its own documents. One identity
   * for the page's lifetime.
   */
  projectUnchanged: () => boolean;
  /**
   * Whether the stored project differs from the page's at this moment, read
   * at call time, ahead of any event. When it does, the notice is raised. For
   * a caller that refuses in its own words, as adopt-all's dialog does, so
   * the page locks beside that refusal. `projectUnchanged` and
   * `writeAllowed` are built on it. One identity for the page's lifetime.
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
 *
 * `canPin` says whether the page has a project to pin a write to
 * (`usePageProject` `pin`). Without one, every write is refused: nothing
 * could hold it, or a retry or replay of it, to the page's project.
 *
 * `learning` says the page's project has never been known and the layout's
 * provider is still reading it. A stored project that differs then may be
 * the very one that read names (two fresh tabs), and the lock lifts by
 * itself when it lands. The guard refuses as always, but its refusal, of a
 * difference or of a write with no project to pin it to, says the page's
 * project is not known yet rather than asking for a reload.
 *
 * `listRefused` says coord refused to list the account's projects, which a
 * reload repeats: a write with no project to pin it to then says that, and
 * points at the notice, instead of asking for a reload.
 */
export function usePageWriteGuard(
  reference: string | null,
  canPin: boolean,
  learning = false,
  listRefused = false
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
  const canPinRef = useRef(canPin);
  canPinRef.current = canPin;
  const learningRef = useRef(learning);
  learningRef.current = learning;
  const listRefusedRef = useRef(listRefused);
  listRefusedRef.current = listRefused;
  // Re-renders the page, so the lock derived above reads the store again and
  // shows a change the call-time check found before its event arrived.
  const [, raise] = useReducer((renders: number) => renders + 1, 0);

  const crossTabInEffect = useCallback((): boolean => {
    if (readActiveTenantId() === referenceRef.current) return false;
    raise();
    return true;
  }, []);

  const projectUnchanged = useCallback((): boolean => {
    if (!crossTabInEffect()) return true;
    if (learningRef.current) {
      toast.error(LEARNING_REFUSAL);
      return false;
    }
    const cause = attribute(readActiveTenantId(), eventStoredRef.current);
    toast.error(`${crossTabHeadline(cause)} Nothing was sent.`);
    return false;
  }, [crossTabInEffect]);

  const writeAllowed = useCallback((): boolean => {
    if (!projectUnchanged()) return false;
    if (canPinRef.current) return true;
    toast.error(
      learningRef.current
        ? LEARNING_REFUSAL
        : listRefusedRef.current
          ? LIST_REFUSED_REFUSAL
          : NO_PIN_REFUSAL
    );
    return false;
  }, [projectUnchanged]);

  return { locked, stored, writeAllowed, projectUnchanged, crossTabInEffect };
}
