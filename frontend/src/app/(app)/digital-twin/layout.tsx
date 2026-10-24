"use client";

/**
 * /digital-twin — the second lens tree (plan
 * `2026-10-23-console-presentation-spaces` D1, D4).
 *
 * The digital twin is the first stop of the presentation tour, and it lives
 * outside the console layout (`admin/coord/layout.tsx`), so it mounts the
 * presentation lens itself: `?present=1` on this URL, or the toggle in the
 * page header, renders it in presentation mode. Both layouts share one mode
 * store, so a presentation carries across a client-side navigation between
 * the twin and the console in either direction.
 *
 * The page body is gated like every lens page (`PresentationPage`): until the
 * twin is registered as presentation-ready, presentation mode withholds it
 * behind its caption. The page's own header carries the toggle, so the
 * withheld placeholder offers it instead (`withToggle`).
 */

import type { ReactNode } from "react";
import { PresentationLens, PresentationPage } from "@/components/presentation";

export default function DigitalTwinLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PresentationLens>
      <PresentationPage withToggle>{children}</PresentationPage>
    </PresentationLens>
  );
}
