"use client";

/**
 * RefreshButton — the icon-only "re-read this surface now" control, named and
 * acknowledged.
 *
 * **Enforces no numbered rule; added under §6.4** of
 * `frontend/docs/console-ui-style-guide.md` (see §3.2) by plan
 * `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves`.
 * Measured 2026-09-12: of the 28 files under `app/(app)/admin/coord/` that
 * render a `RefreshCw`, 18 carried no `aria-label` anywhere. Each was a local
 * `<Button><RefreshCw/></Button>` with no name and no pending state — to a
 * screen reader an unnamed button, to a sighted operator a click that "doesn't
 * seem to do anything". A rule each page has to remember is how it got to 18;
 * this is the thing to compose instead.
 *
 * ## Two props a page cannot leave out
 *
 * - **`label`** is the accessible name (`aria-label`). The control is icon-only,
 *   so without it there is no name at all.
 * - **`title`** names the action AND ITS EFFECT — "returns to the first page",
 *   "also refreshes itself every 10 s". That is the half a bare "Refresh" never
 *   says, and it is what `/admin/coord/alerts` already did by hand.
 *
 * Both are required by the type rather than defaulted, because a default
 * ("Refresh") is exactly the name that says nothing about what is refreshed.
 *
 * ## The pending state belongs to the CLICK
 *
 * `onRefresh` returns the read it issued, and the button is busy for exactly as
 * long as THAT promise is out. Nothing else can reach this state. That is the
 * point, and it is structural rather than a convention: every console page
 * also polls, usually through the same fetch function, and a spinner driven off
 * a shared in-flight flag pulses on its own every poll interval — a page that
 * reads as perpetually loading, the same family of defect this component exists
 * to remove. A page has no prop through which to make that mistake.
 *
 * ## Busy is `aria-disabled`, not `disabled`
 *
 * While busy the button is `aria-disabled` and `aria-busy`, and a press is
 * ignored — but it keeps focus and its place in the tab order. The real
 * `disabled` attribute would blur the button out from under the keyboard user
 * who just pressed it, mid-read; `FilterChips`' `all` chip takes the same
 * position for the same reason (§3.2).
 *
 * A rejected read ends the busy state too: the failure is the page's to
 * render (R6), and a button stuck busy over a failed read would be a second,
 * false report of it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RefreshButtonProps {
  /**
   * Issue the read. Return its promise so the button can acknowledge the press
   * for as long as that read is out; a `void` return acknowledges nothing.
   */
  onRefresh: () => Promise<unknown> | void;
  /** Accessible name — WHAT is refreshed, e.g. `"Refresh plans"`. */
  label: string;
  /** Tooltip naming the action and its EFFECT. */
  title: string;
  className?: string;
  "data-testid"?: string;
}

export function RefreshButton({
  onRefresh,
  label,
  title,
  className,
  "data-testid": testId,
}: RefreshButtonProps) {
  const [busy, setBusy] = useState(false);
  // The re-entry guard reads a ref, not `busy`: two presses inside one render
  // would both see a stale `busy === false` and issue two reads.
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleClick = useCallback(() => {
    if (busyRef.current) return;
    const read = onRefresh();
    if (!read) return;
    busyRef.current = true;
    setBusy(true);
    const settle = () => {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
    read.then(settle, settle);
  }, [onRefresh]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      aria-label={label}
      title={title}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={[busy ? "cursor-progress" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      <RefreshCw
        className={`h-3 w-3${busy ? " animate-spin" : ""}`}
        aria-hidden
      />
    </Button>
  );
}
