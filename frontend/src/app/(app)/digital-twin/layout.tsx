"use client";

/**
 * /digital-twin — the second lens tree (plan
 * `2026-10-23-console-presentation-spaces` D1, D4).
 *
 * The digital twin is the first stop of the presentation tour, and it lives
 * outside the console layout (`admin/coord/layout.tsx`), so it mounts the
 * presentation lens itself: `?present=1` on this URL, or the toggle in the
 * lens bar above the page, renders it in presentation mode. Both layouts share
 * one mode store, so a presentation carries across a client-side navigation
 * between the twin and the console in either direction.
 *
 * The page body is gated like every lens page (`PresentationPage`): until the
 * twin is registered as presentation-ready, presentation mode withholds it
 * behind its caption. The toggle sits in the layout's own bar, OUTSIDE that
 * gate, as the console's sits in its header: inside the page it would be
 * unmounted by its own press — the body swapping for the placeholder — taking
 * keyboard focus with it and reappearing somewhere else.
 */

import type { ReactNode } from "react";
import {
  PresentationLens,
  PresentationModeToggle,
  PresentationPage,
} from "@/components/presentation";

export default function DigitalTwinLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PresentationLens>
      <div
        className="flex h-full flex-col overflow-hidden bg-background"
        data-testid="digital-twin-layout"
      >
        <div
          className="flex shrink-0 items-center justify-end border-b border-border px-6 py-1.5"
          data-testid="digital-twin-lens-bar"
        >
          <PresentationModeToggle />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PresentationPage>{children}</PresentationPage>
        </div>
      </div>
    </PresentationLens>
  );
}
