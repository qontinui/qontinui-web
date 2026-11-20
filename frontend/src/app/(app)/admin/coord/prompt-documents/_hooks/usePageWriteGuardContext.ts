"use client";

import { createContext, useContext } from "react";
import type { useOptionalTenant } from "@/contexts/tenant-context";
import type { ProjectPin } from "@/services/http-client";
import type { ResolvePin } from "../../_shared/useSendTimePin";
import type { CrossTabLock } from "./usePageWriteGuard";

/**
 * What `PageWriteGuardProvider` (`../_components/PageWriteGuard`) gives
 * everything under it: the prompt-documents page's project, its cross-tab
 * write guard, and the pin its requests are sent in — ONE source for the
 * list's rows and the settings beside them (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1).
 */
export interface PageWriteGuardValue {
  /** The page's project; `undefined` while UNKNOWN (`usePageProject`). */
  pageTenant: string | null | undefined;
  /** The project stored when the page mounted (`null`: none stored). */
  mountTenant: string | null;
  /** The layout's tenant provider; `null` when mounted outside one. */
  tenantContext: ReturnType<typeof useOptionalTenant>;
  /**
   * The layout's provider has said its membership read failed, and the page
   * has no project to pin a request to (`pin` undefined). Nothing on this
   * page reads the list again, so no setting is read and no change is sent
   * until the operator acts: the provider shows a red notice (its own, or the
   * cross-tab notice while the page is locked), and a settings section that
   * waits for the page's project points to it.
   */
  projectListFailed: boolean;
  /**
   * Why the page is locked — the stored project differs from the one it
   * shows — or `null` while it is not (`usePageWriteGuard`). A cause, not a
   * flag: the notice names only the cause it observed (D4). Read "is it
   * locked?" as `locked !== null`.
   */
  locked: CrossTabLock | null;
  /**
   * Asked right before every write is sent: `false` sends nothing and says
   * why, while another project is stored (raising the notice) or while the
   * page has no project to pin the write to (`pin` undefined). One identity
   * for the page's lifetime.
   */
  writeAllowed: () => boolean;
  /**
   * Asked before a dialog opens, and before a read with no pin is sent:
   * `false` while another project is stored, raising the notice and saying
   * why. It asks for no pin. One identity for the page's lifetime.
   */
  projectUnchanged: () => boolean;
  /**
   * Whether the stored project differs from the page's at this moment, read
   * at call time, raising the notice when it does — for a refusal stated in
   * a caller's own words (adopt-all's), so the page locks beside it. One
   * identity for the page's lifetime.
   */
  crossTabInEffect: () => boolean;
  /**
   * The project the page's requests are pinned to — the page's, kept through
   * a provider refresh, or the project stored at mount while the page's has
   * never been known; `undefined` while the page's project is `null`, or has
   * never been known with none stored at mount (`usePageProject`). One
   * identity until the project it names changes.
   */
  pin: ProjectPin | undefined;
  /**
   * `pin`, asked for as each request is SENT (D10): one identity for the
   * page's lifetime, so a hook mounted before the page's project resolves
   * keeps its mount read and its callbacks independent of the pin.
   */
  resolvePin: ResolvePin;
}

/** Set by `PageWriteGuardProvider` only. */
export const PageWriteGuardContext = createContext<PageWriteGuardValue | null>(
  null
);

/**
 * The enclosing page's guard, or `null` when nothing under the prompt-documents
 * page's provider rendered this — a component mounted on its own.
 */
export function usePageWriteGuardContext(): PageWriteGuardValue | null {
  return useContext(PageWriteGuardContext);
}

/**
 * The enclosing page's guard, for a component that must never send unguarded
 * — the page's body and the list's. Throws when rendered outside the
 * provider: that is a wiring defect, and failing loudly is the only answer
 * that cannot read as "allowed".
 */
export function useRequiredPageWriteGuard(): PageWriteGuardValue {
  const guard = useContext(PageWriteGuardContext);
  if (guard === null) {
    throw new Error(
      "This prompt-documents component sends on the page's behalf and must be rendered under a PageWriteGuardProvider."
    );
  }
  return guard;
}

/** What a hook that sends on the page's behalf refuses and pins with. */
export interface PageSendGuard {
  /** Asked right before every write is sent; `false` sends nothing. */
  writeAllowed: () => boolean;
  /** Asked as each read and write is sent (`useSendTimePin`). */
  resolvePin: ResolvePin;
}

/**
 * The guard and the pin for a section hook on the prompt-documents page (D9):
 * the hook refuses beside its own send, so no caller can forget to.
 *
 * Always the page's own. Every section is mounted under
 * `PageWriteGuardProvider` (`page.tsx`), and no production code mounts one
 * anywhere else, so there is no answer for "outside a page": that would have
 * to allow every write and pin none, which reads as "allowed" exactly where
 * nothing guards. Rendered outside the provider, this throws, as
 * `useRequiredPageWriteGuard` does. A section's unit test provides a guard of
 * its own (`__fixtures__/pageWriteGuard.tsx`). Both functions keep one
 * identity, so no callback built on them is rebuilt.
 */
export function usePageSendGuard(): PageSendGuard {
  return useRequiredPageWriteGuard();
}
