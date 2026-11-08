"use client";

/**
 * RefLink — one subproject reference (a gate, PR, session, work unit, other
 * subproject or question), opened where it lives.
 *
 * The decision is `subprojectStatus.ts` `refTarget`; this only renders it: a
 * console link for an internal page, a new tab for GitHub, and plain text with
 * the reason in its title when the ref cannot be opened (an unknown type, a
 * work unit whose slug is not known), the reason also in screen-reader
 * text — never a link that leads nowhere (style guide §3.12's "a control
 * with nowhere to go … says why").
 */

import Link from "next/link";
import type { SubprojectRef } from "@/lib/api/operations/coordSubprojects";
import { refTarget, type RefContext } from "./subprojectStatus";

export function RefLink({
  subjectRef,
  context,
}: {
  subjectRef: SubprojectRef;
  context?: RefContext;
}) {
  const target = refTarget(subjectRef, context);
  const text = subjectRef.label || subjectRef.id;
  if (target.kind === "internal") {
    return (
      <Link
        href={target.href}
        className="underline underline-offset-2 hover:text-foreground"
        data-ref-type={subjectRef.type}
        data-testid="subproject-ref"
      >
        {text}
      </Link>
    );
  }
  if (target.kind === "external") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
        data-ref-type={subjectRef.type}
        data-testid="subproject-ref"
      >
        {text} ↗
      </a>
    );
  }
  // The reason is TEXT, not only a tooltip: a `title` is not an accessible
  // name and has no hover for a keyboard (style guide R6, "A `title` is not
  // an accessible name"). Sighted readers get it on hover; everyone else
  // reads it as part of the reference.
  return (
    <span
      title={`Not linked: ${target.why}. coord id: ${subjectRef.id}`}
      data-ref-type={subjectRef.type}
      data-testid="subproject-ref-unlinked"
    >
      {text}
      <span className="sr-only"> (not linked: {target.why})</span>
    </span>
  );
}

/** A reference list, comma-separated. Renders nothing for an empty list. */
export function RefList({
  refs,
  context,
}: {
  refs: readonly SubprojectRef[];
  context?: RefContext;
}) {
  if (refs.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {refs.map((r, i) => (
        <span key={`${r.type}:${r.id}:${i}`}>
          {i > 0 && ", "}
          <RefLink subjectRef={r} context={context} />
        </span>
      ))}
    </span>
  );
}
