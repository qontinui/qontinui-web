/**
 * The sub-space drawer's Summary and credibility envelope: which reading of
 * the observer it shows, and how it names it, in every state of the reads
 * behind it (plan `2026-10-23-console-presentation-spaces` Phase 5;
 * `ux-priorities` `a-status-signal-must-observe-the-state-it-names`).
 *
 * A row on coord's twin door (a `verdict_wrapper` or `report` door, or one
 * whose door is not known) gets the drawer's OWN raw read of the observer
 * ({@link ownReadOf}). An `envelope` door is not on the twin door, so its
 * reading is the page probe's answer for the row, once there is one. Either
 * way the reading is shown with WHEN it was read — a Provenance chip, in both
 * modes, since nothing else in the drawer dates it — and the verdict's own
 * staleness is its staleness WHEN READ, never an age now. An envelope door's
 * answer is not a DriftVerdict and reports no age, so its freshness is
 * UNKNOWN, never "live" (`status-presentation.ts` `readingAge`).
 *
 * Every line the Summary says about a read says which read it is about: by
 * name — the drawer's own ("This drawer's own read of …") or coord's live
 * probe — or by pointing back at the line before it that names it
 * ({@link RETAINED_LEAD}).
 *
 * A reading kept after a failed read (react-query keeps a query's data when a
 * refetch fails; the probe keeps its last answer the same way) is RETAINED:
 * the failure leads, the reading is introduced as the last one read, its
 * envelope is never headed "Live", and its chip carries the date it was read
 * (style guide R6: the stale arm keeps the muted tone and carries the date).
 *
 * Pure functions (unit-tested in `drawer-reading.test.ts`; the whole drawer
 * over every state in `SubspaceDetail.matrix.test.tsx`).
 */

import { failureTail, statusSuffix } from "./failure-text";
import type { ProbeAttempt } from "./probe-read";
import { probeAnswered } from "./resolve";
import { FIDELITY_SOURCE } from "./twin-aspects";
import type {
  DoorShape,
  DriftVerdict,
  RawVerdictResponse,
  ResolvedSubspace,
} from "./types";
import { summarizeVerdict, type VerdictSummary } from "./verdict-formatter";

/** The fields of the drawer's raw read (react-query's result) it classifies. */
export interface OwnReadQuery {
  readonly data: RawVerdictResponse | null | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  /** When the answer it holds was read (epoch ms; 0 or absent with none). */
  readonly dataUpdatedAt?: number;
}

/**
 * What a raw read's body carries, as the drawer shows it: a DriftVerdict, or
 * a door's own report (the backend names both `verdict`).
 */
export interface OwnReading {
  readonly kind: "verdict" | "report";
  readonly value: DriftVerdict;
}

/**
 * The drawer's own raw read of the observer, as the drawer reads it — one
 * state per thing it may honestly say:
 *
 * - `none` — the row has no raw read here (an envelope door, or a row the page
 *   does not probe);
 * - `unmade` — no answer, no failure and none in flight: react-query is
 *   holding it (offline, or nothing started it);
 * - `in-flight` — no answer yet, one on its way;
 * - `answered` — the LATEST read answered (a refetch of it may be on its way);
 *   `reading` is what it carried, or `null` when it carried none;
 * - `retained` — the latest read FAILED, and react-query still holds an
 *   earlier answer: a reading, but not a current one;
 * - `failed` — the latest read failed, with no earlier answer held.
 */
export type OwnRead =
  | { readonly kind: "none" }
  | { readonly kind: "unmade"; readonly online: boolean }
  | { readonly kind: "in-flight" }
  | {
      readonly kind: "answered";
      readonly reading: OwnReading | null;
      readonly tool: string | null;
      readonly readAt: number | null;
    }
  | {
      readonly kind: "retained";
      readonly reading: OwnReading | null;
      readonly tool: string | null;
      readonly readAt: number | null;
      readonly error: unknown;
    }
  | { readonly kind: "failed"; readonly error: unknown };

