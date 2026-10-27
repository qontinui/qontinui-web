"use client";

/**
 * HeadlineFigures — a lens page's few plain-language figures, at
 * screen-share size, each with its source and as-of (plan
 * `2026-10-23-console-presentation-spaces` D1: "density down, provenance on";
 * first used by Phase 7's Dev Ops headline strip).
 *
 * `audience_profile/external-evaluator` reads a page from the top and wants
 * the answer before the evidence: three numbers it can say out loud, each
 * with where it came from and how old it is. The console's own opening — the
 * health strip and its mono badge cluster — is built for the tenth read of
 * the page today, so this sits ABOVE it in presentation mode and renders
 * NOTHING for the operator: the operator console is unchanged.
 *
 * Every figure is either KNOWN — a value, a detail line, and its as-of — or
 * UNKNOWN with the reason. An unknown figure renders the word UNKNOWN on R3's
 * ignorance-floor amber (`UNKNOWN_AMBER`, imported, never re-spelled), never
 * a zero, a dash or a blank: several sources feed one strip and each can fail
 * on its own, and a strip that quietly drops the failed one is
 * indistinguishable from one whose figure is fine. Its provenance chip then
 * reads "as of UNKNOWN" too, because no answer arrived to be dated.
 *
 * Nothing here fetches (D3.4): a page derives its figures from reads it
 * already makes and hands them in.
 */

import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { cn } from "@/lib/utils";
import { PROVENANCE_UNKNOWN, Provenance } from "./Provenance";
import type { ProvenanceProps } from "./Provenance";
import { usePresentationMode } from "./PresentationModeProvider";

/** A figure's value: known with its detail line, or unknown with the reason. */
export type HeadlineValue =
  | {
      readonly state: "known";
      /** The figure itself, short enough to say aloud: "6 of 8". */
      readonly value: string;
      /** What the figure counts, in the reader's words. */
      readonly detail: string;
      /** When the read behind the figure was true. */
      readonly asOf: ProvenanceProps["asOf"];
    }
  | {
      readonly state: "unknown";
      /** Why the figure cannot be stated, in the reader's words. */
      readonly reason: string;
    };

export interface HeadlineFigure {
  /** Stable identity; also written to `data-headline-figure`. */
  readonly key: string;
  /** The figure's name: what it counts. "Machines healthy". */
  readonly label: string;
  readonly value: HeadlineValue;
  /** Where the figure comes from, in the reader's words. */
  readonly source: string;
  readonly "data-testid"?: string;
}

export interface HeadlineFiguresProps {
  figures: readonly HeadlineFigure[];
  /** The strip's accessible name. */
  label?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Column classes per figure count. Spelled out because Tailwind only
 * generates classes it can find as literals.
 */
const COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function FigureCell({ figure }: { figure: HeadlineFigure }) {
  const { value } = figure;
  const known = value.state === "known";
  return (
    <div
      className="space-y-1 px-4 py-3"
      data-testid={figure["data-testid"]}
      data-headline-figure={figure.key}
      data-headline-known={known ? "true" : "false"}
    >
      <p className="text-sm text-muted-foreground">{figure.label}</p>
      {known ? (
        <p
          className="text-3xl font-semibold tabular-nums text-foreground"
          data-headline-part="value"
        >
          {value.value}
        </p>
      ) : (
        <p data-headline-part="value">
          <span
            className={cn(
              "inline-flex rounded-md border px-2 text-2xl font-semibold",
              UNKNOWN_AMBER
            )}
          >
            {PROVENANCE_UNKNOWN}
          </span>
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-headline-part="detail">
        {known ? value.detail : value.reason}
      </p>
      <Provenance
        source={figure.source}
        asOf={known ? value.asOf : null}
        data-testid={
          figure["data-testid"]
            ? `${figure["data-testid"]}-provenance`
            : undefined
        }
      />
    </div>
  );
}

export function HeadlineFigures({
  figures,
  label = "Headline figures",
  className,
  "data-testid": testId,
}: HeadlineFiguresProps) {
  const { presenting } = usePresentationMode();
  if (!presenting || figures.length === 0) return null;
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-1 divide-y divide-border rounded-lg border bg-card/30 sm:divide-x sm:divide-y-0",
        COLUMNS[figures.length] ?? COLUMNS[3],
        className
      )}
      data-testid={testId}
      data-presentation-headline=""
    >
      {figures.map((figure) => (
        <FigureCell key={figure.key} figure={figure} />
      ))}
    </section>
  );
}
