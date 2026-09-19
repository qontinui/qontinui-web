"use client";

/**
 * The page an overview section shows until it is built. It says what the
 * page will hold, so a reader who follows the menu is not met by an empty
 * screen or a 404, and it never pretends the project has no data.
 */

import Link from "next/link";
import {
  OVERVIEW_ROOT,
  OVERVIEW_SECTIONS,
} from "@/components/overview/sections";

export function SectionNotReady({
  sectionId,
  willShow,
}: {
  sectionId: string;
  /** Plain-language list of what this page will show once it is built. */
  willShow: string[];
}) {
  const section = OVERVIEW_SECTIONS.find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown overview section "${sectionId}"`);
  const Icon = section.icon;

  return (
    <section
      className="max-w-[38rem]"
      data-ui-bridge-id={`overview.${sectionId}.not-ready`}
    >
      <Icon className="size-6 text-muted-foreground" aria-hidden />
      <h2 className="mt-4 font-[family-name:var(--font-overview-serif)] text-2xl text-foreground">
        {section.label} isn&rsquo;t available yet
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        {section.description}. When it is ready, this page will show:
      </p>
      <ul className="mt-4 space-y-2 text-[15px] leading-relaxed text-foreground">
        {willShow.map((item) => (
          <li key={item} className="flex gap-3">
            <span
              className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary"
              aria-hidden
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">
        The Summary already shows what the project is and how its work is
        progressing.
      </p>
      <Link
        href={OVERVIEW_ROOT}
        className="mt-2 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id={`overview.${sectionId}.go-to-summary`}
      >
        Go to the Summary
      </Link>
    </section>
  );
}