const at = (ms: number | undefined): number | null =>
  ms !== undefined && ms > 0 ? ms : null;

/**
 * The fields of coord's DriftVerdict (`twin_verdict.rs`): a verdict carries
 * some of them, a door's own report carries none. Read only when the door's
 * shape is not known.
 */
const VERDICT_FIELDS = [
  "drift_class",
  "coverage",
  "credibility",
  "provenance",
  "staleness_seconds",
  "posterior",
  "instance",
] as const;

/**
 * What a raw read's body carries ({@link OwnReading}), or `null` when it
 * carries no reading. A door's declared shape decides: a `report` door
 * answers with a report, a `verdict_wrapper` door with a verdict — and an
 * answer that is not one carries none. With the shape unknown (coord's
 * catalog unread, and a probe cell that names none) the body's own shape
 * decides, so a report is never summarized as a verdict: its missing
 * staleness would read as "live", which coord means only of a verdict.
 */
export function readingOf(
  body: RawVerdictResponse,
  doorShape: DoorShape | null | undefined
): OwnReading | null {
  const value: unknown = body.verdict;
  if (value === null || typeof value !== "object") return null;
  const verdict = value as DriftVerdict;
  const verdictShaped = VERDICT_FIELDS.some((field) => field in verdict);
  if (doorShape === "report" || (doorShape == null && !verdictShaped)) {
    return { kind: "report", value: verdict };
  }
  return verdictShaped ? { kind: "verdict", value: verdict } : null;
}

/**
 * Classify the drawer's raw read. `readsRaw` is whether the row has one (a
 * live-probed row whose door is not an `envelope` door); `doorShape` is the
 * row's declared door shape, when known ({@link readingOf}); `online` is
 * react-query's online state, which names why an unmade read is unmade.
 *
 * A held answer with a failure beside it is `retained`, never `answered`:
 * react-query keeps `data` when a refetch fails, so "holds data" is not "the
 * latest read answered".
 */
export function ownReadOf(
  readsRaw: boolean,
  query: OwnReadQuery,
  online: boolean,
  doorShape: DoorShape | null | undefined
): OwnRead {
  if (!readsRaw) return { kind: "none" };
  const body = query.data ?? null;
  if (body !== null) {
    const held = {
      reading: readingOf(body, doorShape),
      tool: typeof body.tool === "string" ? body.tool : null,
      readAt: at(query.dataUpdatedAt),
    };
    return query.isError
      ? { kind: "retained", ...held, error: query.error }
      : { kind: "answered", ...held };
  }
  if (query.isError) return { kind: "failed", error: query.error };
  if (query.isLoading) return { kind: "in-flight" };
  return { kind: "unmade", online };
}

/**
 * The drawer's own LATEST read answered with a reading of the observer — the
 * condition for the Status to point at the Summary as that reading
 * (`drawer-status.ts`).
 */
export function ownReadAnswered(own: OwnRead): boolean {
  return own.kind === "answered" && own.reading !== null;
}

/** Who read a reading, as its Provenance chip names the source. */
export const DRAWER_READ_SOURCE = "this drawer's own read of coord";

/** The envelope heading of a reading the latest read returned. */
export const LIVE_ENVELOPE_HEADING = "Live credibility envelope";

/** The envelope heading of a reading kept after the latest read failed. */
export const RETAINED_ENVELOPE_HEADING = "Credibility envelope, as last read";

/** What introduces a retained reading, after the failure that left it so. */
export const RETAINED_LEAD = "As last read, before that failure:";

/** One line the Summary says about its read, ahead of any reading. */
export interface DrawerLine {
  readonly kind:
    | "read-unmade"
    | "read-in-flight"
    | "read-error"
    | "read-empty"
    | "read-retained"
    | "probe-held"
    | "no-envelope";
  readonly text: string;
}

