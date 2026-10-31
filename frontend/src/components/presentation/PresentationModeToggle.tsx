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
 *
 * Beside it, while presenting on a scope under which every title is withheld,
 * {@link WithheldNotice} says so: without it a failed read, or a project with
 * no first-party owners, looks like a project with no titles worth showing.
 * The store keeps a failure standing across its retries, so the notice holds
 * until a read answers. Nothing is said while a project's first read is in
 * flight (`loading`, `unknown`), so a read that hangs is silent for as long as
 * it hangs; saying more there would flash on every page load.
 */

import { Presentation } from "lucide-react";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { NAVIGATION_ONLY_PROPS } from "@/components/console/navigationOnly";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePresentationMode } from "./PresentationModeProvider";
import {
  usePresentationScopeState,
  type PresentationScopeState,
} from "./presentationScope";

const LABEL = "Presentation mode";

const SCOPE_FAILED_NOTICE_TITLE =
  "This project's presentation scope could not be established, so every title is replaced by a description of what it is. It is read again by itself. To see why, once you are no longer sharing this screen, open the Presentation scope section of the tenant policy page in the operator view.";
const NO_OWNERS_NOTICE_TITLE =
  "This project has no first-party owners, so every title is replaced by a description of what it is. They come from its registered repositories, or from the Presentation scope section of the tenant policy page, which you can open in the operator view once you are no longer sharing this screen.";

/**
 * Fixed copy, never the scope state's `reason`: a failed read's is a backend's
 * or a browser's own wording, and nothing proves it free of the names this mode
 * keeps off screen (D3.3 fails closed). The tenant-policy panel, in operator
 * mode, shows the reason.
 */
function WithheldNotice({ scope }: { scope: PresentationScopeState }) {
  if (scope.status === "error") {
    return (
      <Badge
        variant="outline"
        className={UNKNOWN_AMBER}
        title={SCOPE_FAILED_NOTICE_TITLE}
        data-testid="presentation-scope-failed-notice"
      >
        Titles withheld: scope unknown
      </Badge>
    );
  }
  if (scope.status === "ready" && scope.scope.firstPartyOwners.length === 0) {
    return (
      <Badge
        variant="outline"
        title={NO_OWNERS_NOTICE_TITLE}
        data-testid="presentation-no-owners-notice"
      >
        Titles withheld: no first-party owners
      </Badge>
    );
  }
  return null;
}

const BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors";
const ON = "bg-primary text-primary-foreground";
const OFF = "text-muted-foreground hover:text-foreground hover:bg-muted";

/**
 * What the toggle promises — only what holds on EVERY page AND in the shell
 * around it: a page registered as presentation-ready has passed
 * `expectPresentationSafe`, every other lens page is withheld by
 * `PresentationPage`, and the shell keeps its own write controls inside
 * `OperatorOnly` (`app/(app)/layout.presentation.population.test.tsx` checks
 * the shell whole). The one exception is named rather than hidden: the
 * presenter's own safety controls (`components/console/presenterSafety.ts`, a
 * closed list) stay live, so the claim is true wherever the toggle is
 * (`ux-priorities` `a-status-signal-must-observe-the-state-it-names`).
 */
export const PRESENTATION_TOGGLE_TITLE_ON =
  "Presentation mode is on: controls that change anything, costs, other parties' names and internal identifiers are kept off screen — all but your own safety controls (stopping the AI co-pilot or a recording, and the session-expiry prompt) — and a page not yet prepared for presentation is withheld. Press to return to the operator view.";
export const PRESENTATION_TOGGLE_TITLE_OFF =
  "Show the console as a presentation: controls that change anything, costs, other parties' names and internal identifiers off screen — all but your own safety controls (stopping the AI co-pilot or a recording, and the session-expiry prompt) — and any page not yet prepared for presentation withheld. Nothing about the data changes.";

export interface PresentationModeToggleProps {
  className?: string;
}

export function PresentationModeToggle({
  className,
}: PresentationModeToggleProps) {
  const { presenting, source, setPresenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  if (source === "absent") return null;
  if (!setPresenting && !presenting) return null;

  // One wrapper in every state, so the notice coming and going never remounts
  // the control, which would drop keyboard focus; the notice goes ahead of it,
  // so the control keeps the row's far end.
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
    >
      {presenting && <WithheldNotice scope={scope} />}
      {setPresenting ? (
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
          className={cn(BASE, presenting ? ON : OFF)}
          data-testid="presentation-mode-toggle"
          data-presentation-mode={presenting ? "on" : "off"}
          data-presentation-source={source}
        >
          <Presentation className="h-3.5 w-3.5" aria-hidden />
          {LABEL}
        </button>
      ) : (
        <span
          className={cn(BASE, ON)}
          data-testid="presentation-mode-chip"
          data-presentation-mode="on"
        >
          <Presentation className="h-3.5 w-3.5" aria-hidden />
          {LABEL}
        </span>
      )}
    </div>
  );
}
