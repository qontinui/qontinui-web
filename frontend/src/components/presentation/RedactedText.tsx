"use client";

/**
 * RedactedText / useRedactor — free text that a presentation may show only
 * when it is provably the tenant's own (plan
 * `2026-10-23-console-presentation-spaces` D3.3, "no foreign identity").
 *
 * In operator mode the text renders verbatim: the operator sees everything.
 * In presentation mode — and while the mode is unresolved — it renders only
 * when `redactionVerdict` clears it against the tenant's presentation scope;
 * otherwise the structured descriptor (`kind · area · status · age`) renders
 * in its place. A scope that is unknown, loading or failed clears NOTHING, so
 * this fails closed until the scope's provider says `ready`.
 *
 * A withheld rendering carries nothing of the original — not in a `title`,
 * not in an `aria-label`, not in a data attribute. `data-redacted` says only
 * whether it was withheld, never why: "this matched a confidential term" is
 * itself a statement about a client relationship.
 */

import { useCallback } from "react";
import { usePresentationMode } from "./PresentationModeProvider";
import { usePresentationScopeState } from "./presentationScope";
import {
  describeRedacted,
  redactionVerdict,
  type RedactionDescriptor,
  type RedactionInput,
} from "./redaction";

const WITHHELD_TITLE = "Withheld in presentation mode";

export interface RedactedTextProps extends RedactionInput {
  /** What renders instead when the text is withheld. */
  descriptor: RedactionDescriptor;
  className?: string;
  "data-testid"?: string;
}

export function RedactedText({
  text,
  repo,
  descriptor,
  className,
  "data-testid": testId,
}: RedactedTextProps) {
  const { presenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  if (!presenting) {
    return (
      <span className={className} data-testid={testId}>
        {text}
      </span>
    );
  }
  const verdict = redactionVerdict({ text, repo }, scope);
  if (verdict.show) {
    return (
      <span className={className} data-testid={testId} data-redacted="false">
        {text}
      </span>
    );
  }
  return (
    <span
      className={className}
      data-testid={testId}
      data-redacted="true"
      title={WITHHELD_TITLE}
    >
      {describeRedacted(descriptor, scope)}
    </span>
  );
}

/** One item for {@link useRedactor}. */
export interface RedactorItem extends RedactionInput {
  readonly descriptor: RedactionDescriptor;
}

/**
 * The same decision as a function, for text that does not render as an
 * element of its own: a chart label, a `title`, an option list. Returns the
 * string to display — the text, or its descriptor.
 */
export function useRedactor(): (item: RedactorItem) => string {
  const { presenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  return useCallback(
    (item: RedactorItem) => {
      if (!presenting) return item.text;
      return redactionVerdict(item, scope).show
        ? item.text
        : describeRedacted(item.descriptor, scope);
    },
    [presenting, scope]
  );
}
