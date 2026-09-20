"use client";

/**
 * Which door is feeding the plan corpus — the per-door census, on
 * `/admin/coord/plans`.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4a.
 * It sits beside `ReconciliationDisclosure`'s document-axis line because it is
 * the companion to Phase 0's reading: that reading established the document
 * layer is 94.8% complete, and left standing *by which door, and is that door
 * still alive?*
 *
 * Every reading comes from `captureHealthStatus.ts` (R8); this file renders
 * what it is handed and re-decides none of it. Three properties it must not
 * lose, each one a sentence in the route's own schema:
 *
 *   - **A door with zero artifacts RENDERS.** "The agent door has written
 *     nothing" is the finding; a row that vanishes reads as an absent feature.
 *   - **`last_touched_at` is last TOUCHED.** A kind correction bumps it with
 *     no capture, so the caveat rides the value rather than the footnotes.
 *   - **`newest_updated_at: null` is UNKNOWN**, not "fresh" and not an epoch.
 *   - **A door with no `count` at all is UNKNOWN**, and gets a dash and its
 *     own cell — never the "this door has written nothing" accusation, which
 *     belongs to a served `0` alone.
 *   - **A census kept on screen after a FAILED refresh is LABELLED.** The
 *     page that owns this read states the intent — the previous census stays
 *     "and labelled" — and without the label the summary goes on reading "3
 *     doors, all of them writing" about a read that just failed, while every
 *     relative time keeps drifting as though it were current.
 *
 * And the one it must not overreach on: this is a SECOND read, of the artifact
 * store alone. On a reconciliation read whose population arm failed it still
 * renders — the store answered — but it is never presented as restoring the
 * document-completeness verdict that read suppressed.
 *
 * R7 applies here and not to the disclosure block above it: a per-door census
 * is secondary material beside "axis A is UNKNOWN for every row", so it
 * collapses — but its SUMMARY keeps the finding visible while closed, which is
 * what R7 asks of a panel that collapses at all.
 */

