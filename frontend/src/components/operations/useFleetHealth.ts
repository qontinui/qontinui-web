"use client";

/**
 * `GET /api/v1/operations/fleet/health` — coord's device liveness read, and
 * the wire shapes it serves.
 *
 * Lifted out of `admin/coord/fleet/page.tsx` (where it was a page-local
 * `useFleetHealth`) by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1: the Dev Ops
 * Overview is the surface that OWNS this read now, and a hook declared inside
 * one page cannot be imported by another. Phase 4 then removed the pipeline
 * page's own call entirely — that page makes zero requests to this route —
 * leaving two callers: `/admin/coord/devops` at the 10 s foreground cadence
 * below, and `CoordNav`'s `useFleetAlarmBadge`, which reads the same URL on
 * the 60 s nav cadence for the `Dev Ops ▾` alarm.
 *
 * The devices this returns are the SPINE of every fleet surface built on it:
 * a device that reports health but publishes no resource sample, and a device
 * that appears in no runner inventory, must both still render — as `unknown`,
 * never as absent and never as healthy (`[policy: silent-empty-is-unknown]`).
 *
 * The same body also carries coord's `conditions` rollup — which open
 * conditions no agent is handling, what is waiting on the operator, and which
 * deliberate settings are in effect — see `FleetHealthConditions`. It is
 * declared here because every field this type omits is silently discarded,
 * which is how an earlier rollup on this same body (the alert severity counts)
 * stayed invisible on `/admin/coord/devops` while coord published it on every
 * poll. Coord still serves those severity counts (`alerts`,
 * `alerts_scrape_up`) for API consumers; this type no longer declares them
 * because nothing in the web app reads them since the Conditions panel
 * replaced the severity badges (plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8).
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import type { DeviceCredentialDark } from "./coordCredentialStatus";

/**
 * A SAME-ORIGIN literal, deliberately, and not `OPERATIONS_API` from
 * `./utils` (which prefixes `ApiConfig.API_BASE_URL`). This is the exact
 * string the pipeline page used to poll; the lift was a move, not a
 * behaviour change, and the console has both conventions in it today
 * (`CoordNav`'s notifications badge is a literal too). Reconcile
 * them deliberately, in a change that is about that — not as a side effect of
 * moving a hook between files.
 */
export const FLEET_HEALTH_API = "/api/v1/operations/fleet/health";

/**
 * Poll cadence. Coord's device prober runs far slower than this; 10 s is the
 * foreground cadence for a page whose whole job is machine liveness.
 */
export const FLEET_HEALTH_POLL_MS = 10_000;

