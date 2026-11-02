"use client";

/**
 * presentationLinks — a link inside the lens carries the presentation with it
 * (plan `2026-10-23-console-presentation-spaces` D2, D3).
 *
 * A presentation lives in the tab: `?present=1` on the URL, or the tab's own
 * recorded choice (sessionStorage), keeps it on across in-app navigation. A
 * link opened in a NEW tab (a modified click, "open in new tab") starts with an
 * empty tab session, so unless its URL says otherwise it opens on the viewer's
 * remembered setting — which a presentation entered by `?present=1` never
 * wrote — and shows the operator view: the drain levers, the hostnames, the
 * other parties' names. Failing OPEN at exactly the moment the presenter is
 * showing something.
 *
 * So while the lens is presenting, a link to another lens page carries
 * `?present=1` itself ({@link usePresentationHref}): the new tab's URL is the
 * presentation's. A link out of the lens trees is left alone (no page there
 * has a presentation mode to enter), and in operator mode every link is
 * untouched. Navigation-only in effect — the URL changes what the destination
 * renders, nothing else.
 *
 * A link whose destination may not be presentable takes the stricter rule,
 * {@link lensLinkTarget} (rendered by `LensLink`): while presenting it is
 * plain text unless its page can be presented.
 */

import { presentationHref } from "./lensSurfaces";
import { usePresentationMode } from "./PresentationModeProvider";
import {
  PRESENTATION_READY_ROUTES,
  isLensTreePath,
  isPresentationReady,
  type PresentationReadyRoute,
} from "./presentationReadiness";

/** `href` as a link inside the lens renders it: carrying `?present=1` while presenting. */
export function usePresentationHref(href: string): string {
  const { presenting, source } = usePresentationMode();
  return lensLinkHref(href, presenting && source !== "absent");
}

/** The pure half of {@link usePresentationHref}. */
export function lensLinkHref(href: string, presenting: boolean): string {
  if (!presenting || !isLensTreePath(href)) return href;
  return presentationHref(href, true);
}

/**
 * Where a link to a page that may not be presentable leads (`LensLink`):
 * `href` as given in operator mode; while presenting, `href` carrying
 * `?present=1` when its page can be presented — inside a lens tree AND
 * registered presentation-ready — and `null` otherwise.
 *
 * `null` is the fail-closed arm (D3): a page out of the lens trees has no
 * presentation mode at all, so one click would drop the lens and show the
 * operator's real page (`/sessions`: session titles, machines); and a lens
 * page not yet proven safe renders only "Shown in the operator view only", a
 * dead end in front of an evaluator. So neither is linked while presenting.
 * The link comes back by itself the day its page is registered in
 * `PRESENTATION_READY_ROUTES`.
 */
export function lensLinkTarget(
  href: string,
  presenting: boolean,
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES
): string | null {
  if (!presenting) return href;
  if (!isLensTreePath(href) || !isPresentationReady(href, routes)) return null;
  return lensLinkHref(href, true);
}
