/**
 * useTopicsList — `GET /operations/topics`, one read of every topic with its
 * cached rollup, re-read every 60 s while the tab is visible.
 *
 * coord serves the whole list in one answer (no pagination), so the page's
 * tabs filter it client-side and count what it holds. Three states, kept
 * apart (style guide R6):
 *
 * - **unread** — nothing has answered: every count is `null` (`–`);
 * - **read** — the list, with coord's `as_of`;
 * - **failed** — the latest read did not answer. A list read earlier is KEPT
 *   and said to be the last good one (`stale`); with none, the page is
 *   UNKNOWN with the reason — a pending migration said as exactly that.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  fetchTopics,
  type TopicListResponse,
} from "@/lib/api/operations/coordTopics";
import {
  classifySubprojectReadFailure,
  type SubprojectReadFailure,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { useStampedFailure } from "@/components/admin/coord/subprojects/useStampedFailure";

export const TOPICS_POLL_MS = 60_000;

/** The one question this hook asks; the failure tracker is keyed on it. */
const LIST = "list" as const;

export interface TopicsListState {
  list: TopicListResponse | null;
  /** A read has answered. */
  loaded: boolean;
  /** The latest read failed with this. */
  failure: SubprojectReadFailure | null;
  /** A list is on screen and the latest read of it failed. */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useTopicsList(): TopicsListState {
  const axis = useRetainedValue<TopicListResponse | null>(null);
  const failures = useStampedFailure<typeof LIST>();
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
    const seq = issue();
    try {
      const list = await fetchTopics(
        new URLSearchParams(),
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (cancelled.current) return;
      settle(seq, { value: list });
      succeed(LIST, seq);
    } catch (err) {
      if (cancelled.current) return;
      settle(seq, null);
      fail(LIST, seq, classifySubprojectReadFailure(err));
    }
  }, [issue, settle, fail, succeed]);

  useVisiblePoll(read, TOPICS_POLL_MS, { runOnMount: true });

  const failure = failures.failureFor(LIST);
  return {
    list: axis.value,
    loaded: axis.hasRead,
    failure,
    stale: axis.value !== null && failure !== null,
    refresh: read,
  };
}
