"use client";

/**
 * PresentationModeToggle — the header control that flips the presentation
 * lens (plan `2026-10-23-console-presentation-spaces` D2: "a header toggle
 * flips it").
 *
 * One `aria-pressed` button whose name stays "Presentation mode" in both
 * states, as a toggle button's name must; the pressed state carries on/off,
 * visually as the console's active-tab treatment. While presenting it is the
 * "Presentation mode" chip in the header — the one control that must stay
 * live in front of an audience, so it is navigation-only (it changes what this
 * browser renders and nothing else).
 *
 * It renders nothing where no lens is mounted (`source: "absent"`), and a
 * non-interactive chip under a `FixedPresentationMode`, which offers no way to
 * change the mode — a toggle that does nothing would be a control that lies.
 */

import { Presentation } from "lucide-react";
import { NAVIGATION_ONLY_PROPS } from "@/components/console/navigationOnly";
import { cn } from "@/lib/utils";
import { usePresentationMode } from "./PresentationModeProvider";

const LABEL = "Presentation mode";

const BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors";
const ON = "bg-primary text-primary-foreground";
const OFF = "text-muted-foreground hover:text-foreground hover:bg-muted";

/**
 * What the toggle promises — only what holds on EVERY page: a page registered
 * as presentation-ready has passed `expectPresentationSafe`, and every other
 * lens page is withheld by `PresentationPage`, so the claim is true wherever
 * the toggle is (`ux-priorities` `a-status-signal-must-observe-the-state-it-names`).
 */
export const PRESENTATION_TOGGLE_TITLE_ON =
  "Presentation mode is on: controls, costs, other parties' names and internal identifiers are kept off screen, and a page not yet prepared for presentation is withheld. Press to return to the operator view.";
export const PRESENTATION_TOGGLE_TITLE_OFF =
  "Show the console as a presentation: controls, costs, other parties' names and internal identifiers off screen, and any page not yet prepared for presentation withheld. Nothing about the data changes.";

export interface PresentationModeToggleProps {
  className?: string;
}

export function PresentationModeToggle({
  className,
}: PresentationModeToggleProps) {
  const { presenting, source, setPresenting } = usePresentationMode();
  if (source === "absent") return null;

  if (!setPresenting) {
    if (!presenting) return null;
    return (
      <span
        className={cn(BASE, ON, className)}
        data-testid="presentation-mode-chip"
        data-presentation-mode="on"
      >
        <Presentation className="h-3.5 w-3.5" aria-hidden />
        {LABEL}
      </span>
    );
  }

  return (
    <button
      {...NAVIGATION_ONLY_PROPS}
      type="button"
      aria-pressed={presenting}
      onClick={() => setPresenting(!presenting)}
      title={
        presenting
          ? PRESENTATION_TOGGLE_TITLE_ON
          : PRESENTATION_TOGGLE_TITLE_OFF
      }
      className={cn(BASE, presenting ? ON : OFF, className)}
      data-testid="presentation-mode-toggle"
      data-presentation-mode={presenting ? "on" : "off"}
      data-presentation-source={source}
    >
      <Presentation className="h-3.5 w-3.5" aria-hidden />
      {LABEL}
    </button>
  );
}
