/**
 * coordCredential — "can this machine still reach coord?", as a device-row
 * status.
 *
 * Plan `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
 * **Phase 5** (`qontinui-web`, READ-ONLY: no route, no schema, no write path).
 *
 * ## The defect this closes
 *
 * A runner can boot with an expired, absent or unrefreshable coord device-JWT
 * and tell nobody. In the measured incident the box held 164 coord session rows
 * and 5 of them carried a `claudeCodeSessionId`; a device whose sessions are all
 * unbound is otherwise INVISIBLE in the fleet console, so its absence read as
 * "no sessions" rather than as "a machine that cannot reach us". Coord had been
 * raising a **critical** `runner_coord_credentials_missing:{device_id}` alert
 * per dark device the whole time — the count was on the page, the MACHINE was
 * not.
 *
 * ## What actually crosses the wire today (measured 2026-09-12)
 *
 * Three hops, and this module is honest about where each one stops:
 *
 * 1. **The runner publishes** `coord.device_status.details.coord_credential`
 *    on every heartbeat — `{ ok: boolean, reason?: string }`
 *    (`device_jwt_refresher.rs`, `CoordCredentialHealth`). A BOOLEAN. There is
 *    no posture, no `since`, no `exp` on that shape yet: the typed
 *    `CoordCredentialPosture` is Phase 1 of the same plan and lands in
 *    `qontinui-runner` separately.
 * 2. **Coord joins it** onto each device row of `GET /coord/fleet/health` as
 *    `credential_dark: { dark, reason? } | null`, with a body-level
 *    `credential_dark_scrape_up` saying whether the join RAN
 *    (`fleet_health.rs`, `DeviceCredentialDark`). `null` per device is coord's
 *    own UNKNOWN, deliberately not `{dark:false}` — **and `{dark:false}` is
 *    not a health measurement either**; see below.
 * 3. **This frontend discarded both**, because `FleetHealthDevice` declared
 *    neither field — the same way the alert rollup stayed invisible for months.
 *    Phase 5 declares them and renders them.
 *
 * So the posture vocabulary the plan names —
 * `live | expiring | expired | absent | unrefreshable | dark` — is the
 * RENDERING vocabulary here, and only two of its arms can be reached from
 * today's wire (`live`, `dark`). {@link resolveCoordCredential} reads a real
 * `posture` string when one is present in the heartbeat bag and never
 * synthesises one, so this surface starts reporting the finer postures the day
 * the runner half ships and not one deploy before.
 *
 * ## The one rule this module exists to hold
 *
 * **A missing verdict is UNKNOWN, never "healthy".** That is the whole plan in
 * one sentence: the incident is precisely a machine that looked fine because
 * nothing said otherwise. `unknown` therefore sits at R3's ignorance floor —
 * `attention: "waiting"`, painted {@link UNKNOWN_AMBER}, never calm and never
 * `live` (style guide §4.1, "amber also covers *we do not know*"; served policy
 * `verification-and-evidence` `silent-empty-is-unknown`).
 *
 * ### The way that rule was first got wrong, and what now holds it
 *
 * The first cut of this module read coord's `{dark: false}` as a measured
 * `live`. It is not one. `join_credential_dark` (`fleet_health.rs`) iterates
 * the device **roster** and stamps `dark: false` on every device the dark scan
 * did not NAME — and that scan is a single predicate,
 * `details #>> '{coord_credential,ok}' = 'false'`. A device is therefore
 * stamped `dark: false` when it published `ok: true`, when it published no
 * `coord_credential` key at all, when its `ok` is non-boolean, and when it has
 * no `coord.device_status` row whatsoever. Three of those four are the
 * incident's own population, and rendering them `credential live` on an
 * {@link INERT} badge was worse than the blank row it replaced: a blank row
 * makes no claim, and that badge made an affirmative one.
 *
 * So **coord's join can only ever conclude `dark`**. The affirmative half of
 * the question is answered one hop earlier, by the presence of the runner's
 * own `details.coord_credential` bag on the device-status row
 * ({@link CoordCredentialInput.reported}) — the same bag coord's SQL reads,
 * which reaches this frontend in full rather than as a boolean. Present and
 * affirmative ⇒ `live`; absent, unparseable, or carrying a non-boolean `ok`
 * ⇒ `unknown`, whatever coord's roster stamp says.
 */

