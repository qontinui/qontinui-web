"use client";

/**
 * PresentationShell — the presentation mode for the app shell around a lens
 * page (plan `2026-10-23-console-presentation-spaces` D3).
 *
 * The lens layouts (`LENS_TREES`) sit INSIDE the authenticated shell, so the
 * sidebar beside them — its project switcher, its runner line, its account
 * menu — would otherwise be outside every lens: in operator mode on a page
 * the presenter is showing. `app/(app)/layout.tsx` mounts this around the
 * whole shell instead. It is the one `PresentationModeProvider` of the tab,
 * enabled only on a lens-tree route; on every other route it supplies the
 * ABSENT mode, so a page with no lens has no presentation mode anywhere on
 * screen. The lens layouts' own `PresentationLens` reuses it.
 */

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PresentationModeProvider } from "./PresentationModeProvider";
import type { PresentationModeStore } from "./presentationModeStore";
import { isLensTreePath } from "./presentationReadiness";

export interface PresentationShellProps {
  children: ReactNode;
  /** The mode's stores; the module-wide store by default (a test passes its own). */
  store?: PresentationModeStore;
}

export function PresentationShell({ children, store }: PresentationShellProps) {
  const pathname = usePathname() ?? "";
  return (
    <PresentationModeProvider enabled={isLensTreePath(pathname)} store={store}>
      {children}
    </PresentationModeProvider>
  );
}