import { DoorOpen, TriangleAlert } from "lucide-react";
import {
  CollapsiblePanel,
  UNKNOWN_AMBER,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import {
  SECOND_READ_CAVEAT,
  SECOND_READ_NOTE,
  STALE_CENSUS_NOTE,
  type CaptureCensus,
  type CorpusFreshness,
} from "./captureHealthStatus";

const DASH = "–";

function DoorRow({ door }: { door: CaptureCensus["doors"][number] }) {
  return (
    <tr
      className="border-t border-border/60 align-top"
      data-testid="coord-capture-door"
      data-door={door.doorId}
      data-silent={door.silent ? "true" : "false"}
      data-unrecognised={door.unrecognised ? "true" : "false"}
    >
      <td className="py-1.5 pr-3">
        <span className="font-mono text-[11px]">{door.label}</span>
        {door.unrecognised && (
          <span
            className={`ml-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${UNKNOWN_AMBER}`}
            data-testid="coord-capture-door-unrecognised"
            title={door.detail}
          >
            unrecognised door
          </span>
        )}
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {door.detail}
        </div>
      </td>
      <td
        className="py-1.5 pr-3 tabular-nums"
        data-testid="coord-capture-door-count"
        data-count-unstated={door.countUnstated ? "true" : "false"}
      >
        {/* R6 — an unserved count is a dash. Printing `0` here would turn a
            field the response did not carry into this panel's loudest claim. */}
        {door.countUnstated ? DASH : door.count}
        {/* The zero is the finding, so it is SAID, not merely printed. */}
        {door.silent && (
          <div
            className="text-[11px] text-muted-foreground italic mt-0.5"
            data-testid="coord-capture-door-silent"
          >
            this door has written nothing
          </div>
        )}
        {door.countUnstated && (
          <div
            className="text-[11px] text-muted-foreground italic mt-0.5"
            data-testid="coord-capture-door-count-unstated"
          >
            this response carried no count for this door — unknown, not zero
          </div>
        )}
      </td>
      <td className="py-1.5 pr-3 text-muted-foreground">
        {door.firstAt ? (
          <span title={absoluteTime(door.firstAt)}>
            {relativeTime(door.firstAt)}
          </span>
        ) : (
          <span title="No artifact has ever been captured through this door.">
            {DASH}
          </span>
        )}
      </td>
      <td
        className="py-1.5 text-muted-foreground"
        data-testid="coord-capture-door-last-touched"
      >
        {door.lastTouchedAt ? (
          <span
            title={`${absoluteTime(door.lastTouchedAt)} — ${door.freshnessCaveat}`}
          >
            {relativeTime(door.lastTouchedAt)}
          </span>
        ) : (
          <span title="Nothing through this door has ever been touched.">
            {DASH}
          </span>
        )}
      </td>
    </tr>
  );
}

export function CaptureHealthPanel({
  census,
  freshness,
  /**
   * `true` when the reconciliation read beside this panel suppressed its
   * document-layer completeness claim. The panel still renders — the artifact
   * store answered — but it says, in words, that it does not repair that
   * claim.
   */
  documentAxisSuppressed,
  /** The census read itself failed. UNKNOWN, never an empty corpus. */
  readFailed,
  loaded,
}: {
  census: CaptureCensus | null;
  freshness: CorpusFreshness;
  documentAxisSuppressed: boolean;
  readFailed: boolean;
  loaded: boolean;
}) {
  const silent = census?.silentDoors ?? [];
  const unstated = census?.countUnstatedDoors ?? [];
  /**
   * The census on screen is the LAST GOOD one and has not refreshed.
   *
   * `plans/page.tsx` states the intent — the previous census stays "and
   * labelled" — and this is the second half of it. Unlabelled, a summary
   * reading "3 doors, all of them writing" is a present-tense claim about a
   * read that just failed.
   */
  const stale = readFailed && census !== null;
  const measured = !loaded
    ? readFailed
      ? "unread — unknown, not empty"
      : "reading…"
    : census === null
      ? "unread — unknown, not empty"
      : census.doorsUnstated
        ? "this backend served no door list"
        : silent.length > 0
          ? `${silent.length} of ${census.doors.length} doors have written nothing`
          : unstated.length === census.doors.length && census.doors.length > 0
            ? `${census.doors.length} doors, none of them counted on this read`
            : `${census.doors.length} doors, all of them writing`;
  const summary = stale
    ? `${measured} — last good read, not refreshed`
    : measured;

  return (
    <CollapsiblePanel
      title="Which door is feeding this corpus"
      titleAs="h3"
      icon={<DoorOpen className="h-4 w-4 text-muted-foreground" />}
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-capture-health-summary"
        >
          {summary}
        </span>
      }
      storageKey="coord-plans-capture-health"
    >
      <div className="space-y-2 text-xs" data-testid="coord-capture-health">
        <p
          className="text-muted-foreground"
          data-testid="coord-capture-health-second-read"
        >
          {documentAxisSuppressed ? SECOND_READ_CAVEAT : SECOND_READ_NOTE}
        </p>

        {!loaded && !readFailed && (
          <p className="text-muted-foreground italic">
            Reading the capture census…
          </p>
        )}

        {stale && (
          <p
            className="text-muted-foreground italic"
            data-testid="coord-capture-health-stale"
          >
            {STALE_CENSUS_NOTE}
          </p>
        )}

        {readFailed && census === null && (
          <p
            className="text-muted-foreground italic"
            data-testid="coord-capture-health-unknown"
          >
            The capture census could not be read. Which door is feeding this
            corpus is UNKNOWN — not &ldquo;no door is&rdquo;.
          </p>
        )}

        {census !== null && census.doorsUnstated && (
          <p
            className="text-muted-foreground italic"
            data-testid="coord-capture-health-doors-unstated"
          >
            This response carried no door list. The route returns every door in
            its vocabulary on every read, so this is a shape this build does not
            understand — not a corpus with no doors.
          </p>
        )}

        {census !== null && !census.doorsUnstated && (
          <>
            {silent.length > 0 && (
              <p
                className="flex items-start gap-1.5 text-muted-foreground"
                data-testid="coord-capture-health-silent-finding"
              >
                <TriangleAlert
                  className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400"
                  aria-hidden="true"
                />
                <span>
                  {silent.map((d) => d.label).join(", ")}{" "}
                  {silent.length === 1 ? "has" : "have"} written nothing. That
                  is a finding about the corpus, not a missing row: whatever
                  only that door can capture is absent from everything on this
                  page.
                </span>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="font-normal pb-1 pr-3">door</th>
                    <th className="font-normal pb-1 pr-3">artifacts</th>
                    <th className="font-normal pb-1 pr-3">first captured</th>
                    <th
                      className="font-normal pb-1"
                      title="max(updated_at) — a kind correction bumps it with no capture."
                    >
                      last touched
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {census.doors.map((door) => (
                    <DoorRow key={door.doorId} door={door} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              {/* R6 — an unserved total is a dash, never the row sum. */}
              Artifacts in the corpus:{" "}
              <span data-testid="coord-capture-health-total">
                {census.total ?? `${DASH} (the route served no total)`}
              </span>
              . Corpus last touched:{" "}
              <span
                data-testid="coord-capture-health-newest"
                data-unknown={freshness.unknown ? "true" : "false"}
                className={freshness.unknown ? "italic" : undefined}
                title={freshness.text}
              >
                {/* The unknown arm's own text already opens with what is
                    unknown and why, so prefixing "unknown — " reads as
                    "unknown — the capture census has not been read, so the
                    corpus's freshness is unknown". The reading is carried by
                    the sentence and by `data-unknown`, not by a label
                    stacked on top of it. */}
                {freshness.unknown
                  ? freshness.text
                  : relativeTime(freshness.at)}
              </span>
              {!freshness.unknown && (
                <>
                  {" ("}
                  <span title={freshness.text}>
                    last touched, not last captured
                  </span>
                  {")"}
                </>
              )}
              .
            </p>
          </>
        )}
      </div>
    </CollapsiblePanel>
  );
}
