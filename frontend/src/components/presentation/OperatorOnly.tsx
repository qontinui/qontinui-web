"use client";

/**
 * OperatorOnly — the boundary every write control on a lens surface sits
 * inside (plan `2026-10-23-console-presentation-spaces` D3.2, "no write
 * control").
 *
 * Children render only in operator mode. In presentation mode — and while the
 * mode is unresolved — they are NOT RENDERED: not hidden, unmounted. So their
 * DOM is absent, their UI Bridge registrations (the write and destructive
 * actions an automated walk could fire) are unregistered, and nothing behind
 * them can be reached by a keyboard, a screen reader or an agent. An evaluator
 * does not act, and a write control in front of a client is a hazard, not a
 * feature (`audience_profile/external-evaluator`).
 *
 * `placeholder` renders in their place when given — something
 * navigation-only, such as a link to where the control lives. The
 * presentation helper (`expectPresentationSafe`) checks it like any other
 * presentation-mode content.
 *
 * This is a rendering boundary, not authorization: the server still decides
 * who may write. Outside any lens (no `PresentationModeProvider` above it) the
 * children always render — that page has no presentation mode.
 */

import type { ReactNode } from "react";
import { usePresentationMode } from "./PresentationModeProvider";

export interface OperatorOnlyProps {
  children: ReactNode;
  /** Rendered instead in presentation mode. Must itself be navigation-only. */
  placeholder?: ReactNode;
}

export function OperatorOnly({
  children,
  placeholder = null,
}: OperatorOnlyProps) {
  const { presenting } = usePresentationMode();
  return <>{presenting ? placeholder : children}</>;
}
