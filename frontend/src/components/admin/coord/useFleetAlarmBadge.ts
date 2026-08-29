"use client";

/**
 * The fleet alarm counts, for the `Dev Ops ▾` nav trigger.
 *
 * ## Why this is in the nav at all
 *
 * These five counts — `unhealthy` / `breach` / `warn` / `stale` / `unknown` —
 * used to be rendered on the collapsed `System details` header of
 * `/admin/coord/fleet`, and the two polls behind them ran on that page
 * unconditionally *because* the drawer unmounted its children: a red fleet had
 * to be visible without opening the drawer. Plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 4 deletes that
 * drawer, so the alarm moved here — the same shape `CoordNav` already runs for
 * the Alerts and Notifications badges, and now visible from EVERY console page
 * rather than from one.
 *
 * ## The `unknown` count is not optional, and is not red
 *
 * A fleet whose telemetry has gone entirely dark publishes no samples at all.
 * A badge that showed only breaches would render such a fleet exactly like a
 * healthy one — silence — which is a false-safe of the same class as
 * `[policy: silent-empty-is-unknown]`. So `unknown` renders even though
 * nothing is wrong-coloured about it, and it is the ONE count whose absence
 * from this hook would be a correctness defect rather than a layout choice.
 *
 * ## Cadence, and what a failure means
 *
 * 60 s — the nav cadence (`ALERTS_POLL_MS`), deliberately NOT the 10 s / 30 s
 * foreground cadences the Dev Ops Overview uses. This is a background hint on
 * every console page; the page that owns machine liveness still polls at its
 * own rate.
 *
 * Best-effort, like the sibling badges: a failed poll keeps the LAST KNOWN
 * counts rather than clearing them. Clearing would assert "the fleet is fine"
 * on evidence about the network. Before the first successful poll every count
 * is 0, so a console with no coord answers stays quiet rather than inventing
 * an alarm.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { httpClient } from "@/services/service-factory";
import { createLogger } from "@/lib/logger";
import {
  summarizeFleetAdmission,
  type FleetAdmissionSummary,
  type ResourceSamplesResponse,
} from "@/components/operations/fleetResources";
import {
  FLEET_HEALTH_API,
  type FleetHealthPayload,
} from "@/components/operations/useFleetHealth";
import {
  DEFAULT_WINDOW_SECS,
  FLEET_RESOURCE_SAMPLES_API,
} from "@/components/operations/useFleetResourceSamples";

const log = createLogger("useFleetAlarmBadge");

/** Nav cadence. Same 60 s as the alerts/notifications badges. */
export const FLEET_ALARM_POLL_MS = 60_000;

/**
 * How often the staleness clock advances.
 *
 * `age_secs` is frozen inside coord's payload, so without a ticking clock a
 * dead proxy would leave the trigger claiming an all-clear indefinitely — the
 * rows would never age into `stale`. Only an INTERVAL is measured here, never
 * an absolute time, so no clock skew is introduced.
 */
const TICK_MS = 15_000;

export interface FleetAlarmBadge extends FleetAdmissionSummary {
  /** Devices coord reports in a state other than `healthy`. */
  unhealthy: number;
}

/**
 * No counts. Also what a failed first poll produces — nothing renders, which
 * is right: before anything has answered, a nav badge asserting either an
 * alarm or an all-clear would be inventing one.
 *
 * Deliberately NOT a "N machines" count. The collapsed header this replaced
 * carried one, because it was the only thing distinguishing a drawer with a
 * fleet behind it from an empty one. A nav trigger already says `Dev Ops`;
 * adding a permanent machine count would make the row that matters — an
 * alarm — harder to spot, which is the opposite of why it moved here.
 */
const ZERO: FleetAlarmBadge = {
  unhealthy: 0,
  breach: 0,
  warn: 0,
  stale: 0,
  unknown: 0,
};

export function useFleetAlarmBadge(): FleetAlarmBadge {
  const [health, setHealth] = useState<FleetHealthPayload | null>(null);
  const [samples, setSamples] = useState<ResourceSamplesResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cancelled = useRef(false);

  const fetchCounts = useCallback(async () => {
    // Settled, not `all`: the two reads fail independently, and the health
    // list is the spine — a machine that publishes no sample still has to be
    // counted, so losing the samples read must not lose the machines too.
    const [healthRes, samplesRes] = await Promise.allSettled([
      httpClient.get<FleetHealthPayload>(FLEET_HEALTH_API),
      httpClient.get<ResourceSamplesResponse>(
        `${FLEET_RESOURCE_SAMPLES_API}?window_secs=${DEFAULT_WINDOW_SECS}`
      ),
    ]);
    if (cancelled.current) return;
    if (healthRes.status === "fulfilled") {
      setHealth(healthRes.value);
    } else {
      log.warn("fleet health badge fetch failed", healthRes.reason);
    }
    if (samplesRes.status === "fulfilled") {
      setSamples(samplesRes.value);
      // Stamped ONLY on success, for the same reason
      // `useFleetResourceSamples` does it: a failed poll must not reset the
      // clock the staleness rule reads, or an outage would keep every lane
      // looking fresh.
      setFetchedAtMs(Date.now());
    } else {
      log.warn("fleet resource-sample badge fetch failed", samplesRes.reason);
    }
  }, []);

  // `useVisiblePoll` re-arms its interval whenever `fn` changes identity, so
  // hand it one stable reference rather than a fresh arrow per render.
  const fetchCountsTick = useCallback(() => void fetchCounts(), [fetchCounts]);

  // The MOUNT fetch, and the cancelled-flag lifecycle it owns. Always runs,
  // including in a tab that mounts hidden, so the badge has a value the moment
  // it is revealed.
  useEffect(() => {
    cancelled.current = false;
    void fetchCounts();
    return () => {
      cancelled.current = true;
    };
  }, [fetchCounts]);

  // The REPEAT, gated on tab visibility like the nav's other two badges.
  //
  // This hook is the third poller mounted by `CoordNav`, and it shipped with a
  // bare `setInterval` while the other two were gated -- so a hidden console
  // tab went on billing two requests a minute (fleet health + resource
  // samples) forever. `CoordNav.test.tsx`'s visibility test asserts across the
  // WHOLE nav rather than per badge, which is what caught it; keep it that way,
  // because a per-badge assertion would have passed while this one polled.
  useVisiblePoll(fetchCountsTick, FLEET_ALARM_POLL_MS);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const devices = health?.devices;
    if (!devices) return ZERO;
    const admission = summarizeFleetAdmission(
      devices,
      samples?.latest ?? [],
      fetchedAtMs == null ? 0 : Math.max(0, (nowMs - fetchedAtMs) / 1000)
    );
    return {
      ...admission,
      unhealthy: devices.filter((d) => d.state && d.state !== "healthy").length,
    };
  }, [health, samples, fetchedAtMs, nowMs]);
}