import type { AttentionMap } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
// Imported from its pure home rather than the `./utils` shim, which is the
// route catalogue: this module fetches nothing and should not pull it in.
import { relativeTime } from "@/components/console/time";

/**
 * How old a runner's `coord_credential` report may be and still count as
 * evidence, when the report does not declare its own `stale_after_secs`.
 *
 * The runner owns this cadence and publishes the bound inside the bag
 * (`stale_after_secs`, the fleet-health `sample_stale_after_secs` pattern), so
 * a cadence change needs no web deploy. This constant is only the fallback for
 * runner builds that predate that field. It mirrors runner
 * `REFRESH_CHECK_INTERVAL` (300 s, `src-tauri/src/mcp/device_jwt_refresher.rs:85`)
 * × 3: the refresher publishes once per pass, and three passes tolerates one
 * skipped pass plus backoff jitter. It also matches `DeviceStatusTile`'s own
 * 15-minute `stale` line.
 */
export const COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS = 900;

/**
 * Coord's per-device credential join, verbatim from `DeviceCredentialDark`
 * (`crates/coord/src/fleet_health.rs`).
 *
 * Declared HERE, in the module that owns the vocabulary, and imported by the
 * two shapes that carry it (`FleetHealthDevice`, `CoordHealthJoin`) so the
 * wire contract has exactly one spelling.
 *
 * **Only the `true` arm carries information.** See {@link DeviceCredentialDark.dark}
 * and the module header: `dark: false` is "the scan did not name this device",
 * which is not the same claim as "this device is fine", and
 * {@link resolveCoordCredential} must never let the two render alike.
 */
export interface DeviceCredentialDark {
  /**
   * `true` = the runner published `coord_credential.ok == false` on its last
   * status heartbeat: it holds no usable coord device JWT. A MEASUREMENT, and
   * the one this object is good for.
   *
   * `false` = coord's roster stamp for "the dark scan ran and did not select
   * this device" (`join_credential_dark`, `fleet_health.rs`). The scan's
   * predicate is `details #>> '{coord_credential,ok}' = 'false'` and nothing
   * else, so this arm pools four unlike populations: published `ok: true`;
   * published no `coord_credential` at all; published a non-boolean `ok`; has
   * no `coord.device_status` row. **It is therefore NOT a health
   * measurement** and never resolves to `live` on its own.
   */
  dark: boolean;
  /** The runner's own short reason, verbatim. Absent when it published none. */
  reason?: string | null;
}

/**
 * The posture vocabulary, from the plan's DD1.
 *
 * `dark` is the plan's `dark(<cause>)` with the cause carried in
 * {@link CoordCredentialStatus.reason} rather than in the kind — a kind is a
 * palette key and must stay a closed set, and the runner's cause strings are
 * free text.
 *
 * `unknown` is NOT in the plan's list and is the most important member here:
 * the plan's list describes what a runner REPORTS, and this surface must also
 * render every device that reported nothing.
 */
export type CoordCredentialPosture =
  | "live"
  | "expiring"
  | "expired"
  | "absent"
  | "unrefreshable"
  | "dark"
  | "unknown";

/** Every posture, in escalation order. Ordering is for the rollup, not the UI. */
export const COORD_CREDENTIAL_POSTURES: readonly CoordCredentialPosture[] = [
  "live",
  "expiring",
  "expired",
  "absent",
  "unrefreshable",
  "dark",
  "unknown",
] as const;

