/**
 * The live sub-space probe as every view of it reads it — the Twin map, the
 * Completeness matrix and the Lifecycle view (plan
 * `2026-10-23-console-presentation-spaces` Phase 5).
 *
 * The three views render the same `useDigitalTwinSubspaces` answer, so they
 * share ONE rule for when that answer holds no reading at all
 * ({@link probeUnread}): the request failed with no earlier answer held; the
 * backend answered degraded — HTTP 200 with no probe made, its cells
 * stand-ins ({@link probeDegradedReason}); or there is no answer, no failure
 * and no read in flight — react-query holding the read
 * ({@link probeUnansweredReason}). Then nothing drawn from the probe
 * is a count. Every live-probed row resolves `unknown` (`resolveSubspaces`),
 * never the stand-in's red "Error"; and every figure, gauge and count over
 * those rows is a labelled UNKNOWN naming why, dated by the attempt — never a
 * "0 of N" that reads as a twin observing nothing
 * (`verification-and-evidence` `unknown-must-not-render-as-a-default`).
 *
 * Pure functions (unit-tested in `probe-read.test.ts`); `useProbeRead` is
 * the hook the views call.
 */

import { statusSuffix } from "./failure-text";
import { allProbesRestricted, resolveSubspaces } from "./resolve";
import type {
  ResolvedSubspace,
  SubspacesProbeResponse,
  TwinCatalogResponse,
} from "./types";

/** The fields of the probe query (react-query's result) a read is built from. */
export interface ProbeQuery {
  readonly data: SubspacesProbeResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
  /**
   * Whether react-query's `onlineManager` holds this browser online. It makes
   * no read while it does not (the app's default `online` network mode), so
   * this is what names why a probe with no answer has no read in flight.
   */
  readonly online: boolean;
}

/** The probe as the views read it. */
export interface ProbeRead {
  /**
   * Every manifest row joined with coord's catalog and the probe
   * (`resolveSubspaces`). While the probe holds no reading, every
   * live-probed row is `unknown`, with the reason.
   */
  readonly rows: readonly ResolvedSubspace[];
  /** The probe failed and no earlier answer is held. */
  readonly failed: boolean;
  /**
   * The last refresh failed over an earlier answer, which is what `rows`
   * still show — a reading, dated by `asOf`, not a current one.
   */
  readonly refreshFailed: boolean;
  readonly error: unknown;
  /**
   * The probe answered degraded — no probe was made — and this is why
   * ({@link probeDegradedReason}); `null` for a real answer.
   */
  readonly degraded: string | null;
  /**
   * There is no answer, no failure and no read in flight — react-query is
   * holding the read — and this is why ({@link probeUnansweredReason});
   * `null` otherwise.
   */
  readonly unanswered: string | null;
  /** Every probe was refused (`allProbesRestricted`). */
  readonly restricted: boolean;
  /** When the answer shown was read (epoch ms), or `null`. */
  readonly asOf: number | null;
  /** When the last failed attempt was made (epoch ms), or `null`. */
  readonly failedAt: number | null;
}

/**
 * The probe's read without its rows: what the banner and the sub-space drawer
 * read beside a row — whether the probe holds a reading at all, whether its
 * last refresh failed over the answer the rows still show, and when each
 * answer or attempt was made.
 */
export type ProbeAttempt = Pick<
  ProbeRead,
  | "failed"
  | "refreshFailed"
  | "error"
  | "degraded"
  | "unanswered"
  | "asOf"
  | "failedAt"
>;

/** Why there is no reading, and when the attempt that established it was made. */
export interface ProbeSilence {
  readonly reason: string;
  /** Epoch ms of that attempt, or `null` when its time is unknown. */
  readonly asOf: number | null;
}

/** What each token of the backend's degraded probe answer means, in words. */
const DEGRADED_CAUSE: Readonly<Record<string, string>> = {
  coord_unavailable: "coord could not be reached",
  catalog_unavailable: "coord's catalog of live probes could not be read",
};

