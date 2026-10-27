"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import {
  PRESENTATION_READY_ROUTES,
  isLensTreePath,
  isPresentationReady,
  lensLinkHref,
  usePresentationMode,
  type PresentationReadyRoute,
} from "@/components/presentation";

/**
 * Where a link from the twin explorer leads: `href` as given in operator
 * mode; while presenting, `href` carrying `?present=1` when its page can be
 * presented — inside a lens tree AND registered presentation-ready — and
 * `null` otherwise.
 *
 * `null` is the fail-closed arm (plan `2026-10-23-console-presentation-spaces`
 * D3): a page out of the lens trees has no presentation mode at all, so one
 * click would drop the lens and show the operator's real page (`/sessions`:
 * session titles, machines); and a lens page not yet proven safe renders only
 * "Shown in the operator view only", a dead end in front of an evaluator. So
 * neither is linked while presenting. The link comes back by itself the day
 * its page is registered in `PRESENTATION_READY_ROUTES`.
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

export type LensLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "children"
> & {
  href: string;
  children: ReactNode;
  /**
   * The classes of the plain text that stands in for the link while
   * presenting, when its page cannot be presented. Default: none, so it
   * reads as text rather than as a link.
   */
  textClassName?: string;
  "data-testid"?: string;
};

/**
 * A link from the twin explorer to a console page ({@link lensLinkTarget}).
 * While presenting it carries `?present=1`, so a tab opened from it — which
 * starts with no presentation of its own — still presents; and where the
 * destination cannot be presented it is plain text (`data-lens-link=
 * "unlinked"`), never an anchor. Operator mode is untouched.
 *
 * Every link to a console page on this route goes through here: the page
 * check fails one that drops the presentation (`presentation-dropping-link`,
 * `src/test/presentation.tsx`), and `page.presentation-proof.test.tsx` walks
 * every tab for a link to a page that cannot be presented.
 */
export function LensLink({
  href,
  children,
  className,
  textClassName,
  "data-testid": testId,
  ...props
}: LensLinkProps) {
  const { presenting, source } = usePresentationMode();
  // No lens above (`absent`) is operator mode, as for usePresentationHref.
  const target = lensLinkTarget(href, presenting && source !== "absent");
  if (target === null) {
    return (
      <span
        data-testid={testId}
        data-lens-link="unlinked"
        className={textClassName}
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={target} className={className} data-testid={testId} {...props}>
      {children}
    </Link>
  );
}
