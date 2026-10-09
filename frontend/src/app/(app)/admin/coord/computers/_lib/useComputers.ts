"use client";

/**
 * The two computer reads, polled.
 *
 * Transport: the authenticated REST proxies
 * `GET /api/v1/operations/computers` and `…/computers/{id}`, which forward the
 * operator bearer to coord and pass coord's status and JSON body through
 * verbatim (`_proxy_coord_passthrough`). **Never call coord from the browser**
 * — the same posture as `useFleetResourceSamples`, for the same recorded
 * reason (an anonymous coord read silently emptied a tile).
 *
 * Single-flight with no retries (`COORD_DASHBOARD_POLL_OPTIONS`): the next
 * tick is the retry, exactly as every other coord-proxied Dev Ops poll.
 *
 * **A failed read keeps the last body** — except `not_found` and
 * `forbidden`, which clear it (see the catch below). Dropping it would render the fleet as
 * absent, which is a different — and equally wrong — claim from stale. What
 * keeps the page honest during an outage is `fetchedAtMs`, stamped only on
 * success: `computerStatus.ts` ages every freshness verdict by the time since
 * it, so a silent coord turns rows stale on screen by itself.
 */

import { useCallback, useState } from "react";
import {
  fetchComputer,
  fetchComputers,
} from "@/lib/api/operations/coordComputers";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  classifyComputersError,
  isSchemaPendingBody,
  type ComputerDetailWire,
  type ComputersListWire,
  type ComputersReadIssue,
} from "./computerStatus";

/** Matches the 30 s sample cadence: polling faster reads the same sample twice. */
export const COMPUTERS_POLL_MS = 30_000;

export interface ComputersRead<T> {
  data: T | null;
  /** What the LATEST read said, when it was not a usable body. `null` after a success. */
  issue: ComputersReadIssue | null;
  loading: boolean;
  /** `Date.now()` of the last successful read; `null` before the first. */
  fetchedAtMs: number | null;
  refresh: () => Promise<void> | void;
}

function useComputersRead<T>(
  read: () => Promise<T>,
  detail: boolean
): ComputersRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [issue, setIssue] = useState<ComputersReadIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      try {
        const body = await read();
        if (!isCurrent()) return;
        // A 2xx that SAYS the schema is pending is not a body to render: an
        // empty `computers` beside it would read as a measured empty fleet.
        if (isSchemaPendingBody(body)) {
          setIssue({ kind: "schema_pending" });
          return;
        }
        setData(body);
        setFetchedAtMs(Date.now());
        setIssue(null);
      } catch (e) {
        if (!isCurrent()) return;
        const issue = classifyComputersError(e, { detail });
        // Two answers SUPERSEDE the retained body rather than aging it: coord
        // saying this computer is not in the tenant, and coord refusing the
        // caller outright. Keeping the last body on screen beside either would
        // show figures for a record coord just said is not (or no longer)
        // yours to see. Every other failure keeps it, labelled stale.
        if (
          issue.kind === "not_found" ||
          issue.kind === "forbidden" ||
          issue.kind === "tenant_not_resolved"
        ) {
          setData(null);
          setFetchedAtMs(null);
        }
        setIssue(issue);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [read, detail]
  );

  const { refresh } = useSingleFlightPoll(poll, COMPUTERS_POLL_MS);
  return { data, issue, loading, fetchedAtMs, refresh };
}

// One request per poll, no client retries: the next tick is the retry.
const readComputers = () => fetchComputers(COORD_DASHBOARD_POLL_OPTIONS);
const readComputer = (computerId: string) =>
  fetchComputer(computerId, COORD_DASHBOARD_POLL_OPTIONS);

export function useComputers(): ComputersRead<ComputersListWire> {
  return useComputersRead<ComputersListWire>(readComputers, false);
}

export function useComputer(
  computerId: string
): ComputersRead<ComputerDetailWire> {
  const read = useCallback(() => readComputer(computerId), [computerId]);
  return useComputersRead<ComputerDetailWire>(read, true);
}
