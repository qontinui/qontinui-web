"use client";

/**
 * Where a section's figures come from, said once per section: "From the
 * project record, as of 14:03", and a collapsed "Where this comes from" that
 * holds the technical detail (the documents and versions read, when, how many
 * automated checks are not shown) and the way into the coord console.
 *
 * The visible line is plain language. Anything an id or a count of internals
 * would add goes inside the disclosure, which carries `data-provenance-detail`
 * so the plain-language test knows it is the one place such text may live.
 */

import Link from "next/link";
import {
  formatClock,
  formatInstantDay,
  sourceKindWord,
} from "../../_lib/schedule";
import type { SourceStamp } from "../../_lib/schedule-api";

export const COORD_CONSOLE_HREF = "/admin/coord/work-units";

export function ProvenanceLine({
  observedAt,
  stale,
  sources,
  uiBridgeId,
  detail,
}: {
  /** When the page last read the project record (the oldest source). */
  observedAt: string;
  /** True when this is the last good read, served after a later one failed. */
  stale: boolean;
  sources: SourceStamp[];
  uiBridgeId: string;
  /** Technical lines that belong inside the disclosure. */
  detail?: React.ReactNode;
}) {
  const clock = formatClock(observedAt);
  const day = formatInstantDay(observedAt);
  return (
    <div
      className="space-y-1 text-xs text-muted-foreground"
      data-ui-bridge-id={uiBridgeId}
    >
      <p data-ui-bridge-id={`${uiBridgeId}.line`}>
        {stale
          ? `Last read from the project record at ${clock ?? "an unknown time"}${
              day ? ` on ${day}` : ""
            }. It could not be reached since, so this may be out of date.`
          : `From the project record, as of ${clock ?? "an unknown time"}.`}
      </p>
      <details
        data-provenance-detail
        data-ui-bridge-id={`${uiBridgeId}.disclosure`}
      >
        <summary
          className="cursor-pointer"
          data-ui-bridge-id={`${uiBridgeId}.disclosure.toggle`}
        >
          Where this comes from
        </summary>
        <ul className="mt-1 space-y-0.5">
          {sources.map((s, i) => (
            <li key={`${s.kind}:${s.label}:${i}`}>
              {sourceKindWord(s.kind)}: {s.label}
              {s.version !== null ? `, version ${s.version}` : ""}, read at{" "}
              {formatClock(s.observed_at) ?? "an unknown time"}
            </li>
          ))}
        </ul>
        {detail}
        <p className="mt-1">
          <Link
            href={COORD_CONSOLE_HREF}
            className="underline-offset-4 hover:underline"
            data-ui-bridge-id={`${uiBridgeId}.console`}
          >
            Open the coord console
          </Link>
        </p>
      </details>
    </div>
  );
}
