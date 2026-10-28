"use client";

import { useCallback, useMemo, useRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { useUIElement } from "@qontinui/ui-bridge/react";

/** What the UI Bridge is told a tour link does: it opens a page, nothing more. */
export const TOUR_LINK_ACTION_DESCRIPTION =
  "Opens this page of the tour in presentation mode. It changes nothing but what this browser tab shows.";

export interface TourLinkProps {
  /** The UI Bridge element id. */
  bridgeId: string;
  /** What following it does, in words — the UI Bridge label of the link and of its action. */
  bridgeLabel: string;
  /** A tour link (`tourHref`): it carries `?present=1` and the tour marker. */
  href: string;
  children: ReactNode;
  /**
   * The accessible name, when the visible text alone does not say where the
   * link goes ("Next" → "Next stop: Dev Ops"). It must begin with the
   * visible text, so a voice user can say what they see.
   */
  accessibleName?: string;
  className?: string;
  /** Receives the anchor, so a key press can follow the very link on screen. */
  linkRef?: Ref<HTMLAnchorElement>;
  "aria-keyshortcuts"?: string;
  "data-testid"?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * TourLink — every link the tour makes (plan
 * `2026-10-23-console-presentation-spaces` Phase 8): to a stop, back to the
 * start, or to the first stop from the tour page.
 *
 * Navigation-only, and it says so twice. On screen it is a link whose URL
 * keeps the presentation (`?present=1`, so a tab opened from it presents)
 * and the tour (`?tour=1`). To the UI Bridge it registers where it renders,
 * and only there, with one custom action, `open`, declared `effect: "read"`
 * — no persistent state changes (D3.2: every registration on a lens page
 * declares its effect, and an undeclared one counts as unsafe). The action
 * follows the anchor itself, so an automated walk, a key press and a click
 * all go exactly where the link on screen says.
 *
 * The caller passes only a `tourHref` result: a page that cannot be
 * presented has no tour link at all, so it never reaches this component.
 */
export function TourLink({
  bridgeId,
  bridgeLabel,
  href,
  children,
  accessibleName,
  className,
  linkRef,
  "aria-keyshortcuts": keyShortcuts,
  "data-testid": testId,
}: TourLinkProps) {
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const customActions = useMemo(
    () => ({
      open: {
        id: "open",
        label: bridgeLabel,
        description: TOUR_LINK_ACTION_DESCRIPTION,
        effect: "read" as const,
        handler: () => {
          anchor.current?.click();
          return true;
        },
      },
    }),
    [bridgeLabel]
  );
  const { ref: bridgeRef } = useUIElement({
    id: bridgeId,
    label: bridgeLabel,
    type: "link",
    customActions,
  });
  const setRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      anchor.current = node;
      bridgeRef(node);
      assignRef(linkRef, node);
    },
    [bridgeRef, linkRef]
  );
  return (
    <Link
      ref={setRef}
      href={href}
      aria-label={accessibleName}
      aria-keyshortcuts={keyShortcuts}
      className={className}
      data-testid={testId}
      data-tour-link=""
    >
      {children}
    </Link>
  );
}
