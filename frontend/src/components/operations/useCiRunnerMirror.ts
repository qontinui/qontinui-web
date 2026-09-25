"use client";

/**
 * `GET /api/v1/operations/fleet/ci-runners` — coord's mirror of the self-hosted
 * CI runners and the labels GitHub routes on. Plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2.
 *
 * ## Why this one polls, when `useDevenvMachines` does not
 *
 * The devenv roster changes when a person enrols a machine — an operator action
 * taken elsewhere — so reading it once is honest. Labels are different: coord's
 * registrar re-mirrors GitHub roughly every 60 s and rewrites them by itself, so
 * a read-once here would show a delabelled host as still routable for as long
 * as the tab stayed open, which is precisely the wrong answer to give during an
 * incident.
 *
 * The cadence is matched to the upstream one rather than to the page's other
 * polls. Faster than the registrar buys nothing — the row cannot change between
 * its writes — and the page labels the age from the response's own
 * `freshness_secs` rather than from when this hook last asked.
 *
 * Every failure lands on `unavailable` WITH the reason, and the previous rows
 * are dropped rather than kept: a stale label set presented as current is the
 * one output this surface must not produce.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import {
  parseCiRunnersPayload,
  type CiRunnerMirrorRead,
} from "./ciRunnerMirror";

/**
 * A SAME-ORIGIN literal, matching `FLEET_HEALTH_API`'s convention rather than
 * `OPERATIONS_API`'s prefixed one. The console has both today; reconcile them
 * in a change that is about that.
 */
export const CI_RUNNER_MIRROR_API = "/api/v1/operations/fleet/ci-runners";

/** Coord's registrar cadence. Polling faster reads the same row twice. */
export const CI_RUNNER_MIRROR_POLL_MS = 60_000;

const LOADING: CiRunnerMirrorRead = { state: "loading" };

export function useCiRunnerMirror(): CiRunnerMirrorRead {
  const [read, setRead] = useState<CiRunnerMirrorRead>(LOADING);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5).
  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await httpClient.get<unknown>(
        CI_RUNNER_MIRROR_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      setRead(parseCiRunnersPayload(body));
    } catch (err) {
      if (!isCurrent()) return;
      setRead({
        state: "unavailable",
        reason:
          err instanceof Error
            ? `the CI-runner mirror could not be read: ${err.message}`
            : "the CI-runner mirror could not be read.",
      });
    }
  }, []);

  useSingleFlightPoll(poll, CI_RUNNER_MIRROR_POLL_MS);

  return read;
}
