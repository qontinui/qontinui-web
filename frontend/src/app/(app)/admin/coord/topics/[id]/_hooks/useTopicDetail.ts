/**
 * useTopicDetail — `GET /operations/topics/{id}`, re-read every 60 s while the
 * tab is visible. The same three answers as `useSubprojectDetail` (style guide
 * R6): a record stamped with the id that produced it; coord ANSWERING that the
 * id names nothing (404, or the backend refusing an id that is not a uuid);
 * or no answer, which keeps a record read earlier for this id and names it as
 * the last good read.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchTopic,
  type TopicDetailResponse,
} from "@/lib/api/operations/coordTopics";
import {
  classifySubprojectReadFailure,
  isRouteMissing,
  type SubprojectReadFailure,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { useStampedFailure } from "@/components/admin/coord/subprojects/useStampedFailure";

export const TOPIC_DETAIL_POLL_MS = 60_000;

export type TopicAbsence = "not_found" | "invalid_id";

interface Stamped {
  id: string;
  detail: TopicDetailResponse | null;
  absence: TopicAbsence | null;
  readAt: string;
}

export interface TopicDetailState {
  detail: TopicDetailResponse | null;
  loaded: boolean;
  absence: TopicAbsence | null;
  failure: SubprojectReadFailure | null;
  stale: boolean;
  readAt: string | null;
  refresh: () => Promise<void>;
}

export function useTopicDetail(id: string): TopicDetailState {
  const axis = useRetainedValue<Stamped | null>(null);
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
      const detail = await fetchTopic(id, COORD_DASHBOARD_POLL_OPTIONS);
      if (cancelled.current) return;
      settle(seq, { value: { id, detail, absence: null, readAt: readAt() } });
      succeed(id, seq);
    } catch (err) {
      if (cancelled.current) return;
      const status = httpStatusOf(err);
      const absence: TopicAbsence | null =
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

  useEffect(() => {
    void read();
  }, [read]);

  useVisiblePoll(read, TOPIC_DETAIL_POLL_MS);

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