/**
 * The audited kind→attention table (style guide §4.2 clause 1): one row per
 * posture, each with the reason it lands where it does.
 *
 * - `live` — **none.** Nothing is owed; the runner holds a usable JWT.
 * - `expiring` — **waiting.** The refresher's whole design is that it re-mints
 *   without the user (`try_device_self_refresh` → Cognito re-mint → the
 *   device-machine-key re-derive). An amber that clears itself is exactly what
 *   this is, and paging an operator for it is what teaches them to ignore red.
 * - `expired` — **author.** Sessions spawned on this box right now get coord's
 *   `token_expired` on their first `coord_*` call and latch `needs-auth` for
 *   their lifetime. Whatever automatic rung existed has already not fired.
 * - `absent` — **author.** A never-paired (or wiped) runner. No rung can heal
 *   it without a person.
 * - `unrefreshable` — **author.** The terminal state the plan is named after:
 *   every automatic rung has failed and the runner cannot get out by itself.
 * - `dark` — **author.** Today's wire arm, and the one coord already raises a
 *   *critical* alert for. Same standing as `expired` by construction: the
 *   runner publishes `ok:false` only when it is out of options.
 * - `unknown` — **waiting**, the IGNORANCE FLOOR. Never `none`. A device that
 *   reported nothing is the incident's own shape, and painting it calm is
 *   `silent-empty-is-unknown` with a badge attached.
 */
export const COORD_CREDENTIAL_ATTENTION_BY_POSTURE: AttentionMap<CoordCredentialPosture> =
  {
    live: "none",
    expiring: "waiting",
    expired: "author",
    absent: "author",
    unrefreshable: "author",
    dark: "author",
    unknown: "waiting",
  };

/**
 * The palette, keyed off the table above and built from the shared literals —
 * never hand-spelled (§4.1: nothing outside `console/statusRow.tsx` mints a red
 * or an amber, and `consoleSurfaces.test.ts` enforces it by source scan).
 */
export const COORD_CREDENTIAL_BADGE_CLASS: Record<
  CoordCredentialPosture,
  string