export interface FleetHealthDevice {
  device_id: string;
  hostname?: string;
  /**
   * Coord liveness state — `DeviceHealthSnapshot.state` (Rust
   * `DeviceState`, serde-lowercase): healthy | degraded | **stale** |
   * partitioned | abandoned. Absent on a device coord has no verdict for,
   * which renders as `unknown` — never as healthy.
   *
   * `stale` is the fifth and newest, a DERIVED overlay coord never persists
   * (its `devices.state` CHECK admits only the other four). It means the
   * device is heartbeating fine and its resource SAMPLER has gone quiet, so
   * it is neither healthy nor unreachable — see `summarizeFleetLiveness` and
   * `deviceStateBadgeVariant`, which are the two places this string is turned
   * into something an operator reads.
   *
   * Typed as a bare `string` deliberately: a union here would make a coord
   * newer than this build fail to parse instead of rendering `unknown`, and
   * unknown-not-healthy is the rule the whole surface rests on.
   */
  state?: string;
  /**
   * The device's PERSISTED heartbeat state, before the freshness overlay —
   * `DeviceHealthSnapshot.heartbeat_state`, the same serde-lowercase
   * `DeviceState` vocabulary as `state` minus `stale`, which is never
   * persisted.
   *
   * It exists so the overlay **loses nothing**. `state` is the VERDICT and
   * may read `stale`; this is what coord's heartbeat ladder actually holds,
   * so a reader can still see that a `stale` machine is otherwise `healthy`.
   * That difference is operational, not cosmetic: `stale` means coord hears
   * the machine and has stopped hearing its telemetry, so the box is
   * reachable and perfectly usable, while `partitioned` means it stopped
   * answering at all. Rendering `state` alone paints those the same.
   *
   * Absent on a coord predating the axis (plan
   * `2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`
   * Phase 4, coord `b00558b5`). Absent is UNKNOWN — do not fall back to
   * `state`, which would manufacture agreement the wire never claimed.
   */
  heartbeat_state?: string;
  /**
   * **Can this machine still reach coord?** — coord's join of the runner's own
   * `coord.device_status.details.coord_credential` onto the device row
   * (`fleet_health.rs`, `DeviceCredentialDark`).
   *
   * Declared here by plan
   * `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
   * Phase 5, and the declaration IS the fix on this side: coord has been
   * serving this field, and raising a **critical**
   * `runner_coord_credentials_missing:{device_id}` alert from the same scan,
   * while every byte of it was discarded here by a type that did not mention
   * it — the identical omission that kept the alert rollup invisible one field
   * up.
   *
   * Three distinct states, and the middle one is the point:
   *
   * * `{dark: true, reason?}` — this runner reported that it holds no usable
   *   coord device JWT. Every session it spawns works without coord.
   * * `{dark: false}` — the scan RAN and this device was not in its result
   *   set. A measurement.
   * * `null` / absent — coord's join did not run (body-level
   *   `credential_dark_scrape_up: false`), the snapshot came from the watcher
   *   path that does no such join, or this coord predates the field.
   *   **UNKNOWN, never healthy** — see `coordCredentialStatus.ts`, which is the one
   *   place that turns this into something an operator reads.
   */
  credential_dark?: DeviceCredentialDark | null;
  /**
   * Coord's raw CI-runner measurement (`idle` | `busy` | `offline`).
   *
   * Coord serves it as a STRING only for a device carrying the `ci_runner`
   * capability and as `null` for every other device (`fleet_health.rs`
   * `DeviceHealthSnapshot::ci_runner_status`), so `typeof === "string"` is the
   * capability test — see {@link isCiRunnerDevice}. Absent means this coord
   * predates the field: UNKNOWN, and treated as "not known to be a CI runner".
   */
  ci_runner_status?: string | null;
  /**
   * Is this device inside coord's dispatch/liveness window right now —
   * probe-reachable, or heartbeated within `COORD_DEVICE_HEARTBEAT_TTL_SECS`
   * (`fleet_health.rs` `DeviceHealthSnapshot::within_dispatch_window`). Coord
   * LISTS devices outside the window rather than dropping them, so `false` is
   * "listed, but do not expect this machine to answer".
   *
   * Absent on a coord predating the field: UNKNOWN, never "offline" and never
   * "online". Read by the Regression Tests runner hint
   * (`app/(app)/conditions/_hooks/runnerAvailability.ts`).
   */
  within_dispatch_window?: boolean;
  /**
   * **Is this runner wedged right now, and has it been?** — the runner's own
   * in-process wedge detector, reported outward on its device-status bag and
   * served by coord (plan
   * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
   * Phase 5, perceive gap G2). Newest first, bounded by coord.
   *
   * `[]` is a MEASUREMENT (the runner looked and found none). `null` is not:
   * `runner_reports.wedge_incidents.absent_reason` says why nothing was
   * served, and `runnerReportStatus.ts` is the one place that turns either
   * into operator words. Absent entirely = a coord predating Phase 5, which
   * is UNKNOWN too.
   */
  wedge_incidents?: RunnerWedgeIncident[] | null;
  /**
   * **Which fleet mechanisms work on this machine?** — the capability
   * doctor's per-mechanism verdicts, reported by the runner (Phase 5, G4).
   * Same presence rules as {@link wedge_incidents}.
   */
  capability?: RunnerCapabilityRecord[] | null;
  /**
   * Provenance of the two runner reports above — why a value is `null`, when
   * coord last received each, and whether that is still recent enough to be
   * evidence. `null` when coord's runner-report read failed (body-level
   * `runner_reports_scrape_up: false`) or the snapshot came from a path that
   * does not join it.
   */
  runner_reports?: RunnerReportsMeta | null;
}

/**
 * One wedge incident — coord's `runner_reports::WedgeIncident`.
 *
 * `ended_at: null` is an OPEN incident: the runner's detector has not read
 * clear again, and coord never guesses an end.
 */
