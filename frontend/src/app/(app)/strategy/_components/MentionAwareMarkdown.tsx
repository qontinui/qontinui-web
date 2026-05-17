"use client";

import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MentionMarker } from "./MentionMarker";
import { parseMentionSegments } from "./mention-marker";

/**
 * ReactMarkdown wrapper that splices `@[user_id:<uuid>]` markers into
 * `<MentionMarker>` React elements without parsing each character as
 * markdown (the marker squarebrackets would otherwise confuse the
 * link/image grammar).
 *
 * Approach: override the `text`-node and code-renderers. For any
 * leaf-text the markdown grammar hands us, we split on the marker
 * regex and render mentions inline. The marker text never reaches
 * the html link/image renderer because remark-gfm sees raw text and
 * passes it through verbatim to the `text` hook.
 */
export function MentionAwareMarkdown({ children }: { children: string }) {
  const components: Components = useMemo(() => {
    const renderSegments = (input: string): React.ReactNode => {
      const segs = parseMentionSegments(input);
      const first = segs[0];
      if (segs.length === 1 && first && first.type === "text")
        return first.value;
      return segs.map((s, i) =>
        s.type === "mention" ? (
          <MentionMarker key={`m-${i}-${s.userId}`} userId={s.userId} />
        ) : (
          <React.Fragment key={`t-${i}`}>{s.value}</React.Fragment>
        )
      );
    };

    return {
      p: ({ children: c }) => <p>{renderChildren(c, renderSegments)}</p>,
      li: ({ children: c }) => <li>{renderChildren(c, renderSegments)}</li>,
      // Inline code + fenced code are pass-through; mentions inside
      // code are intentionally NOT resolved (matches GitHub UX).
    };
  }, []);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}

/**
 * Recursively walk ReactMarkdown's `children` (string | ReactNode[])
 * and apply `renderSegments` only to string leaves. Other elements
 * (e.g. inline `<code>`, `<a>`, `<strong>`) pass through untouched.
 */
function renderChildren(
  children: React.ReactNode,
  renderSegments: (s: string) => React.ReactNode
): React.ReactNode {
  if (typeof children === "string") return renderSegments(children);
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <React.Fragment key={i}>
        {renderChildren(c, renderSegments)}
      </React.Fragment>
    ));
  }
  return children;
}
