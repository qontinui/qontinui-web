/**
 * useSubprojectDetail — `GET /operations/subprojects/{id}`, whose verdict coord
 * computes LIVE on every read (D1), re-read every 60 s while the tab is
 * visible and after every write the page makes.
 *
 * Three answers, kept apart (style guide R6):
 *
 * - **read** — the record, stamped with the id that produced it. Rows on
 *   screen are derived from whether that stamp matches the id in the URL, so
 *   navigating from one subproject to another never shows the old one under
 *   the new heading.
 * - **not found** — coord ANSWERED that this tenant has no such subproject (a
 *   404 from its handler, or the backend refusing an id that is not a uuid).
 *   That is an answer, and the record is dropped.
 * - **unreadable** — nothing answered, the door is not deployed, or the
 *   migration is pending. A record read earlier for this id is KEPT and named
 *   as the last good read; with none, the page is UNKNOWN with the reason.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchSubproject,
  type SubprojectDetailResponse,
} from "@/lib/api/operations/coordSubprojects";
import {
  classifySubprojectReadFailure,
  isRouteMissing,
  type SubprojectReadFailure,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { useStampedFailure } from "@/components/admin/coord/subprojects/useStampedFailure";

export const SUBPROJECT_DETAIL_POLL_MS = 60_000;

/** Why coord said there is nothing to show. */
export type SubprojectAbsence = "not_found" | "invalid_id";

interface Stamped {
  id: string;
  /** `null` once coord answered that the id names nothing. */
  detail: SubprojectDetailResponse | null;
  absence: SubprojectAbsence | null;
  /** When this answer arrived (the body carries the verdict's own `as_of`). */
  readAt: string;
}

export interface SubprojectDetailState {
  detail: SubprojectDetailResponse | null;
  /** coord answered for THIS id (a record, or that there is none). */
  loaded: boolean;
  absence: SubprojectAbsence | null;
  /** The latest read failed without an answer, with this. */
  failure: SubprojectReadFailure | null;
  /** A record for this id is on screen and the latest read of it failed. */
  stale: boolean;
  readAt: string | null;
  refresh: () => Promise<void>;
}

export function useSubprojectDetail(id: string): SubprojectDetailState {
  const axis = useRetainedValue<Stamped | null>(null);
  // Failures are stamped with the id AND the read's sequence number, so an
  // older read that succeeds after a newer one failed cannot clear it, and
  // another id's failure never labels this one (`useStampedFailure`).
  const failures = useStampedFailure<string>();
  const { fail, succeed } = failures;
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const { issue, settle } = axis;
  const read = useCallback(async () => {
    if (!id) return;
    const seq = issue();
    const readAt = () => new Date().toISOString();
    try {
      const detail = await fetchSubproject(id, COORD_DASHBOARD_POLL_OPTIONS);
      if (cancelled.current) return;
      settle(seq, { value: { id, detail, absence: null, readAt: readAt() } });
      succeed(id, seq);
    } catch (err) {
      if (cancelled.current) return;
      const status = httpStatusOf(err);
      // coord answered — the id names nothing — which is an answer, not a
      // failure: the record is dropped and the absence said.
      const absence: SubprojectAbsence | null =
        status === 404 && !isRouteMissing(err)
          ? "not_found"
          : status === 422
            ? "invalid_id"
            : null;
      if (absence !== null) {
        settle(seq, { value: { id, detail: null, absence, readAt: readAt() } });
        succeed(id, seq);
        return;
      }
      settle(seq, null);
      fail(id, seq, classifySubprojectReadFailure(err));
    }
  }, [id, issue, settle, fail, succeed]);

  // A new id is a new question: read it at once. Its rows are derived from
  // the stamp below, so the previous id's record never shows under it.
  useEffect(() => {
    void read();
  }, [read]);

  useVisiblePoll(read, SUBPROJECT_DETAIL_POLL_MS);

  const value = axis.value;
  const same = value !== null && value.id === id;
  const failureHere = failures.failureFor(id);
  return {
    detail: same ? value.detail : null,
    loaded: same,
    absence: same ? value.absence : null,
    failure: failureHere,
    stale: same && value.detail !== null && failureHere !== null,
    readAt: same ? value.readAt : null,
    refresh: read,
  };
}