/** A reading of the observer the Summary shows. */
export interface DrawerReading {
  /** The reading in words — a verdict summary, or what a report is. */
  readonly prose: string;
  /** Kept after a failed read: not current. */
  readonly retained: boolean;
  /** Who read it (its Provenance chip's source). */
  readonly source: string;
  /** When it was read (epoch ms), or `null` when that is unknown. */
  readonly asOf: number | null;
  /** A verdict's credibility envelope; `null` for a report. */
  readonly envelope: {
    readonly heading: string;
    readonly facts: VerdictSummary["facts"];
  } | null;
}

/** The drawer's Summary box. */
export interface DrawerSummary {
  /** What the Summary says about its read, in order. */
  readonly lines: readonly DrawerLine[];
  /** The reading it shows, or `null` when it has none. */
  readonly reading: DrawerReading | null;
}

/** What the drawer's Summary is built from. */
export interface DrawerSummaryInput {
  readonly row: ResolvedSubspace;
  readonly probe: Pick<ProbeAttempt, "refreshFailed" | "error" | "asOf">;
  readonly own: OwnRead;
  readonly presenting: boolean;
}

/**
 * A verdict as a reading: its words, and its envelope under `heading`.
 * `doorShape` is the door it was read from, which says what a missing
 * staleness means (`status-presentation.ts` `readingAge`).
 */
function verdictReading(
  subspaceId: string,
  verdict: DriftVerdict,
  doorShape: DoorShape,
  read: Pick<DrawerReading, "retained" | "source" | "asOf">
): DrawerReading {
  const summary = summarizeVerdict(subspaceId, verdict, {
    freshness: "when-read",
    doorShape,
  });
  return {
    ...read,
    prose: summary.prose,
    envelope: {
      heading: read.retained
        ? RETAINED_ENVELOPE_HEADING
        : LIVE_ENVELOPE_HEADING,
      facts: summary.facts,
    },
  };
}

/**
 * A report door's answer as a reading. Its raw report is shown only in
 * operator mode, so only there is there one below to point at.
 */
function reportReading(
  presenting: boolean,
  read: Pick<DrawerReading, "retained" | "source" | "asOf">
): DrawerReading {
  return {
    ...read,
    prose: `coord answers this sub-space with its own report, not a verdict — served, not graded.${presenting ? "" : " The raw data below is the report."}`,
    envelope: null,
  };
}

/** The Summary of a row the drawer reads itself. */
function ownReadSummary(
  row: ResolvedSubspace,
  own: Exclude<OwnRead, { kind: "none" }>,
  presenting: boolean
): DrawerSummary {
  // What the door answers with, as far as the page knows: with its shape
  // unknown, a failure names neither guess.
  const noun =
    row.doorShape === "report"
      ? "report"
      : row.doorShape === "verdict_wrapper"
        ? "verdict"
        : "verdict or report";
  const failure = (error: unknown): DrawerLine => ({
    kind: "read-error",
    // Named as the drawer's own read, so beside the probe's Status it is
    // never left to guess which read failed. The message quotes the
    // upstream body: the operator's alone.
    text: `This drawer's own read of the live ${noun} failed${failureTail(error, presenting)}.`,
  });
  switch (own.kind) {
    case "unmade":
      return {
        lines: [
          {
            kind: "read-unmade",
            text: own.online
              ? "This drawer's own read of the observer has not answered, and none is in flight."
              : "This drawer's own read of the observer has not been made: this browser is offline.",
          },
        ],
        reading: null,
      };
    case "in-flight":
      return {
        lines: [
          {
            kind: "read-in-flight",
            text: "This drawer's own read of the observer is in flight…",
          },
        ],
        reading: null,
      };
    case "failed":
      return { lines: [failure(own.error)], reading: null };
    case "answered":
    case "retained": {
      const retained = own.kind === "retained";
      const lead: DrawerLine[] = retained ? [failure(own.error)] : [];
      const { reading } = own;
      if (reading === null) {
        // An answer with no reading in it is nothing to show; a kept one
        // is not worth keeping either.
        return retained
          ? { lines: lead, reading: null }
          : {
              lines: [
                {
                  kind: "read-empty",
                  text: `This drawer's own read of the observer answered with no ${noun}.`,
                },
              ],
              reading: null,
            };
      }
      const read = {
        retained,
        source: DRAWER_READ_SOURCE,
        asOf: own.readAt,
      };
      return {
        lines: retained
          ? [...lead, { kind: "read-retained", text: RETAINED_LEAD }]
          : lead,
        reading:
          reading.kind === "report"
            ? reportReading(presenting, read)
            : // The drawer reads coord's twin door, whose verdict is a
              // DriftVerdict: a staleness it omits means a live answer.
              verdictReading(row.id, reading.value, "verdict_wrapper", read),
      };
    }
  }
}

