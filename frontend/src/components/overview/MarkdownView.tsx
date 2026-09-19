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

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Same-origin (relative) sources only; anything with a scheme or a
 *  protocol-relative `//host` is remote. */
export function isLocalImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//");
}

const components: Components = {
  img: ({ src, alt }) => {
    const href = typeof src === "string" ? src : undefined;
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

export function MarkdownView({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none",
        "prose-p:text-[15px] prose-p:leading-[1.7] prose-li:text-[15px] prose-li:leading-[1.7]",
        "prose-headings:font-[family-name:var(--font-overview-serif)] prose-headings:font-medium prose-headings:tracking-[-0.005em]",
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-table:text-sm prose-th:text-left prose-th:font-medium",
        "prose-strong:text-foreground prose-code:before:content-none prose-code:after:content-none",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
