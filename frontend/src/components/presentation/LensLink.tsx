"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { usePresentationMode } from "./PresentationModeProvider";
import { lensLinkTarget } from "./presentationLinks";

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
 * LensLink — a link from a lens page to a page that may not be presentable
 * (plan `2026-10-23-console-presentation-spaces` D2, D3;
 * `console-ui-style-guide.md` §6.5). Where it leads is
 * {@link lensLinkTarget}'s decision.
 *
 * While presenting it carries `?present=1`, so a tab opened from it — which
 * starts with no presentation of its own — still presents; and where the
 * destination cannot be presented (out of the lens trees, or a lens page not
 * registered presentation-ready) it is plain text (`data-lens-link=
 * "unlinked"`), never an anchor: no click leaves the lens or lands on "Shown
 * in the operator view only". Operator mode, and a render with no lens above
 * it, keep their href untouched. Either arm carries `data-lens-link`
 * (`"linked"` on the anchor), so a test asking "was this handed to LensLink?"
 * holds the day a destination is registered and the text becomes an anchor.
 *
 * The page check fails a lens link that drops the presentation
 * (`presentation-dropping-link`, `src/test/presentation.tsx`), and a page's
 * proof can walk it for a link to a page that cannot be presented (as
 * `/digital-twin`'s `page.presentation-proof.test.tsx` does on every tab).
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
    <Link
      href={target}
      className={className}
      data-testid={testId}
      data-lens-link="linked"
      {...props}
    >
      {children}
    </Link>
  );
}
