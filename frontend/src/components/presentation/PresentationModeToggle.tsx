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

const TITLE_ON =
  "Presentation mode is on: captions and sources are shown; controls, costs and names that are not yours are hidden. Press to return to the operator view.";
const TITLE_OFF =
  "Show this page as a presentation: captions and sources on; controls, costs and names that are not yours hidden. Nothing about the data changes.";

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
      title={presenting ? TITLE_ON : TITLE_OFF}
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