export interface RunnerWedgeIncident {
  /** The runner's reason token, e.g. `backend_wedged`, `ui_thread_wedged`. */
  kind: string;
  began_at: string;
  ended_at: string | null;
  /** How the runner decided it ended (`cleared`, `process_exited`, …). */
  ended_by?: string | null;
  /** The runner build that observed it, when published. */
  build_id?: string | null;
}

/**
 * One mechanism's verdict — coord's `runner_reports::CapabilityEntry`.
 *
 * `state` is typed `string`, not the four-member union, so a state newer than
 * this build still renders (as unknown) instead of failing to parse.
 */
export interface RunnerCapabilityRecord {
  mechanism: string;
  /** OPERATIVE | DEGRADED | INOPERATIVE-ON-THIS-MACHINE | UNKNOWN. */
  state: string;
  reason?: string | null;
  written_at?: string | null;
  /**
   * Present ONLY when coord overrode the runner's state to `UNKNOWN` (the
   * record or the whole report aged out) — the runner's last verdict, kept so
   * it is never lost, only no longer asserted.
   */
  reported_state?: string;
}

/** Why coord served a runner report as `null` — `runner_reports::ReportAbsence`. */
export type RunnerReportAbsence =
  | "build_nameable_key_absent"
  | "no_publisher"
  | "malformed"
  | "publisher_error";

/** One runner report's provenance — coord's `runner_reports::ReportMeta`. */
export interface RunnerReportMeta {
  /**
   * Set exactly when the served value is `null` — one of
   * {@link RunnerReportAbsence}. Typed `string` so a reason newer than this
   * build is shown verbatim rather than failing to parse.
   */
  absent_reason: string | null;
  /** When coord last received the key; `null` when absent or unstamped. */
  received_at: string | null;
  /** `true` = not re-received within `stale_after_secs`, or age unknown. */
  stale: boolean | null;
  dropped_entries: number;
  omitted_by_runner?: number;
  /** The runner's own `*_error` message, with `publisher_error`. */
  error?: string | null;
}

/** `devices[].runner_reports` — coord's `runner_reports::RunnerReportsMeta`. */
export interface RunnerReportsMeta {
  wedge_incidents: RunnerReportMeta;
  capability: RunnerReportMeta;
  stale_after_secs: number;
}

/**
 * `build_resolvability` on the fleet-health body: the share of the roster's
 * devices whose running build coord can NAME (Phase 5, the fleet-services
 * "build resolvability" metric). `value` is `null` over an empty roster —
 * 0/0 is not a share — and the whole block is `null` when coord's
 * runner-report read failed.
 */
export interface FleetBuildResolvability {
  value: number | null;
  coverage_n: number;
  population_n: number;
  basis: string;
}

/**
 * Whether coord says this device carries the `ci_runner` capability. Read off
 * coord's own device read rather than the CI-runner mirror, so a mirror poll
 * that is loading or has failed cannot reclassify the machine.
 */
export function isCiRunnerDevice(device: FleetHealthDevice): boolean {
  return typeof device.ci_runner_status === "string";
}

/**
 * The agent domain that owns an unclaimed condition — coord's closed
 * `AgentDomain` enum (plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work` D1).
 * Listed for readers; the map below is keyed by `string` deliberately, so a
 * domain newer than this build still renders instead of being dropped.
 */
export type FleetConditionsDomain =
  | "merge_train"
  | "dev_ops"
  | "cleanup"
  | "return_to_main"
  | "pr_fix"
  | "red_main_fix"
  | "gate_owner"
  | "plan_owner";

/** One deliberate operator setting coord is reflecting back (D1 `Responder::Setting`). */
export interface FleetHealthSettingInEffect {
  /** The `coord.alerts.id` of the row reflecting the setting — its identity. */
  alert_id?: number | null;
  /** Coord's alert kind, e.g. `kill_switch_fired`, `fleet_device_drained`. */
  kind: string;
  /** When the setting took effect (ISO). */
  since?: string | null;
  /** Coord's own one-line description of the row. */
  summary?: string | null;
}

