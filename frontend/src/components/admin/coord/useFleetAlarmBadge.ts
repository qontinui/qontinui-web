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
 *
 * ## Retaining is only HALF the rule, and this hook shipped the silent half
 *
 * R6's stale arm is *"those numbers are real and still actionable, so they keep
 * rendering **and the detail line says they are old**"*. The paragraph above
 * argues the first clause and stops; the counts then rendered with no
 * qualification at all, identical to ones a poll had just confirmed. That is
 * the same defect #1206 fixed on the Notifications tab badge, one badge over —
 * and the audit that found it counted its consumers inside the notifications
 * ROUTE, so the third poller `CoordNav` mounts was outside the sweep again.
 *
 * It is worse here than there, because of the zero. This trigger's design is
 * that an all-clear renders NOTHING; so a last-good all-clear whose next poll
 * fails renders nothing too, and the surface states an unverifiable all-clear
 * in the loudest medium there is — silence — on the one badge whose docstring
 * two paragraphs up exists to stop exactly that. The renderer therefore keeps a
 * marker for a retained zero it can no longer vouch for.
 *
 * ## Two axes, because the two reads fail independently
 *
 * `unhealthy` is coord's health read alone. The four admission counts are
 * `summarizeFleetAdmission(devices, samples, age)` — BOTH reads. So a samples
 * read that fails beside a health read that succeeded leaves four counts
 * uncurrent and one perfectly fresh, and a single flag across them would either
 * under-claim on four or over-claim on one. Each axis answers for itself, the
 * same split `useAlertsBadge` makes between its count and its critical accent.
 *
 * `hasRead` is the health axis: `devices` is the spine, and with no device list
 * there is no retained fact for any of the five counts to qualify.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
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
 * The counts, plus the honest answer to "did the latest reads produce them?".
 *
 * Two staleness flags rather than one, because the two reads behind the counts
 * fail independently and the counts do not all depend on both — see the
 * module header. A renderer that collapses them re-introduces the over-claim
 * on whichever axis is currently fresh.
 */