/**
 * An envelope door's reading: the envelope fields the probe carried for the
 * row, or `null` when its answer carried none. The door's answer is not a
 * DriftVerdict, and its `staleness_seconds` is always missing (the admin
 * outbound door reports none), so the reading's freshness is UNKNOWN.
 */
function envelopeVerdictOf(row: ResolvedSubspace): DriftVerdict | null {
  if (!row.metrics) return null;
  return {
    coverage: row.metrics.coverage,
    credibility: row.metrics.credibility,
    posterior: row.metrics.posterior,
    staleness_seconds: row.metrics.staleness_seconds,
    provenance: row.metrics.provenance,
    drift_class: row.metrics.drift_class ?? undefined,
  };
}

/**
 * The Summary of an envelope door: the probe's answer for the row — current,
 * or the last one after a failed refresh, which leads with that failure.
 */
function envelopeDoorSummary(
  row: ResolvedSubspace,
  probe: DrawerSummaryInput["probe"]
): DrawerSummary {
  const held = probe.refreshFailed;
  const lines: DrawerLine[] = held
    ? [
        {
          kind: "probe-held",
          text: `Coord's live probe's latest read failed${statusSuffix(probe.error)}.`,
        },
      ]
    : [];
  const verdict = envelopeVerdictOf(row);
  if (verdict === null) {
    return {
      lines: [
        ...lines,
        {
          kind: "no-envelope",
          text: held
            ? "Its last answer carried no credibility envelope."
            : "The probe returned no credibility envelope.",
        },
      ],
      reading: null,
    };
  }
  return {
    lines: held
      ? [...lines, { kind: "read-retained", text: RETAINED_LEAD }]
      : lines,
    reading: verdictReading(row.id, verdict, "envelope", {
      retained: held,
      source: FIDELITY_SOURCE.probe,
      asOf: probe.asOf,
    }),
  };
}

/**
 * The drawer's Summary box, or `null` when it has none: a row the page does
 * not probe has nothing read, and an envelope door with no probe answer for
 * it (in flight, or none held) has no answer to describe — its Status says
 * why.
 */
export function drawerSummary({
  row,
  probe,
  own,
  presenting,
}: DrawerSummaryInput): DrawerSummary | null {
  if (own.kind !== "none") return ownReadSummary(row, own, presenting);
  if (row.doorShape === "envelope" && probeAnswered(row)) {
    return envelopeDoorSummary(row, probe);
  }
  return null;
}

/**
 * The raw JSON the operator may open — what the drawer's own read returned,
 * whether it is a verdict or a report, the tool that answered, and whether it
 * is the last answer kept after a failed read — or `null` when it holds none.
 */
export function drawerRawReading(own: OwnRead): {
  readonly json: DriftVerdict;
  readonly kind: OwnReading["kind"];
  readonly tool: string | null;
  readonly retained: boolean;
} | null {
  if (own.kind !== "answered" && own.kind !== "retained") return null;
  if (own.reading === null) return null;
  return {
    json: own.reading.value,
    kind: own.reading.kind,
    tool: own.tool,
    retained: own.kind === "retained",
  };
}
