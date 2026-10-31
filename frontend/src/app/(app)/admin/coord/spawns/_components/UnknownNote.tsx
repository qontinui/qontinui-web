"use client";

/**
 * UnknownNote — a sentence saying what this page could not read, or that what
 * it shows is the last good read.
 *
 * Painted with `UNKNOWN_AMBER`, the console's ignorance floor (style guide R3,
 * §4.1: nothing outside `console/statusRow` mints an amber). It is a statement
 * about what this page knows: not calm, because nothing says the figure is
 * fine, and not red, because nobody is known to have to act.
 */

import type { HTMLAttributes } from "react";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";

export function UnknownNote({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "m-0 rounded-md border px-2 py-1 text-sm",
        UNKNOWN_AMBER,
        className
      )}
      {...props}
    />
  );
}
