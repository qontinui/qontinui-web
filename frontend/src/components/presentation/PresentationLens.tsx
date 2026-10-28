"use client";

/**
 * PresentationLens — what a layout mounts to make its pages lens surfaces
 * (plan `2026-10-23-console-presentation-spaces` D1).
 *
 * Mounted ONCE per lens tree: the console layout (`admin/coord/layout.tsx`)
 * and the digital-twin layout (`digital-twin/layout.tsx`); those are
 * `LENS_TREES` (`presentationReadiness.ts`). Both share one module-wide mode
 * store, so a presentation started in one tree is still on after a
 * client-side navigation into the other.
 *
 * Everything the lens needs above the page is composed HERE, so a lens tree
 * mounts one component rather than a stack each layout must keep in step:
 *
 * - the mode — the app shell's own provider (`PresentationShell`, which puts
 *   the sidebar around the page in the same mode), or, where a layout renders
 *   without the shell, a `PresentationModeProvider` of its own. Either way D2's
 *   resolution order over the one store;
 * - the tenant's redaction scope (`PresentationScopeProvider`, fed by
 *   `usePresentationScope`), which every `RedactedText` below reads. Until the
 *   scope is read it is UNKNOWN, and an unknown scope withholds every title
 *   (D3.3 fails closed).
 *
 * The page body itself is gated by `PresentationPage`, which the layout puts
 * around its children: a page not registered as presentation-ready is
 * withheld in presentation mode.
 *
 * The scope is the lens's ONE read, made only while presenting (D3.4):
 * presentation mode changes what renders, never what is read beyond it.
 *
 * And the tour's chrome: the `TourBar` is mounted here, ONCE, so both lens
 * trees carry it, above the layout and outside its `PresentationPage` gate.
 * It renders only while presenting on the tour (`tour/TourBar.tsx`). Because
 * the bar takes a row of its own, the lens owns the height: it is a column
 * filling its parent — the bar, then the layout in the space left — and a
 * lens layout's root fills the lens (`h-full`) instead of fixing its own
 * height, which a bar above it would push off the bottom of the screen.
 */

import type { ReactNode } from "react";
import {
  PresentationModeProvider,
  usePresentationMode,
} from "./PresentationModeProvider";
import { PresentationScopeProvider } from "./presentationScope";
import { usePresentationScope } from "./presentationScopeLoader";
import { TourBar } from "./tour/TourBar";

function PresentationScopeFromServer({ children }: { children: ReactNode }) {
  return (
    <PresentationScopeProvider state={usePresentationScope()}>
      {children}
    </PresentationScopeProvider>
  );
}

export function PresentationLens({ children }: { children: ReactNode }) {
  const outer = usePresentationMode();
  const lens = (
    <PresentationScopeFromServer>
      <div
        className="flex h-full min-h-0 flex-col"
        data-testid="presentation-lens"
      >
        <TourBar />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </PresentationScopeFromServer>
  );
  // The shell's provider is above every lens tree in the app; a second one
  // here would resolve the same store twice.
  if (outer.source !== "absent") return lens;
  return <PresentationModeProvider>{lens}</PresentationModeProvider>;
}
