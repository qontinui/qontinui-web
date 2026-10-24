"use client";

/**
 * PresentationPage — the gate a lens layout puts around its page body (plan
 * `2026-10-23-console-presentation-spaces` D3: "redaction fails CLOSED, by
 * construction").
 *
 * In operator mode it renders the page. In presentation mode — and while the
 * mode is unresolved — it renders the page only when the route is registered
 * as presentation-ready (`presentationReadiness.ts`, each entry naming the
 * page test that proves it safe). Every other lens page is WITHHELD: its body
 * is not rendered at all, so none of its controls, hostnames, costs or
 * titles reach the screen, the accessibility tree or the UI Bridge registry.
 * In its place: the surface's caption when the route is one of the five lens
 * surfaces, and a plain statement that the page is shown in the operator view
 * only — an honest "not part of the presentation", never a blank.
 *
 * The layout's own chrome (the console header, the red-main banner) sits
 * outside this gate and is presentation-safe on its own.
 */

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Caption } from "./Caption";
import { lensSurfaceForPath } from "./lensSurfaces";
import { usePresentationMode } from "./PresentationModeProvider";
import { PresentationModeToggle } from "./PresentationModeToggle";
import { isPresentationReady } from "./presentationReadiness";

/** The withheld placeholder's heading. */
export const WITHHELD_PAGE_TITLE = "Shown in the operator view only";

/** The withheld placeholder's one sentence. */
export const WITHHELD_PAGE_TEXT =
  "This page has not been prepared for presentation yet, so presentation mode keeps it off screen.";

export interface PresentationPageProps {
  children: ReactNode;
  /**
   * Offer the mode toggle in the withheld placeholder. For a layout whose
   * header does not carry one — the digital twin's toggle is in its page's
   * own header, which the placeholder replaces. Default false.
   */
  withToggle?: boolean;
}

export function PresentationPage({
  children,
  withToggle = false,
}: PresentationPageProps) {
  const { presenting } = usePresentationMode();
  const pathname = usePathname() ?? "";
  if (!presenting || isPresentationReady(pathname)) return <>{children}</>;
  const surface = lensSurfaceForPath(pathname);
  return (
    <div
      className="space-y-4 px-3 py-6 sm:px-6"
      data-testid="presentation-withheld-page"
      data-presentation-withheld=""
    >
      {surface && <Caption id={surface.captionKey} level={1} />}
      <div className="max-w-2xl space-y-1 rounded-md border border-border bg-card px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          {WITHHELD_PAGE_TITLE}
        </p>
        <p className="text-sm text-muted-foreground">{WITHHELD_PAGE_TEXT}</p>
      </div>
      {withToggle && <PresentationModeToggle />}
    </div>
  );
}
