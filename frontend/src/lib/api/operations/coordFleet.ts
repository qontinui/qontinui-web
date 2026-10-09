/**
 * `/operations/fleet/*` — coord's fleet reads, and the wire shapes they serve.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5). Named `coordFleet`, not `fleet`, because `lib/api/fleet.ts` already
 * serves a different router (`/api/v1/fleet`).
 *
 * `GET /fleet/health` is coord's device liveness read
 * (`backend/app/api/v1/endpoints/operations/__init__.py` `get_fleet_health`, proxying coord's
 * `/coord/fleet/health`, `fleet_health.rs`). {@link fetchFleetHealth} is the
 * ONE reader of it in the web app: `useFleetHealth`, `useFleetAlarmBadge`,
 * the conditions runner hint and the spawn modal's device roster all call it,
 * so the URL and the request policy live in exactly one place (D3, Phase 6).
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

import type { CiHostingView } from "@/app/(app)/admin/coord/ci/_lib/hostedCiStatus";
import type {
  FleetPolicyView,
  FleetPolicyWriteResult,
} from "@/app/(app)/admin/coord/_shared/fleetPolicy";
import type { DeviceCredentialDark } from "@/components/operations/coordCredentialStatus";
import type { ResourceSamplesResponse } from "@/components/operations/fleetResources";
import type {
  AggregatedTaskRuns,
  FleetStatus,
} from "@/components/operations/types";
import type { WorktreeSlotsResponse } from "@/components/operations/useFleetWorktreeSlots";
import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

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

/**
 * `GET /fleet/health` (`operations/__init__.py` `get_fleet_health`) — parsed.
 *
 * Same-origin over {@link OPERATIONS_BASE} through `httpClient.fetch`, with
 * the init `httpClient.get` used to send (`{...options, method: "GET"}`, the
 * read declared `idempotent`). A non-2xx rejects through `readJson` with
 * `GET /api/v1/operations/fleet/health failed: <status> - <body>` — the shape
 * every caller already reads: `describeCoordPollError` and `httpStatusOf`
 * parse exactly that message. `options` carries the caller's retry budget —
 * the dashboard polls pass `COORD_DASHBOARD_POLL_OPTIONS` (one request; the
 * next tick is the retry).
 */
export async function fetchFleetHealth(
  options: HttpOptions = {}
): Promise<FleetHealthPayload> {
  const url = `${OPERATIONS_BASE}/fleet/health`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<FleetHealthPayload>(res, `GET ${url}`);
}

/**
 * `GET /fleet` (`operations/__init__.py` `get_fleet`) — the runner registry,
 * web-local rather than a coord proxy, so it keeps `httpClient`'s default
 * retries (`options` is the caller's, `{}` for the default).
 */
export async function fetchFleet(
  options: HttpOptions = {}
): Promise<FleetStatus> {
  const url = `${OPERATIONS_BASE}/fleet`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<FleetStatus>(res, `GET ${url}`);
}

/** `GET /fleet/tasks` — the in-process beacon's aggregated task runs. */
export async function fetchFleetTasks(
  options: HttpOptions = {}
): Promise<AggregatedTaskRuns> {
  const url = `${OPERATIONS_BASE}/fleet/tasks`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<AggregatedTaskRuns>(res, `GET ${url}`);
}

/**
 * `GET /fleet/runners/{runner_id}/output` body — the live tail of one task
 * run's output. A runner names its text `output` or `text`.
 */
export interface RunnerOutputResponse {
  output?: string;
  text?: string;
  [key: string]: unknown;
}

