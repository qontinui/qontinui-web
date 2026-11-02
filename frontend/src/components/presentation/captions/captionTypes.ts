/**
 * captionTypes — the shape of a presentation caption, and the two helpers its
 * copy is written with (plan `2026-10-23-console-presentation-spaces` D5).
 *
 * A caption is `{ title, oneLiner, whyItMatters }`, for a page or one of its
 * panels. The registry holds only those surface and panel sentences; a PRODUCT
 * TERM inside one is written `term("gate", "gates")` and renders through
 * `components/console/GlossaryTerm.tsx`, whose definition is generated from
 * `@qontinui/shared-types/glossary`. So a caption never re-defines a term, and
 * the two cannot drift (D5). `term`'s id is the generated union, so a misspelt
 * term is a compile error.
 *
 *     oneLiner: copy`Every ${term("gate", "gate")} the system is waiting on.`,
 *
 * Captions are copy for an external evaluator
 * (`audience_profile/external-evaluator`): plain words, one sentence for the
 * one-liner, no internal identifiers — `captions.test.ts` enforces the
 * mechanical half of that.
 */

import {
  glossaryEntry,
  type GlossaryTerm as GlossaryTermId,
} from "@qontinui/shared-types/glossary";

/** A product term inside caption copy. `text` is the surface's wording. */
export interface CaptionTermSegment {
  readonly term: GlossaryTermId;
  readonly text?: string;
}

export type CaptionSegment = string | CaptionTermSegment;

/** Caption copy: plain text, or text with glossary terms in it. */
export type CaptionText = string | readonly CaptionSegment[];

export interface CaptionEntry {
  /** The page's or panel's name, in the reader's words. */
  readonly title: string;
  /** ONE sentence: what this shows. */
  readonly oneLiner: CaptionText;
  /** Why it matters to someone judging the product — rendered in presentation mode. */
  readonly whyItMatters: CaptionText;
}

/**
 * One surface's captions: keys are `<surface>.<panel>`, and `<surface>.page`
 * — the page-level caption — is required. The template-literal key type makes
 * an entry filed under another surface's prefix a compile error.
 */
export type SurfaceCaptions<S extends string> = {
  readonly [K in `${S}.page`]: CaptionEntry;
} & {
  readonly [K in `${S}.${string}`]: CaptionEntry;
};

/** A glossary term inside caption copy. */
export function term(id: GlossaryTermId, text?: string): CaptionTermSegment {
  return text === undefined ? { term: id } : { term: id, text };
}

/**
 * Caption copy as a tagged template: literal text, with `term(...)` segments
 * interpolated. Empty literal runs are dropped.
 */
export function copy(
  strings: TemplateStringsArray,
  ...terms: CaptionTermSegment[]
): readonly CaptionSegment[] {
  const out: CaptionSegment[] = [];
  strings.forEach((literal, i) => {
    if (literal) out.push(literal);
    const segment = terms[i];
    if (segment) out.push(segment);
  });
  return out;
}

/** The segments of caption copy, whichever form it was written in. */
export function captionSegments(text: CaptionText): readonly CaptionSegment[] {
  return typeof text === "string" ? [text] : text;
}

/**
 * Caption copy as plain text, each term as its words on the surface (or the
 * glossary's name for it) — for an attribute such as a `title`, which cannot
 * hold a `GlossaryTerm`. Rendered copy goes through `CaptionCopy` instead.
 */
export function captionPlainText(text: CaptionText): string {
  return captionSegments(text)
    .map((segment) =>
      typeof segment === "string"
        ? segment
        : (segment.text ?? glossaryEntry(segment.term).term)
    )
    .join("");
}