> = {
  live: INERT,
  expiring: WAITING_AMBER,
  expired: AUTHOR_RED,
  absent: AUTHOR_RED,
  unrefreshable: AUTHOR_RED,
  dark: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ `✕`, total over the author kinds (§4.1's glyph rule). */
export const COORD_CREDENTIAL_AUTHOR_GLYPH_KINDS: ReadonlySet<CoordCredentialPosture> =
  new Set<CoordCredentialPosture>([
    "expired",
    "absent",
    "unrefreshable",
    "dark",
  ]);

export const COORD_CREDENTIAL_PALETTE: StatusPalette<CoordCredentialPosture> = {
  badgeClass: COORD_CREDENTIAL_BADGE_CLASS,
  authorGlyphKinds: COORD_CREDENTIAL_AUTHOR_GLYPH_KINDS,
};

/** A device row's credential verdict, ready to render. */
export interface CoordCredentialStatus extends RowStatus<CoordCredentialPosture> {
  /**
   * ISO-8601 the posture has held since, when the reporter published one.
   *
   * An ISO-8601 STRING on the wire, per the contract on
   * {@link CoordCredentialInput.reported} — never unix seconds. `undefined`
   * until a runner carrying that contract heartbeats; today's shipped runners
   * publish `{ ok, reason? }` and no `since` at all.
   *
   * It is read rather than derived on purpose — a `since` this
   * surface computed from its own first sighting would be a claim about the
   * console's uptime dressed as a claim about the machine.
   */
  since?: string;
  /**
   * Did anything actually MEASURE this device's credential? `false` is the
   * `unknown` arm, and is what stops a caller treating a missing verdict as a
   * quiet pass.
   */
  measured: boolean;
}

/** What a device row can offer the resolver. Every field may be absent. */
export interface CoordCredentialInput {
  /**
   * Coord's own join off `GET /fleet/health` — `null`/`undefined` is UNKNOWN
   * (the join did not run, or this coord predates it), NOT "fine".
   */
  credentialDark?: DeviceCredentialDark | null;
  /**
   * The VERBATIM `details.coord_credential` bag from the device's last status
   * heartbeat (`DeviceStatus.details`), which reaches this frontend already —
   * `details` is an open JSON object and the runner writes this key into it.
   *
   * **This key's PRESENCE is the discriminator this module turns on**: it is
   * the only thing on the wire that separates a device that published
   * `ok: true` from one that published nothing, which coord's roster stamp
   * pools into a single `dark: false` (module header). Absent / non-object /
   * non-boolean `ok` ⇒ `unknown`, never `live`.
   *
   * Read as `unknown` and narrowed here because the runner, not this repo,
   * owns its shape. The agreed cross-repo contract, which the sibling
   * `qontinui-runner` PR implements:
   *
   * ```json
   * {
   *   "ok": true,
   *   "reason": null,
   *   "posture": "live",
   *   "since": "2026-09-12T03:54:26Z",
   *   "tenant_id": "…",
   *   "exp": 1789000000,
   *   "stale_after_secs": 900
   * }
   * ```
   *
   * `posture` (not `state`) is the kind; `since` is an ISO-8601 **string**,
   * not unix seconds; `ok` is `false` for every posture that is not
   * `live`/`expiring`, which is what keeps coord's existing dark scan
   * selecting those devices. `tenant_id` and `exp` are carried for the
   * operator's benefit on the producing side and are not read here — this
   * module renders a posture, not a credential's contents.
   * `stale_after_secs` is the runner's own statement of how long this report
   * stays evidence (`3 × REFRESH_CHECK_INTERVAL`); it is read here, and a bag
   * without a positive one falls back to
   * {@link COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS}. Today's shipped
   * runners publish the `{ ok, reason? }` prefix of that shape, which rung 3
   * of {@link resolveCoordCredential} still reads exactly.
   * `coordCredentialStatus.test.ts` pins the whole shape so a drift on either
   * side fails here rather than on the console.
   */
  reported?: unknown;
  /**
   * The device-status row's `updated_at` (ISO-8601) — the age of
   * {@link reported}. Coord's status upsert replaces `details` wholesale and
   * stamps `updated_at = now()` in the same write, so a row that still carries
   * a `coord_credential` bag was last written by the report that wrote it.
   *
   * **Absent or unparseable ⇒ the bag is treated as stale.** Every real row
   * carries one; a bag whose age cannot be established is not evidence.
   */
  reportedAt?: string;
  /** The clock, in epoch milliseconds. Defaults to `Date.now()`; injectable so
   *  a staleness decision renders deterministically under test. */
  now?: number;
}

/**
 * The runner's credential report off one device-status row, as the resolver's
 * two row-sourced inputs: the bag and its age. Spread straight into
 * {@link CoordCredentialInput}.
 */
export interface ReportedCoordCredential {
  /** The verbatim `details.coord_credential` bag, or `undefined`. */
  reported: unknown;
  /** The row's `updated_at`, or `undefined` when there is no row. */
  reportedAt: string | undefined;
}

/** Narrow an unknown to a plain object without asserting anything about it. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function isPosture(value: unknown): value is CoordCredentialPosture {
  return (
    typeof value === "string" &&
    (COORD_CREDENTIAL_POSTURES as readonly string[]).includes(value)
  );
}

/** Plain-language reason per posture, for the badge's `title`. */
const POSTURE_REASON: Record<CoordCredentialPosture, string> = {
  live: "The runner published a usable coord device JWT on its last heartbeat.",
  expiring:
    "The device JWT is near expiry. The runner refreshes itself — nobody has to act unless this stops clearing.",
  expired:
    "The device JWT has expired. Sessions spawned on this machine now reach coord with a dead credential and do not know it.",
  absent:
    "This runner holds no coord device JWT at all. It has never paired, or its store was cleared.",
  unrefreshable:
    "Every automatic refresh rung has failed. This runner cannot heal itself — it needs a person.",
  dark: "This runner reported that it holds no usable coord device JWT.",
  unknown:
    "No coord-credential verdict for this device. UNKNOWN, not healthy: its runner has never published one, this coord predates the field, or coord ran no join. Coord's dark scan not naming a device is not a measurement that its credential is fine.",
};

/**
 * Resolve one device row's credential posture from whatever the wire carried.
 *
 * Precedence, richest first — and every rung is a READ, never an inference:
 *
 * 1. A real `posture` string in the runner's heartbeat bag (Phase 1's shape).
 *    It is the only source that can carry `since`, and the only one that can
 *    distinguish `expired` from `unrefreshable`.
 * 2. Coord's `credential_dark` join, **`dark: true` only**. That arm is a
 *    measurement: coord's scan selected this device because its own report
 *    said `ok: false`. It outranks rung 3's boolean so a device that has gone
 *    dark cannot be talked back out of it by a staler bag.
 * 3. A boolean `ok` in the heartbeat bag. **This is the only rung that can
 *    conclude `live`**, because it is the only one that distinguishes
 *    "published `ok: true`" from "published nothing" — see the module header.
 * 4. **UNKNOWN.** Nothing measured this. Reached by every device coord
 *    stamped `dark: false` whose runner published no usable
 *    `coord_credential` bag, which before this rung existed was the fleet
 *    console's own version of the incident: an unmeasured machine wearing a
 *    calm `credential live` badge.
 *
 * **A bag older than its staleness bound is not evidence.** Rungs 1 and 3 read
 * the runner's bag, and a runner offline for days still has its last `ok: true`
 * sitting on its device-status row. So a bag whose `reportedAt` is further back
 * than its bound ({@link coordCredentialStaleAfterSecs}), or cannot be read, is
 * skipped by both. Rung 2 still applies: coord's `dark: true` is coord's own
 * measurement. The fallback then says how old the last report is, rather than
 * the no-report reason, so a machine that went quiet and one that never spoke
 * do not look alike. The decision lives here, not in the callers, so the
 * machine rows and the devops strip hold one rule.
 */
export function resolveCoordCredential(
  input: CoordCredentialInput
): CoordCredentialStatus {
  const bag = asRecord(input.reported);
  const now = input.now ?? Date.now();
  const staleAfterSecs = coordCredentialStaleAfterSecs(bag);
  const reportedAtMs =
    input.reportedAt === undefined ? NaN : Date.parse(input.reportedAt);
  const fresh =
    bag !== null &&
    Number.isFinite(reportedAtMs) &&
    now - reportedAtMs <= staleAfterSecs * 1_000;
  // Only a fresh bag is evidence; every rung below reads `reported`.
  const reported = fresh ? bag : null;
  const since = asString(reported?.since);
  const reportedReason =
    asString(reported?.reason) ?? asString(reported?.cause);

  // 1 — the typed posture, when a producer publishes one.
  if (reported && isPosture(reported.posture)) {
    const kind = reported.posture;
    return status(kind, reportedReason ?? POSTURE_REASON[kind], since, true);
  }

  // 2 — coord's join, affirmative arm only. `dark: false` is deliberately
  // NOT handled here: it is a roster stamp, not a verdict, and falling
  // through to rung 3 is what keeps an unmeasured device out of `live`.
  const dark = input.credentialDark;
  if (dark?.dark === true) {
    return status(
      "dark",
      asString(dark.reason) ?? reportedReason ?? POSTURE_REASON.dark,
      since,
      true
    );
  }

  // 3 — the runner's own boolean, straight off the heartbeat bag.
  if (reported && typeof reported.ok === "boolean") {
    const kind: CoordCredentialPosture = reported.ok ? "live" : "dark";
    return status(kind, reportedReason ?? POSTURE_REASON[kind], since, true);
  }

  // 4 — nothing measured this. A bag that is present but past its bound says
  // so, naming its age: the machine did report, just not recently enough.
  if (bag !== null && !fresh) {
    return status(
      "unknown",
      staleReportReason(input.reportedAt, staleAfterSecs, now),
      undefined,
      false
    );
  }
  return status("unknown", POSTURE_REASON.unknown, undefined, false);
}

/**
 * How many seconds a `coord_credential` bag stays evidence: the runner's own
 * `stale_after_secs` when it is a positive finite number, else
 * {@link COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS}.
 */
export function coordCredentialStaleAfterSecs(
  bag: Record<string, unknown> | null
): number {
  const declared = bag?.stale_after_secs;
  return typeof declared === "number" &&
    Number.isFinite(declared) &&
    declared > 0
    ? declared
    : COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS;
}

function staleReportReason(
  reportedAt: string | undefined,
  staleAfterSecs: number,
  now: number
): string {
  const age = relativeTime(reportedAt, { absent: "", now });
  // Only a MEASURED age may be said to be past the bound; an unreadable
  // timestamp establishes no age at all.
  const heard =
    age === ""
      ? "This runner's last credential report carries no usable timestamp, " +
        "so its age cannot be established"
      : `This runner's last credential report was ${age}, past its ` +
        `${staleAfterSecs}s staleness bound`;
  return (
    `${heard}, so it is not evidence of this machine's credential now. ` +
    "UNKNOWN, not healthy: the runner may be offline, or something else " +
    "overwrote its status since."
  );
}

function status(
  kind: CoordCredentialPosture,
  reason: string,
  since: string | undefined,
  measured: boolean
): CoordCredentialStatus {
  return {
    kind,
    label: `credential ${kind}`,
    reason,
    attention: COORD_CREDENTIAL_ATTENTION_BY_POSTURE[kind],
    since,
    measured,
  };
}

/**
 * The fleet-wide rollup the health strip opens with (R1: derived from data
 * already on the page, never a second fetch).
 *
 * `needsAction` counts the devices whose posture is an `author` kind — the
 * machines an operator must go and fix. `unknown` counts the devices nothing
 * measured, and is reported SEPARATELY rather than folded into either side,
 * for the same reason the page already renders `alerts unknown` instead of
 * `0`: a signal that has gone dark and a genuine all-clear must not look alike.
 */
export interface CoordCredentialRollup {
  /** Devices considered. */
  total: number;
  /** Devices whose posture demands a person (`expired`/`absent`/…/`dark`). */
  needsAction: number;
  /**
   * Devices with a measured, healthy-or-self-clearing posture.
   *
   * A device is only counted here when something affirmatively measured it —
   * in practice, its runner's own `coord_credential` bag on the device-status
   * row, since coord's join can conclude only `dark`.
   */
  ok: number;
  /** Devices nothing measured. Never counted as `ok`. */
  unknown: number;
  /**
   * Coord's own `credential_dark_scrape_up`, passed straight through.
   *
   * `false` = coord told us the join did not run this tick, so every
   * `unknown` below is coord's failure rather than a per-device fact.
   * `undefined` = a coord that serves no such flag; that is not `false`, and
   * the strip must not report a failure nobody claimed.
   */
  scrapeUp?: boolean;
}

/**
 * The key a coord fleet-health device joins the device-status stream under.
 *
 * `useDeviceStatusStream` keys its map `hostname ?? device_id`, and
 * `FleetOverview` groups coord's devices onto machine rows by the same
 * expression. Spelled ONCE, here, so the stream, the strip's rollup and the
 * rows all resolve a device's heartbeat bag through one join key.
 */
export function coordDeviceHostKey(device: {
  device_id: string;
  hostname?: string | null;
}): string {
  return device.hostname ?? device.device_id;
}

/**
 * The runner's own `details.coord_credential` bag off one device-status row,
 * verbatim, together with that row's `updated_at` — the
 * {@link CoordCredentialInput.reported} and
 * {@link CoordCredentialInput.reportedAt} inputs, returned as one value so no
 * caller can pass the bag without its age. `reported` is `undefined` when
 * there is no row, the row's `details` is not an object, or the runner
 * published no such key. Shared by `MachineCard` and
 * {@link summarizeCoordCredentials}, for the same reason as
 * {@link coordDeviceHostKey}.
 */
export function reportedCoordCredential(
  row: { details?: unknown; updated_at: string } | undefined
): ReportedCoordCredential {
  return {
    reported: asRecord(row?.details)?.coord_credential,
    reportedAt: row?.updated_at,
  };
}

const NO_REPORT: ReportedCoordCredential = {
  reported: undefined,
  reportedAt: undefined,
};

/**
 * {@link reportedCoordCredential}, but only when the device-status row belongs
 * to THIS coord device.
 *
 * The stream is keyed by hostname, and two coord devices can share one — a
 * re-paired box that came back with a new `device_id`. The map holds ONE row
 * per hostname — the newest by `updated_at` (`deviceStatusRows.ts`; coord
 * serves newest-first) — so without this guard both devices would resolve
 * against that one runner's report, and the retired device would borrow a
 * `live` only its replacement published. A row whose `device_id` differs is treated as
 * no report at all, which lands that device on `unknown` unless coord named it
 * dark.
 */
export function reportedCoordCredentialFor(
  deviceId: string,
  row: { device_id: string; details?: unknown; updated_at: string } | undefined
): ReportedCoordCredential {
  return row?.device_id === deviceId ? reportedCoordCredential(row) : NO_REPORT;
}

/**
 * Roll a device list up for the strip.
 *
 * Takes the RAW fleet-health rows AND the device-status stream's `byHostname`
 * map — the one subscription the page owns and hands to `FleetOverview` — and
 * resolves each device from both sources, exactly as its machine row does:
 * coord's `credential_dark` join, plus the runner's own `coord_credential` bag
 * found under {@link coordDeviceHostKey}. So the strip and the rows agree for
 * every device they both key the same way: a device whose runner published
 * `ok: true` counts as `ok` here and reads `live` on its row.
 *
 * Two coord devices that share a hostname (a re-paired box with a new
 * `device_id`) are each counted, and each reads the stream row under that
 * hostname only if the row's `device_id` is its own
 * ({@link reportedCoordCredentialFor}) — so neither borrows the other's
 * report. One gap remains, named rather than hidden: `FleetOverview` folds
 * such devices onto ONE machine row (last writer wins), so the strip counts
 * two devices where the list shows one row.
 *
 * The rules this holds:
 *
 * * `needsAction` is exact — every `author` posture, from either source.
 * * `unknown` is "nothing measured this device": coord did not name it dark
 *   AND its runner published no usable bag (or has no device-status row at
 *   all). It is never folded into `ok`. Coord's `dark: false` alone still
 *   lands here, because it is a roster stamp rather than a verdict (module
 *   header) — under-claiming stays the fallback wherever no bag is present.
 * * A report past its staleness bound counts as `unknown`, never `ok` — the
 *   resolver's rule, so the strip and the rows cannot disagree about it.
 * * `total` is coord's device roster. A device-status-only host with no coord
 *   device record gets a row but is not counted: this strip reports on the
 *   machines coord knows.
 */
export function summarizeCoordCredentials(
  devices: ReadonlyArray<{
    device_id: string;
    hostname?: string | null;
    credential_dark?: DeviceCredentialDark | null;
  }>,
  deviceStatusByHostname: ReadonlyMap<
    string,
    { device_id: string; details?: unknown; updated_at: string }
  >,
  scrapeUp?: boolean,
  now?: number
): CoordCredentialRollup {
  let needsAction = 0;
  let ok = 0;
  let unknown = 0;
  for (const device of devices) {
    const resolved = resolveCoordCredential({
      credentialDark: device.credential_dark,
      ...reportedCoordCredentialFor(
        device.device_id,
        deviceStatusByHostname.get(coordDeviceHostKey(device))
      ),
      now,
    });
    if (!resolved.measured) unknown += 1;
    else if (resolved.attention === "author") needsAction += 1;
    else ok += 1;
  }
  return { total: devices.length, needsAction, ok, unknown, scrapeUp };
}