/** `GET /fleet/runners/{runner_id}/output?task_run_id=&tail_chars=`. */
export async function fetchRunnerOutput(
  runnerId: string,
  taskRunId: string,
  tailChars: number,
  options: HttpOptions = {}
): Promise<RunnerOutputResponse> {
  const url = `${OPERATIONS_BASE}/fleet/runners/${encodeURIComponent(runnerId)}/output?task_run_id=${encodeURIComponent(taskRunId)}&tail_chars=${tailChars}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<RunnerOutputResponse>(res, `GET ${url}`);
}

/**
 * `GET /fleet/drain` — which machines coord holds out of the fleet. Returned
 * UNPARSED: `parseFleetDrain` (`components/operations/fleetDrain.ts`) owns
 * what the body means, and a body it cannot read is UNKNOWN, not empty.
 */
export async function fetchFleetDrain(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/drain`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `POST /fleet/drain`. Resolves coord's body (`{changed}`), or `null` for a 2xx
 * whose body does not parse — the write landed either way. Never re-sent on a
 * 5xx (`idempotent: false`).
 */
export async function postFleetDrain(body: {
  device_id: string;
  until: string;
  reason: string;
}): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/drain`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /fleet/undrain` — same contract as {@link postFleetDrain}. */
export async function postFleetUndrain(body: {
  device_id: string;
  reason: string;
}): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/undrain`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `GET /fleet/dispatch-roles` — each machine's role, returned unparsed. */
export async function fetchFleetDispatchRoles(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/dispatch-roles`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/**
 * `PUT /fleet/dispatch-role`. Never auto-retried (`maxRetries: 0`): coord
 * answers a repeated PUT with `changed: false`, so a retry after a
 * lost-but-committed first attempt would report "nothing changed" for a change
 * the operator just made.
 */
export async function putFleetDispatchRole(
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/dispatch-role`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
    idempotent: false,
    maxRetries: 0,
  });
  return readJson<unknown>(res, `PUT ${url}`, { unparseable: "null" });
}

/**
 * `GET /fleet/resource-samples?window_secs=` — the per-device resource
 * sparklines. `windowSecs` is the sparkline window in seconds.
 */
export async function fetchFleetResourceSamples(
  windowSecs: number,
  options: HttpOptions = {}
): Promise<ResourceSamplesResponse> {
  const url = `${OPERATIONS_BASE}/fleet/resource-samples?window_secs=${encodeURIComponent(String(windowSecs))}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<ResourceSamplesResponse>(res, `GET ${url}`);
}

/** `GET /fleet/worktree-cap` — per-device worktree caps, returned unparsed. */
export async function fetchFleetWorktreeCap(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/worktree-cap`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `POST /fleet/worktree-cap` — set a cap. Never re-sent on a 5xx. */
export async function postFleetWorktreeCap(body: {
  device_id: string;
  max_worktrees: number;
  reason: string;
}): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/worktree-cap`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /fleet/worktree-cap/clear` — remove a cap. Never re-sent on a 5xx. */
export async function postFleetWorktreeCapClear(body: {
  device_id: string;
  reason: string;
}): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/worktree-cap/clear`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `GET /fleet/worktree-slots` — live worktree slot occupancy per device. */
export async function fetchFleetWorktreeSlots(
  options: HttpOptions = {}
): Promise<WorktreeSlotsResponse> {
  const url = `${OPERATIONS_BASE}/fleet/worktree-slots`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<WorktreeSlotsResponse>(res, `GET ${url}`);
}

/** `GET /fleet/ci-runners` — coord's mirror of the self-hosted CI runners, unparsed. */
export async function fetchCiRunnerMirror(
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/fleet/ci-runners`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /fleet-policy?domain=` — one fleet-policy dial's resolved view. */
export async function fetchFleetPolicy(
  domain: string,
  options: HttpOptions = {}
): Promise<FleetPolicyView> {
  const url = `${OPERATIONS_BASE}/fleet-policy?domain=${encodeURIComponent(domain)}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<FleetPolicyView>(res, `GET ${url}`);
}

/** The body of `PUT /fleet-policy`: one dial's level at one scope band. */
export interface FleetPolicyWriteRequest {
  domain: string;
  scope_band: "tenant" | "repo";
  scope_key: string | null;
  level: string;
  master_enabled: boolean;
  change_note: string;
}

/**
 * `PUT /fleet-policy` — write a dial level. A `PUT` is retried on a 5xx by
 * method (RFC 9110), and re-writing the same level is a no-op.
 */
export async function putFleetPolicy(
  body: FleetPolicyWriteRequest
): Promise<FleetPolicyWriteResult> {
  const url = `${OPERATIONS_BASE}/fleet-policy`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify(body),
    idempotent: true,
  });
  return readJson<FleetPolicyWriteResult>(res, `PUT ${url}`);
}

/** `GET /ci-hosting` — coord's hosted-CI status. */
export async function fetchCiHosting(
  options: HttpOptions = {}
): Promise<CiHostingView> {
  const url = `${OPERATIONS_BASE}/ci-hosting`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<CiHostingView>(res, `GET ${url}`);
}
