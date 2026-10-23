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
 * mounts one component rather than a stack each layout must keep in step.
 * Today that is the mode (`PresentationModeProvider`). The tenant's redaction
 * scope is read through `PresentationScopeProvider`'s context, whose default
 * is UNKNOWN — so below a lens with no scope provider every `RedactedText`
 * withholds (D3.3 fails closed); a scope provider mounted inside this
 * component is what lets first-party text through.
 *
 * The lens fetches nothing (D3.4): presentation mode changes what renders,
 * never what is read.
 */

import type { ReactNode } from "react";
import { PresentationModeProvider } from "./PresentationModeProvider";

export function PresentationLens({ children }: { children: ReactNode }) {
  return <PresentationModeProvider>{children}</PresentationModeProvider>;
}
