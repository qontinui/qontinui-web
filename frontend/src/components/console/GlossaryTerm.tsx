"use client";

/**
 * GlossaryTerm — a product term, explained where it is used.
 *
 * **Supports R8** of `frontend/docs/console-ui-style-guide.md` (see §3.2):
 * R8 keeps INTERNAL vocabulary off a primary surface; the product's OWN
 * vocabulary — gate, work unit, merge train, claim — has to stay, because it is
 * what the operator acts on. This is how such a word stays and still explains
 * itself. Plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * Phase C3.
 *
 * ## One source, no request
 *
 * The definition is `GLOSSARY[id].short` from `@qontinui/shared-types/glossary`
 * — generated from the schemas `glossary/terms.toml` by the same generator as
 * the Rust table coord and the runner serve, so the tooltip here and a served
 * `GET /glossary` say the same thing, byte for byte. It is compiled into the
 * bundle, not fetched: the term explains itself when coord is unreachable,
 * which is exactly when an operator is reading a refusal that uses it.
 *
 * ## A typo is a compile error
 *
 * `id` is the generated `GlossaryTerm` union, so a misspelt `id="gat"` does
 * not type-check — there is no "missing tooltip" state to render.
 * `GlossaryTerm.test.tsx` additionally scans every literal `id` in the tree
 * against the table, so a cast around the type is caught too.
 *
 * ## Presentation
 *
 * The children (default: the term's display name) render with a dotted
 * underline and a `help` cursor, as a focusable trigger — the definition is
 * reachable by keyboard and announced as the trigger's description. It carries
 * its own `TooltipProvider` so it renders anywhere, including outside the app
 * layout's provider (a nested provider is how Radix scopes one).
 */

import type { ReactNode } from "react";
import {
  glossaryEntry,
  type GlossaryTerm as GlossaryTermId,
} from "@qontinui/shared-types/glossary";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface GlossaryTermProps {
  /** The term, by its stable glossary id. */
  id: GlossaryTermId;
  /**
   * The words on the surface. Defaults to the glossary's display name; pass
   * them when the surface's own wording differs ("Gates", "work units", a
   * column header), so the phrase reads naturally and still explains itself.
   */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function GlossaryTerm({
  id,
  children,
  className,
  "data-testid": testId,
}: GlossaryTermProps) {
  const entry = glossaryEntry(id);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-glossary-term={id}
            data-testid={testId}
            className={cn(
              "cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
              className
            )}
          >
            {children ?? entry.term}
          </span>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-xs font-normal normal-case tracking-normal"
          data-glossary-definition={id}
        >
          {entry.short}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
