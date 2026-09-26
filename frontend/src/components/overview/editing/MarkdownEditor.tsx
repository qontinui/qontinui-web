"use client";

/**
 * Markdown text with a live preview — the overview's one text editor.
 *
 * Markdown rather than WYSIWYG (plan `2026-09-20-overview-authoring-layer`,
 * open question 3): the documents are shared with agents that read the
 * source, and the preview renders through the same `MarkdownView` the page
 * does, so what the writer previews is what the reader will see.
 */

import { useId, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { cn } from "@/lib/utils";

export function MarkdownEditor({
  value,
  onChange,
  label,
  uiBridgeId,
  invalid,
  describedBy,
  headingOffset = 2,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name of the text box. */
  label: string;
  uiBridgeId: string;
  invalid?: boolean;
  describedBy?: string;
  /** Passed to the preview so its headings sit under the page's. */
  headingOffset?: number;
  autoFocus?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const id = useId();
  const tab = (which: "write" | "preview", text: string) => (
    <button
      type="button"
      onClick={() => setMode(which)}
      aria-pressed={mode === which}
      className={cn(
        "inline-flex min-h-9 items-center rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mode === which
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
      data-ui-bridge-id={`${uiBridgeId}.${which}`}
    >
      {text}
    </button>
  );

  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <div className="mb-2 flex gap-1" role="group" aria-label="Editor view">
        {tab("write", "Write")}
        {tab("preview", "Preview")}
      </div>
      {mode === "write" ? (
        <>
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            autoFocus={autoFocus}
            className="min-h-64 font-mono text-sm leading-relaxed"
            data-ui-bridge-id={`${uiBridgeId}.text`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Markdown: <code># Heading</code>, <code>**bold**</code>,{" "}
            <code>- list item</code>, <code>[link](https://…)</code>.
          </p>
        </>
      ) : (
        <div
          className="min-h-64 rounded-md border border-border px-4 py-3"
          data-ui-bridge-id={`${uiBridgeId}.rendered`}
        >
          {value.trim() ? (
            <MarkdownView headingOffset={headingOffset}>{value}</MarkdownView>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing written yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
