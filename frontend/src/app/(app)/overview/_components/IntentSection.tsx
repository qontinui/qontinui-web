"use client";

/**
 * One part of the project's own description (what it is, what it is working
 * towards, how success is measured, who it is for), from coord's intent
 * documents. A kind may hold several documents; each is shown.
 */

import { useState } from "react";
import Link from "next/link";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { LoadFailure } from "@/components/overview/LoadFailure";
import {
  hasContent,
  type IntentEntry,
  type SummaryIntentKind,
} from "../_lib/intent";

export const INTENT_HEADINGS: Record<
  SummaryIntentKind,
  { heading: string; missing: string }
> = {
  product_intent: {
    heading: "About this project",
    missing: "Nobody has described this project yet.",
  },
  initiative: {
    heading: "What the project is working towards",
    missing: "The project's current initiatives haven't been written yet.",
  },
  success_metric: {
    heading: "How success is measured",
    missing: "The project's measures of success haven't been written yet.",
  },
  audience_profile: {
    heading: "Who it is for",
    missing: "The people this project serves haven't been described yet.",
  },
};

/** Bodies longer than this start collapsed, so one long document does not
 *  push everything else off the page. */
const COLLAPSE_AT_CHARS = 1400;

const EDITOR_HREF = "/admin/coord/prompt-documents";

function IntentBody({ entry, id }: { entry: IntentEntry; id: string }) {
  const long = entry.body.length > COLLAPSE_AT_CHARS;
  const [open, setOpen] = useState(!long);
  return (
    <div>
      <div
        id={id}
        className={open ? undefined : "relative max-h-72 overflow-hidden"}
      >
        <MarkdownView>{entry.body}</MarkdownView>
        {!open && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent"
            aria-hidden
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-2 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id={`overview.summary.${id}.toggle`}
        >
          {open ? "Show less" : "Read all of it"}
        </button>
      )}
      {entry.state === "unknown" && (
        <p className="mt-3 text-xs text-muted-foreground">
          This text started as a template and has been edited since. Parts of it
          may still be template wording.
        </p>
      )}
    </div>
  );
}

export function IntentSection({
  kind,
  entries,
  canEdit,
}: {
  kind: SummaryIntentKind;
  entries: IntentEntry[];
  canEdit: boolean;
}) {
  const { heading, missing } = INTENT_HEADINGS[kind];
  const written = entries.filter(hasContent);
  const sectionId = kind.replace(/_/g, "-");

  return (
    <section
      aria-labelledby={`${sectionId}-heading`}
      data-ui-bridge-id={`overview.summary.${sectionId}`}
    >
      <h2
        id={`${sectionId}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        {heading}
      </h2>

      {written.length === 0 ? (
        <div
          className="mt-3 border-l-2 border-border pl-4"
          data-ui-bridge-id={`overview.summary.${sectionId}.missing`}
        >
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {missing}
          </p>
          {canEdit && (
            <Link
              href={EDITOR_HREF}
              className="mt-1 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ui-bridge-id={`overview.summary.${sectionId}.write`}
            >
              Write it
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-8">
          {written.map((entry) => (
            <article key={entry.name}>
              {written.length > 1 && (
                <h3 className="mb-2 text-base font-medium text-foreground">
                  {entry.description ?? entry.name}
                </h3>
              )}
              {entry.state === "unreadable" ? (
                <LoadFailure
                  what="this part of the description"
                  message={entry.error ?? ""}
                  uiBridgeId={`overview.summary.${sectionId}-${entry.name}.error`}
                />
              ) : (
                <IntentBody entry={entry} id={`${sectionId}-${entry.name}`} />
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
