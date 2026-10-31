"use client";

/**
 * useHomeSupplements — the reads `/admin/coord/home` makes beside coord's
 * project state (`_lib/homeSupplements.ts` says what each one is for).
 *
 * Polled with the project state's own cadence (60 s, gated on tab
 * visibility, single-flight) and one request per read
 * (`COORD_DASHBOARD_POLL_OPTIONS`): the next tick is the retry. Each read
 * keeps its last good answer through a failed poll and says so (`stale`),
 * the same R6 rule `useProjectState` follows; a read that never landed is
 * `could_not_read` once it has failed, `unknown` before it has answered.
 *
 * The two queue reads (gates, questions) stand in for coord's `needs_me`
 * block, so they run only while the page says it needs them (`needsQueues`):
 * once coord serves that block, the page stops asking.
 *
 * `refresh()` re-reads now, joining a read already out, so the page's one
 * refresh button re-reads everything it shows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { PROJECT_STATE_POLL_MS } from "@/components/admin/coord/coordHomeStatus";
import { fetchFleetHealth } from "@/lib/api/operations/coordFleet";
import { fetchPendingAgentQuestions } from "@/lib/api/operations/agentQuestions";
import { adminDevService } from "@/services/admin-dev-service";
import type {
  EmptyRoster,
  MachineHealthCounts,
} from "@/components/admin/coord/machineHealth";
import {
  GATES_PAGE_SIZE,
  MACHINES_NOT_READ,
  QUESTIONS_PAGE_SIZE,
  QUEUE_NOT_READ,
  countOpenOperatorGates,
  countPendingOperatorQuestions,
  parseMachineHealth,
  type MachineHealthView,
  type QueueCount,
} from "../_lib/homeSupplements";

export interface HomeSupplements {
  machines: MachineHealthView;
  /** Open operator-approval gates addressed to the operator. */
  gates: QueueCount;
  /** Pending agent questions addressed to the operator. */
  questions: QueueCount;
  refresh: () => Promise<void>;
}

interface Machines {
  counts: MachineHealthCounts;
  asOf: string | null;
  emptyRoster: EmptyRoster | null;
}
interface Queue {
  count: number;
  exact: boolean;
  asOf: string | null;
  kept: boolean;
}

/** One retained read as the page renders it. */
function machinesView(
  axis: { value: Machines | null; hasRead: boolean; stale: boolean },
  failed: boolean
): MachineHealthView {
  if (axis.value === null) {
    return {
      ...MACHINES_NOT_READ,
      state: failed ? "could_not_read" : "unknown",
    };
  }
  return {
    state: "read",
    counts: axis.value.counts,
    asOf: axis.value.asOf,
    stale: axis.stale,
    emptyRoster: axis.value.emptyRoster,
  };
}

function queueView(
  axis: { value: Queue | null; stale: boolean },
  failed: boolean
): QueueCount {
  if (axis.value === null) {
    return { ...QUEUE_NOT_READ, state: failed ? "could_not_read" : "unknown" };
  }
  return {
    state: "read",
    count: axis.value.count,
    exact: axis.value.exact,
    asOf: axis.value.asOf,
    stale: axis.stale || axis.value.kept,
  };
}

export function useHomeSupplements({
  needsQueues,
}: {
  needsQueues: boolean;
}): HomeSupplements {
  const machinesAxis = useRetainedValue<Machines | null>(null);
  const gatesAxis = useRetainedValue<Queue | null>(null);
  const questionsAxis = useRetainedValue<Queue | null>(null);
  const [failed, setFailed] = useState({
    machines: false,
    gates: false,
    questions: false,
  });
  const cancelled = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  // Read by ref, so a change does not rebuild the poll.
  const wantQueues = useRef(needsQueues);
  useEffect(() => {
    wantQueues.current = needsQueues;
  }, [needsQueues]);

  const { issue: issueM, settle: settleM } = machinesAxis;
  const { issue: issueG, settle: settleG } = gatesAxis;
  const { issue: issueQ, settle: settleQ } = questionsAxis;

  const readOnce = useCallback(async () => {
    const queues = wantQueues.current;
    const seqM = issueM();
    const seqG = queues ? issueG() : null;
    const seqQ = queues ? issueQ() : null;
    const [m, g, q] = await Promise.allSettled([
      fetchFleetHealth(COORD_DASHBOARD_POLL_OPTIONS),
      queues
        ? adminDevService.getOverview({
            verdict: "open",
            limit: GATES_PAGE_SIZE,
          })
        : Promise.resolve(null),
      queues
        ? fetchPendingAgentQuestions(
            { limit: QUESTIONS_PAGE_SIZE, audience: "operator" },
            COORD_DASHBOARD_POLL_OPTIONS
          )
        : Promise.resolve(null),
    ]);
    if (cancelled.current) return;
    const machines =
      m.status === "fulfilled" ? parseMachineHealth(m.value) : null;
    settleM(seqM, machines ? { value: machines } : null);
    const next = {
      machines: machines === null,
      gates: false,
      questions: false,
    };
    if (seqG !== null) {
      const overview = g.status === "fulfilled" ? g.value : null;
      const gates = overview ? countOpenOperatorGates(overview) : null;
      settleG(
        seqG,
        gates
          ? {
              value: {
                ...gates,
                asOf:
                  typeof overview?.generated_at === "string"
                    ? overview.generated_at
                    : null,
              },
            }
          : null
      );
      next.gates = gates === null;
    }
    if (seqQ !== null) {
      const questions =
        q.status === "fulfilled"
          ? countPendingOperatorQuestions(q.value)
          : null;
      settleQ(
        seqQ,
        questions
          ? {
              value: {
                ...questions,
                kept: false,
                // The questions list carries no generation time: the figure
                // is dated by when this page read it.
                asOf: new Date().toISOString(),
              },
            }
          : null
      );
      next.questions = questions === null;
    }
    setFailed((prev) => ({
      machines: next.machines,
      gates: seqG === null ? prev.gates : next.gates,
      questions: seqQ === null ? prev.questions : next.questions,
    }));
  }, [issueM, issueG, issueQ, settleM, settleG, settleQ]);

  const read = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const pending = readOnce().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = pending;
    return pending;
  }, [readOnce]);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, [read]);

  useVisiblePoll(read, PROJECT_STATE_POLL_MS, { runOnMount: true });

  // The page came to need the queue counts after the poll's last read (coord
  // stopped serving `needs_me`): read them now rather than a minute late.
  const queuesRead = gatesAxis.hasRead || questionsAxis.hasRead;
  useEffect(() => {
    if (needsQueues && !queuesRead) void read();
  }, [needsQueues, queuesRead, read]);

  return {
    machines: machinesView(machinesAxis, failed.machines),
    gates: queueView(gatesAxis, failed.gates),
    questions: queueView(questionsAxis, failed.questions),
    refresh: read,
  };
}
