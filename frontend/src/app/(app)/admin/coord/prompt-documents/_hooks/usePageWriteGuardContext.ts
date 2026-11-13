"use client";

import { createContext, useContext } from "react";
import type { useOptionalTenant } from "@/contexts/tenant-context";
import type { ProjectPin } from "@/services/http-client";
import type { ResolvePin } from "../../_shared/useSendTimePin";

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
  /** True while another tab's project switch is in effect (`usePageWriteGuard`). */
  locked: boolean;
  /**
   * The call-time guard: `false` sends nothing, says why and raises the
   * notice. One identity for the page's lifetime.
   */
  writeAllowed: () => boolean;
  /**
   * The project the page's requests are pinned to — the page's, kept through
   * a provider refresh; `undefined` while it is `null` or has never been
   * known (`usePageProject`). Never the project stored when the page
   * mounted. One identity until the project it names changes.
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

/** Outside any provider: nothing refuses a write, and nothing is pinned. */
const STANDALONE: PageSendGuard = {
  writeAllowed: () => true,
  resolvePin: () => undefined,
};

/**
 * The guard and the pin for a section hook on the prompt-documents page (D9):
 * the hook refuses beside its own send, so no caller can forget to.
 *
 * Under the page's provider, the page's own — always: every section the page
 * renders is under `PageWriteGuardProvider` by construction (`page.tsx`; its
 * body requires the provider, `useRequiredPageWriteGuard`). Outside any
 * provider — a section mounted on its own, as its unit tests mount it — there
 * is no page whose project could change under it: every write is sent, in the
 * project stored when it is made, as before the page wired a guard. Both
 * answers keep one identity, so no callback built on them is rebuilt.
 */
export function usePageSendGuard(): PageSendGuard {
  return useContext(PageWriteGuardContext) ?? STANDALONE;
}