/**
 * Why a probe answer flagged `degraded` holds no reading, or `null` when the
 * answer is not degraded.
 *
 * The backend answers HTTP 200 with `degraded: true` when coord, the tenant or
 * coord's catalog could not be read (`digital_twin.py` `_degraded_matrix`):
 * no probe was made, and its cells are stand-ins — one `error` per id coord
 * last declared, carrying the token that names why. Read as an answer, every
 * stand-in counts as a probe that did not answer, and a figure drawn from them
 * is a measured-looking zero ("0 of 9 observed") during an outage. The cause
 * comes from the cells' token; an empty degraded answer (no declaration ever
 * read), or a token this page does not know, names no cause.
 */
export function probeDegradedReason(
  data: Pick<SubspacesProbeResponse, "degraded" | "subspaces"> | undefined
): string | null {
  if (data?.degraded !== true) return null;
  const cause = data.subspaces
    .map((cell) => (cell.error ? DEGRADED_CAUSE[cell.error] : undefined))
    .find((words) => words !== undefined);
  return cause
    ? `coord's live probe could not be made: ${cause}`
    : "coord's live probe could not be made";
}

/**
 * Why the probe has no answer, no failure and no read in flight, or `null`
 * when it has one of those.
 *
 * React-query makes no read while its `onlineManager` holds this browser
 * offline (the app's default `online` network mode), and pauses a retry while
 * the browser is offline or this tab is hidden. Then the probe is pending but
 * not fetching: `isLoading` is false, so without this rule every live row
 * would resolve the `error` of a probe that ran, when none answered. Offline
 * is the one cause this page can see, so it is named only when it holds.
 */
export function probeUnansweredReason(
  query: Pick<ProbeQuery, "data" | "isError" | "isLoading" | "online">
): string | null {
  if (query.data || query.isError || query.isLoading) return null;
  return query.online
    ? "coord's live probe has not answered, and no read of it is in flight"
    : "coord's live probe has not answered: this browser is offline";
}

/**
 * Why the probe holds no reading at all, or `null` when it holds one — THE
 * rule every view of the probe applies. A failed read with nothing held is
 * dated by the failed attempt; a degraded answer by when it came back; a held
 * read by nothing, since no attempt of it answered or failed. A failed refresh
 * over an earlier answer is not silence: that answer is a reading, shown with
 * its own age.
 */
export function probeUnread(
  probe: Pick<
    ProbeRead,
    "failed" | "error" | "degraded" | "unanswered" | "asOf" | "failedAt"
  >
): ProbeSilence | null {
  if (probe.failed) {
    return {
      reason: `coord's live probe could not be read${statusSuffix(probe.error)}`,
      asOf: probe.failedAt,
    };
  }
  // Its cells are stand-ins, not readings; the as-of is when it was asked.
  if (probe.degraded !== null) {
    return { reason: probe.degraded, asOf: probe.asOf };
  }
  if (probe.unanswered !== null) {
    return { reason: probe.unanswered, asOf: null };
  }
  return null;
}

const at = (ms: number): number | null => (ms > 0 ? ms : null);

/**
 * The probe query, joined with coord's catalog, as the views read it. While
 * the probe holds no reading ({@link probeUnread}) its rows carry that, so no
 * view can draw a status or a count from a stand-in cell.
 */
export function probeReadOf(
  query: ProbeQuery,
  catalog?: TwinCatalogResponse
): ProbeRead {
  const read = {
    failed: query.isError && !query.data,
    refreshFailed: query.isError && !!query.data,
    error: query.error,
    degraded: probeDegradedReason(query.data),
    unanswered: probeUnansweredReason(query),
    restricted: allProbesRestricted(query.data),
    asOf: at(query.dataUpdatedAt),
    failedAt: at(query.errorUpdatedAt),
  };
  const silence = probeUnread(read);
  return {
    ...read,
    rows: resolveSubspaces(
      query.data?.subspaces,
      query.isLoading,
      catalog,
      silence?.reason ?? null
    ),
  };
}