export interface FleetAlarm {
  counts: FleetAlarmBadge;
  /**
   * Has coord's health read — the spine — ever delivered? False means there is
   * no retained fact here at all, and the trigger renders nothing rather than
   * qualifying a zero it never read.
   */
  hasRead: boolean;
  /**
   * The most recent health read did not replace the device list. Qualifies
   * `unhealthy`, and (with `samplesStale`) the four admission counts.
   */
  healthStale: boolean;
  /**
   * The most recent resource-sample read did not replace the lane rows.
   * Qualifies the four admission counts only — `unhealthy` never reads them.
   */
  samplesStale: boolean;
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

/**
 * Did this 2xx actually carry a roster / a lane list?
 *
 * Both fields are OPTIONAL on their declared types, so an answer without one is
 * a modelled state rather than a hypothesis — a coord build that predates the
 * field, or the mid-request degrade the `/fleet/health` route's own OpenAPI
 * contract documents ("no freshness overlay, no alert rollup this tick", still
 * a 200).
 *
 * **A response that carried no list is a read that refreshed nothing**, and it
 * must settle as a NON-delivery rather than as an empty one. The difference is
 * not academic on the health axis: `counts` collapses to `ZERO` on a missing
 * device list, and `ZERO` renders as SILENCE, which is this trigger's all-clear.
 * So treating the absence as data would turn a degraded coord into a
 * confident, unqualified "the fleet is fine" — the same
 * `[policy: silent-empty-is-unknown]` false-safe the `unknown` count exists to
 * prevent, entered through the envelope instead of through the roster. The
 * notifications badge draws this exact line on its own scalar.
 *
 * An EMPTY list is a delivery, and deliberately so: `devices: []` is a real
 * answer ("no machines"), and `latest: []` is the telemetry-gone-dark case the
 * `unknown` count is built to render. Only the absent key is unknown.
 */
function deliveredDevices(body: FleetHealthPayload): boolean {
  return Array.isArray(body?.devices);
}

function deliveredSamples(body: ResourceSamplesResponse): boolean {
  return Array.isArray(body?.latest);
}

export function useFleetAlarmBadge(): FleetAlarm {
  const healthAxis = useRetainedValue<FleetHealthPayload | null>(null);
  const samplesAxis = useRetainedValue<ResourceSamplesResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cancelled = useRef(false);
  const { issue: issueHealth, settle: settleHealth } = healthAxis;
  const { issue: issueSamples, settle: settleSamples } = samplesAxis;

  const fetchCounts = useCallback(async () => {
    // One ticket per axis, taken together before either read goes out. They
    // stay in lockstep because every poll settles both exactly once — six
    // branches, six settles, no early return past the unmount guard — and each
    // axis only ever compares against its own sequence.
    //
    // ⚠️ Which makes CROSS-WIRING the hazard, not divergence: `settleSamples`
    // is correct only while it is handed `samplesSeq`. Keep each `settle*` on
    // its own `*Seq`, the same rule `useAlertsBadge` carries.
    const healthSeq = issueHealth();
    const samplesSeq = issueSamples();
    // Settled, not `all`: the two reads fail independently, and the health
    // list is the spine — a machine that publishes no sample still has to be
    // counted, so losing the samples read must not lose the machines too.
    const [healthRes, samplesRes] = await Promise.allSettled([
      httpClient.get<FleetHealthPayload>(FLEET_HEALTH_API),
      httpClient.get<ResourceSamplesResponse>(
        `${FLEET_RESOURCE_SAMPLES_API}?window_secs=${DEFAULT_WINDOW_SECS}`
      ),
    ]);
    // Unmounting, so nothing renders these tickets' answers. Leaving both
    // sequences unsettled is the point: settling would set state on a dead
    // component, and the gap in the numbering can never be observed.
    if (cancelled.current) return;
    if (healthRes.status === "fulfilled") {
      if (deliveredDevices(healthRes.value)) {
        settleHealth(healthSeq, { value: healthRes.value });
      } else {
        log.warn("fleet health badge answered with no device roster");
        settleHealth(healthSeq, null);
      }
    } else {
      log.warn("fleet health badge fetch failed", healthRes.reason);
      settleHealth(healthSeq, null);
    }
    if (samplesRes.status === "fulfilled" && !deliveredSamples(samplesRes.value)) {
      log.warn("fleet resource-sample badge answered with no lane rows");
      settleSamples(samplesSeq, null);
    } else if (samplesRes.status === "fulfilled") {
      const applied = settleSamples(samplesSeq, { value: samplesRes.value });
      // Stamped ONLY on success, for the same reason
      // `useFleetResourceSamples` does it: a failed poll must not reset the
      // clock the staleness rule reads, or an outage would keep every lane
      // looking fresh.
      //
      // …and only alongside the samples it describes. A superseded reply the
      // axis DECLINED must not restamp the clock either, or the age would
      // describe a fetch whose rows were thrown away, and lanes an even newer
      // read had already aged into `stale` would spring back to fresh.
      if (applied) setFetchedAtMs(Date.now());
    } else {
      log.warn("fleet resource-sample badge fetch failed", samplesRes.reason);
      settleSamples(samplesSeq, null);
    }
  }, [issueHealth, issueSamples, settleHealth, settleSamples]);

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

  const health = healthAxis.value;
  const samples = samplesAxis.value;
  const counts = useMemo(() => {
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

  return {
    counts,
    // The HEALTH axis, not either-of-two. `hasRead` gates whether there is a
    // retained fact to qualify, and `ZERO` above is returned on a missing
    // device list regardless of what the samples read did — so a samples
    // delivery with no health behind it is not a fact this trigger holds.
    hasRead: healthAxis.hasRead,
    healthStale: healthAxis.stale,
    samplesStale: samplesAxis.stale,
  };
}
