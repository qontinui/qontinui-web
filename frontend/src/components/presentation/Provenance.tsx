"use client";

/**
 * Provenance — the source and the as-of time beside a number (plan
 * `2026-10-23-console-presentation-spaces` D1: "provenance on").
 *
 * `audience_profile/external-evaluator`: "the source and the as-of time
 * beside every number. A number without its 'as of' reads as marketing." So
 * presentation mode puts this chip beside each figure a lens page shows.
 *
 * - An unknown source or an absent/unparseable time renders the word UNKNOWN,
 *   never a blank and never a guess, on R3's ignorance-floor amber
 *   (`UNKNOWN_AMBER`, imported — never re-spelled). A visible "unknown" is the
 *   evidence that the instrument is real.
 * - The age keeps advancing (`presentationClock`): one shared tick re-renders
 *   every chip, so "as of 12s ago" never freezes on a ten-minute-old figure.
 * - Operator mode renders nothing unless `persistent` — the console's own
 *   rows already carry their times (R2), and R9 keeps chrome off the operator
 *   surface.
 */

import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { absoluteTime, relativeTime } from "@/components/console/time";
import { cn } from "@/lib/utils";
import { usePresentationClock } from "./presentationClock";
import { usePresentationMode } from "./PresentationModeProvider";

/** The word an unknown source or time renders as. */
export const PROVENANCE_UNKNOWN = "UNKNOWN";

export interface ProvenanceProps {
  /** Where the number came from, in the reader's words: "coord fleet health". */
  source: string | null | undefined;
  /** When it was true: ISO-8601, epoch milliseconds, or a Date. */
  asOf: string | number | Date | null | undefined;
  /** Render in operator mode too. Default false: a presentation-lens chip. */
  persistent?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** `asOf` as ISO-8601, or `null` when it does not name a real instant. */
export function provenanceInstant(
  asOf: ProvenanceProps["asOf"]
): string | null {
  if (asOf === null || asOf === undefined) return null;
  const date =
    asOf instanceof Date
      ? asOf
      : typeof asOf === "number"
        ? new Date(asOf)
        : asOf.trim()
          ? new Date(asOf)
          : null;
  if (date === null || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function ProvenanceChip({
  source,
  asOf,
  className,
  "data-testid": testId,
}: Omit<ProvenanceProps, "persistent">) {
  usePresentationClock();
  const sourceText = source?.trim() || null;
  const instant = provenanceInstant(asOf);
  const known = sourceText !== null && instant !== null;
  const title = [
    `Source: ${sourceText ?? "unknown — the page could not say where this came from"}.`,
    instant
      ? `As of ${absoluteTime(instant)}.`
      : "As of: unknown — no time came with this figure.",
  ].join(" ");
  return (
    <Badge
      variant="outline"
      // `gap-0`: the spacing is real text (" · "), so the chip reads as one
      // line to a screen reader, a copy-paste and a UI Bridge text snapshot.
      className={cn(
        "gap-0 text-[11px] font-normal",
        known ? "text-muted-foreground" : UNKNOWN_AMBER,
        className
      )}
      data-testid={testId}
      data-provenance=""
      data-provenance-known={known ? "true" : "false"}
      title={title}
    >
      <span>source: {sourceText ?? PROVENANCE_UNKNOWN}</span>
      <span aria-hidden>{" · "}</span>
      <span>as of {instant ? relativeTime(instant) : PROVENANCE_UNKNOWN}</span>
    </Badge>
  );
}

export function Provenance({ persistent = false, ...chip }: ProvenanceProps) {
  const { presenting } = usePresentationMode();
  if (!presenting && !persistent) return null;
  return <ProvenanceChip {...chip} />;
}
