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
 */

import type { ReactNode } from "react";
import { PresentationLens } from "@/components/presentation";

export default function DigitalTwinLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <PresentationLens>{children}</PresentationLens>;
}
