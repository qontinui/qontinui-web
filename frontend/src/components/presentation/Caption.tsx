"use client";

/**
 * Caption — a page's or a panel's one-sentence explanation, before its data
 * (plan `2026-10-23-console-presentation-spaces` D1 "captions on", D5).
 *
 * `audience_profile/external-evaluator`: "One sentence per surface, before
 * the data, saying what the surface shows and why it matters. They do not
 * share the vocabulary; the caption is the translation." So in presentation
 * mode a caption renders its title, its one-liner and why it matters, in type
 * sized for a screen share. Product terms inside the copy render through
 * `GlossaryTerm`, so the definition an evaluator can open is the generated
 * glossary's, byte for byte.
 *
 * In operator mode a caption renders NOTHING — the console optimises for the
 * tenth read of the page today, and R9 keeps chrome to one line — unless it is
 * `persistent`: a page whose own title IS its caption (the digital twin) keeps
 * its title and one-liner in operator mode and gains the why-it-matters line
 * in presentation mode.
 *
 * The copy comes from the registry (`./captions`), never from a prop, so all
 * of it is reviewed in one place; `id` is the registry's key union, so a
 * caption that does not exist does not compile. The root carries
 * `data-presentation-caption=<id>`, which is how tests and the tour's UI
 * Bridge walk find it.
 */

import { Fragment } from "react";
import { GlossaryTerm } from "@/components/console/GlossaryTerm";
import { cn } from "@/lib/utils";
import { usePresentationMode } from "./PresentationModeProvider";
import {
  captionEntry,
  captionSegments,
  type CaptionKey,
  type CaptionText,
} from "./captions";

export interface CaptionProps {
  /** The registry key — `<surface>.page`, or `<surface>.<panel>`. */
  id: CaptionKey;
  /** Heading level of the title. Default 2. */
  level?: 1 | 2 | 3;
  /**
   * Also render in operator mode, as the title and one-liner only — for a
   * page whose own heading is this caption. Default false.
   */
  persistent?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Title classes: operator mode keeps the console's sizes; presentation mode is screen-share sized. */
const TITLE_CLASS: Record<
  1 | 2 | 3,
  { operator: string; presentation: string }
> = {
  1: {
    operator: "text-lg font-semibold",
    presentation: "text-2xl font-semibold",
  },
  2: {
    operator: "text-base font-semibold",
    presentation: "text-xl font-semibold",
  },
  3: {
    operator: "text-sm font-semibold",
    presentation: "text-lg font-semibold",
  },
};

/** Caption copy, with each glossary term rendered through `GlossaryTerm`. */
export function CaptionCopy({ text }: { text: CaptionText }) {
  return (
    <>
      {captionSegments(text).map((segment, i) =>
        typeof segment === "string" ? (
          <Fragment key={i}>{segment}</Fragment>
        ) : (
          <GlossaryTerm key={i} id={segment.term}>
            {segment.text}
          </GlossaryTerm>
        )
      )}
    </>
  );
}

export function Caption({
  id,
  level = 2,
  persistent = false,
  className,
  "data-testid": testId,
}: CaptionProps) {
  const { presenting } = usePresentationMode();
  if (!presenting && !persistent) return null;
  const entry = captionEntry(id);
  const Heading = `h${level}` as const;
  const sizes = TITLE_CLASS[level];
  return (
    <div
      className={cn(presenting ? "space-y-1.5" : "space-y-0.5", className)}
      data-testid={testId}
      data-presentation-caption={id}
      data-caption-mode={presenting ? "presentation" : "operator"}
    >
      <Heading className={presenting ? sizes.presentation : sizes.operator}>
        {entry.title}
      </Heading>
      <p
        className={
          presenting
            ? "text-base text-foreground"
            : "text-xs text-muted-foreground"
        }
        data-caption-part="one-liner"
      >
        <CaptionCopy text={entry.oneLiner} />
      </p>
      {presenting && (
        <p
          className="text-sm text-muted-foreground"
          data-caption-part="why-it-matters"
        >
          <CaptionCopy text={entry.whyItMatters} />
        </p>
      )}
    </div>
  );
}
