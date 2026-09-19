/**
 * Markdown as the overview renders it: GitHub-flavoured (tables matter —
 * delivery plans are mostly tables), headings in the overview's serif.
 *
 * Deliberately WITHOUT `rehype-raw`: overview content is written by any
 * project member, and raw HTML from a member is an injection vector.
 * react-markdown escapes HTML by default; keep it that way.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
