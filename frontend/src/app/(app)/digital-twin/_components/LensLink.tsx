"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { usePresentationHref } from "@/components/presentation";

/**
 * A link from the twin explorer to a console page (a lens page): it carries
 * `?present=1` while the lens presents, so a tab opened from it — which
 * starts with no presentation of its own — still presents. In operator mode,
 * and for a link out of the lens trees, the `href` is left as given
 * (`usePresentationHref`).
 *
 * Every link to a console page on this route goes through here: the page
 * check fails one that does not (`presentation-dropping-link`,
 * `src/test/presentation.tsx`), and `page.presentation-proof.test.tsx` walks
 * every tab for it.
 */
export function LensLink({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const target = usePresentationHref(href);
  return (
    <Link href={target} {...props}>
      {children}
    </Link>
  );
}
