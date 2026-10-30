"use client";

/**
 * SectionCaption — a lens page section's caption, with the provenance of the
 * numbers under it (plan `2026-10-23-console-presentation-spaces` D1:
 * "captions on, provenance on"; first used by Phase 7's Dev Ops sections).
 *
 * A section is one panel of a lens page: a list, a table, a strip. In
 * presentation mode it opens with its registry caption (title, one-liner, why
 * it matters) and, beneath it, one `Provenance` chip per source the section's
 * numbers come from — the source and the as-of of every number in it, stated
 * once for the section the way a column header serves a whole column
 * (`ux-priorities` `a-label-names-one-referent-and-a-quantity-names-its-unit`
 * BOUNDS). A chip per cell would put a dozen identical chips on one table,
 * which is the repeated chrome `repeated-chrome-must-earn-its-space-by-varying`
 * forbids.
 *
 * Operator mode renders NOTHING: the console's sections already carry their
 * own times, and R9 keeps chrome off the operator surface.
 *
 * Mount it where the section's read lives, so the as-of it states is the read
 * the section renders — never a second fetch (D3.4, R1).
 */

import { Caption } from "./Caption";
import type { CaptionKey } from "./captions";
import { Provenance } from "./Provenance";
import type { ProvenanceProps } from "./Provenance";
import { usePresentationMode } from "./PresentationModeProvider";

/** One source the section's numbers come from. */
export interface SectionSource {
  /** React key; defaults to the source text. */
  readonly key?: string;
  readonly source: ProvenanceProps["source"];
  readonly asOf: ProvenanceProps["asOf"];
}

export interface SectionCaptionProps {
  /** The registry key — `<surface>.<section>`. */
  id: CaptionKey;
  /** The sources behind the section's numbers, one chip each. */
  sources?: readonly SectionSource[];
  className?: string;
  "data-testid"?: string;
}

export function SectionCaption({
  id,
  sources = [],
  className,
  "data-testid": testId,
}: SectionCaptionProps) {
  const { presenting } = usePresentationMode();
  if (!presenting) return null;
  return (
    <div
      className={className ?? "space-y-1.5"}
      data-testid={testId}
      data-presentation-section={id}
    >
      <Caption id={id} level={3} />
      {sources.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-presentation-section-sources=""
        >
          {sources.map((s, i) => (
            <Provenance
              key={s.key ?? `${s.source ?? "unknown"}-${i}`}
              source={s.source}
              asOf={s.asOf}
            />
          ))}
        </div>
      )}
    </div>
  );
}
