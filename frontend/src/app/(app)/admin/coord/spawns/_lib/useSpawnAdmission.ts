"use client";

/**
 * `GET /api/v1/operations/fleet/spawn-admission` — transport and polling; what
 * a body means is `spawnAdmission.ts`. Same shape as `useFleetDispatchRoles`:
 * every failure is UNKNOWN, including the 404 of a coord a deploy behind this
 * console. A refresh that fails keeps the last good facts, labelled stale,
 * except that 404, which says coord no longer serves the read at all.
 */

import { useCallback, useState } from "react";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { servedAsOfMs } from "@/components/operations/servedAsOf";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import { fetchFleetSpawnAdmission } from "@/lib/api/operations/coordFleet";
import {
  admissionFigureRead,
  parseSpawnAdmission,
  type SpawnAdmissionRead,
} from "./spawnAdmission";

/**
 * In-flight counts move with sessions, as session load's read does, and coord
 * runs one count per loaded machine to answer: a minute matches that read.
 */
export const SPAWN_ADMISSION_POLL_MS = 60_000;

export interface SpawnAdmissionHook {
  read: SpawnAdmissionRead;
  /** When the last `known` read was true, or `null` before there was one. */
  asOfMs: number | null;
  refresh: () => Promise<void>;
}

function failureReason(err: unknown): string {
  const status = httpStatusOf(err);
  if (status === 404) {
    return (
      "Coord serves no spawn admission read on this deployment " +
      "(GET /coord/fleet/spawn-admission answered 404). Expected while coord " +
      "is a deploy behind this console"
    );
  }
  if (status !== null)
    return `the spawn admission read returned HTTP ${status}`;
  return err instanceof Error ? err.message : String(err);
}

export function useSpawnAdmission(): SpawnAdmissionHook {
  const [read, setRead] = useState<SpawnAdmissionRead>({ state: "loading" });
  const [asOfMs, setAsOfMs] = useState<number | null>(null);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await fetchFleetSpawnAdmission(COORD_DASHBOARD_POLL_OPTIONS);
      const next = parseSpawnAdmission(body);
      if (!isCurrent()) return;
      setRead(next);
      if (next.state === "known" && admissionFigureRead(next.facts)) {
        setAsOfMs(servedAsOfMs(body, Date.now()));
      }
    } catch (err) {
      if (!isCurrent()) return;
      const reason = failureReason(err);
      setRead((prev) =>
        prev.state === "known" && httpStatusOf(err) !== 404
          ? { ...prev, staleReason: reason }
          : { state: "unknown", reason }
      );
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, SPAWN_ADMISSION_POLL_MS);
  return { read, asOfMs, refresh };
}
