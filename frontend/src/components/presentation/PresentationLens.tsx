"use client";

/**
 * PresentationLens — what a layout mounts to make its pages lens surfaces
 * (plan `2026-10-23-console-presentation-spaces` D1).
 *
 * Mounted ONCE per lens tree: the console layout (`admin/coord/layout.tsx`)
 * and the digital-twin layout (`digital-twin/layout.tsx`). Both share one
 * module-wide mode store, so a presentation started in one tree is still on
 * after a client-side navigation into the other.
 *
 * Everything the lens needs above the page is composed HERE, so a lens tree
 * mounts one component rather than a stack each layout must keep in step:
 *
 * - the mode (`PresentationModeProvider`), D2's resolution order;
 * - the tenant's redaction scope (`PresentationScopeProvider`, fed by
 *   `usePresentationScope`), which every `RedactedText` below reads. Until the
 *   scope is read it is UNKNOWN, and an unknown scope withholds every title
 *   (D3.3 fails closed).
 *
 * The scope is the lens's ONE read, made only while presenting (D3.4):
 * presentation mode changes what renders, never what is read beyond it.
 */

import type { ReactNode } from "react";
import { PresentationModeProvider } from "./PresentationModeProvider";
import { PresentationScopeProvider } from "./presentationScope";
import { usePresentationScope } from "./presentationScopeLoader";

function PresentationScopeFromServer({ children }: { children: ReactNode }) {
  return (
    <PresentationScopeProvider state={usePresentationScope()}>
      {children}
    </PresentationScopeProvider>
  );
}

export function PresentationLens({ children }: { children: ReactNode }) {
  return (
    <PresentationModeProvider>
      <PresentationScopeFromServer>{children}</PresentationScopeFromServer>
    </PresentationModeProvider>
  );
}