/**
 * **Is anything degraded that no agent is handling?** — coord's `conditions`
 * block on `/coord/fleet/health` (plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 7), computed in the same visibility scope as `/coord/alerts`.
 *
 * Every count is `number | null`: `null` is coord saying it could not measure
 * that number, and **renders UNKNOWN, never `0`**. `scrape_up: false` means
 * the whole query failed and every count is `null`.
 *
 * The block itself is OPTIONAL: a coord predating Phase 7 serves none, and
 * that is "coord does not report conditions yet", never "nothing unhandled".
 * `fleetConditions.ts` is the one place this turns into operator-facing words.
 */
export interface FleetHealthConditions {
  open?: number | null;
  claimed?: number | null;
  unclaimed?: number | null;
  unclaimed_oldest_age_secs?: number | null;
  /** Keyed by {@link FleetConditionsDomain} — typed `string` so a new domain is not dropped. */
  unclaimed_by_domain?: Record<string, number | null> | null;
  /** OPEN operator-audience questions in the caller's tenant (exact count). */
  awaiting_operator?: number | null;
  /** Their ids, oldest first, CAPPED by coord — `awaiting_operator` is exact. */
  awaiting_operator_question_ids?: string[] | null;
  /**
   * Open `Responder::Operator` alerts in scope. NOT comparable with
   * `awaiting_operator` by subtraction: an answered alert that has not yet
   * cleared is never re-asked, so it is an open alert with no open question
   * for an ordinary reason. Read the two exact counts below instead; this is
   * the fallback for a coord that does not serve them.
   */
  awaiting_operator_alerts?: number | null;
  /** Open operator alerts with NO question at all (exact). Absent on an older coord. */
  awaiting_operator_unasked?: number | null;
  /**
   * Open operator alerts whose question was ANSWERED, and which coord has not
   * yet re-observed clear (exact). Absent on an older coord.
   */
  awaiting_operator_answered_uncleared?: number | null;
  /** Oldest first, CAPPED by coord — see `settings_in_effect_count`. */
  settings_in_effect?: FleetHealthSettingInEffect[] | null;
  /** The exact number of settings in effect, beside the capped list. */
  settings_in_effect_count?: number | null;
  scrape_up?: boolean;
  /** With `scrape_up: false`: which read failed (e.g. `agent_work`). */
  unavailable_reason?: string | null;
}

export interface FleetHealthPayload {
  devices?: FleetHealthDevice[];
  /**
   * The Conditions rollup. Absent on a coord predating it — see
   * {@link FleetHealthConditions}.
   */
  conditions?: FleetHealthConditions;
  /**
   * Coord's verdict on whether the per-device `credential_dark` join actually
   * RAN this tick (`fleet_health.rs`: `credential_dark_scrape_up`).
   *
   * `false` means every `credential_dark: null` beside it is coord's read
   * failing, not a property of any machine — render UNKNOWN, never healthy
   * (`[policy: silent-empty-is-unknown]`). `undefined` is a coord that serves
   * no such flag and is **not** `false` — a surface that read it as failure
   * would report an outage nobody claimed.
   */
  credential_dark_scrape_up?: boolean;
  /**
   * Did coord's per-device runner-report read (`wedge_incidents`,
   * `capability`, `runner_reports`, and `build_resolvability`) RUN this tick?
   * `false` = every one of those is `null` because the read failed, not
   * because any runner said so. `undefined` = a coord predating Phase 5.
   */
  runner_reports_scrape_up?: boolean;
  /** See {@link FleetBuildResolvability}. Absent on a coord predating it. */
  build_resolvability?: FleetBuildResolvability | null;
}

export interface UseFleetHealthResult {
  data: FleetHealthPayload | null;
  loading: boolean;
  /**
   * Transport failure. `data` is deliberately NOT cleared: a failed read is
   * evidence about the network, not about the fleet, and emptying the list
   * would assert "no machines" on no evidence.
   */
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFleetHealth(): UseFleetHealthResult {
  const [data, setData] = useState<FleetHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5): a
  // coord-proxied poll that fails is retried by its next tick, never by
  // `httpClient`'s 5xx backoff chain, and never overlaps itself.
  const poll = useCallback(async (isCurrent: () => boolean) => {
    try {
      const body = await httpClient.get<FleetHealthPayload>(
        FLEET_HEALTH_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      setData(body);
      setError(null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(describeCoordPollError(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_HEALTH_POLL_MS);

  return { data, loading, error, refresh };
}
