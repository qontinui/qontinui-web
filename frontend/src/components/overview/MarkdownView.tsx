/**
 * Markdown as the overview renders it: GitHub-flavoured (tables matter —
 * delivery plans are mostly tables), headings in the overview's serif.
 *
 * Overview content is authored by people and agents other than the reader,
 * so two things are deliberate:
 * - NO `rehype-raw`: raw HTML in a document is an injection vector;
 *   react-markdown escapes HTML by default. Keep it that way.
 * - Images from other sites are not loaded. An embedded remote image would
 *   tell its host who read the document and when; it is shown as a link
 *   the reader can choose to open instead.
 */

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** Same-origin (relative) sources only; anything with a scheme or a
 *  protocol-relative `//host` is remote. */
export function isLocalImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//");
}

const components: Components = {
  img: ({ src, alt }) => {
    const href = typeof src === "string" ? src : undefined;
    // react-markdown's URL filter has already emptied unsafe sources
    // (`javascript:`, `data:`), so there may be nothing safe to link to.
    if (!href) return <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>;
    if (isLocalImageSrc(href)) {
      // eslint-disable-next-line @next/next/no-img-element -- markdown content, sizes unknown
      return <img src={href} alt={alt ?? ""} />;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {alt ? `Image: ${alt}` : "External image"}
      </a>
    );
  },
};

/**
 * Heading components per offset, built once. React compares element types by
 * reference, so rebuilding these per render would remount every heading in the
 * document — losing focus and jumping the scroll anchor on the very
 * interaction ("Read all of it") that reveals more of it.
 */
const shiftedByOffset = new Map<number, Components>();

function shiftedHeadings(offset: number): Components {
  const cached = shiftedByOffset.get(offset);
  if (cached) return cached;
  const built = Object.fromEntries(
    ([1, 2, 3, 4, 5] as const).map((level) => {
      const tag = `h${Math.min(level + offset, 6)}` as HeadingTag;
      const Shifted = ({ children }: { children?: React.ReactNode }) =>
        React.createElement(tag, null, children);
      Shifted.displayName = `ShiftedH${level}`;
      return [`h${level}`, Shifted];
    })
  ) as Components;
  shiftedByOffset.set(offset, built);
  return built;
}

export function MarkdownView({
  children,
  className,
  headingOffset = 0,
}: {
  children: string;
  className?: string;
  /**
   * Push the document's own heading levels down by this much, so an embedded
   * document's `##` sits under the page's heading for it instead of
   * out-ranking it. Screen readers and the document outline both read the
   * result as one hierarchy rather than two interleaved ones.
   */
  headingOffset?: number;
}) {
  const shifted =
    headingOffset > 0 ? shiftedHeadings(headingOffset) : undefined;
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none",
        "prose-p:text-[15px] prose-p:leading-[1.7] prose-li:text-[15px] prose-li:leading-[1.7]",
        "prose-headings:font-[family-name:var(--font-overview-serif)] prose-headings:font-medium prose-headings:tracking-[-0.005em]",
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-[1.05rem] prose-h5:text-base prose-h6:text-base",
        "prose-h4:mt-6 prose-h4:mb-1.5 prose-h5:mt-5 prose-h5:mb-1 prose-h6:mt-4 prose-h6:mb-1",
        "prose-h5:text-foreground prose-h6:text-foreground",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-table:text-sm prose-th:text-left prose-th:font-medium",
        "prose-strong:text-foreground prose-code:before:content-none prose-code:after:content-none",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...components, ...shifted }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
