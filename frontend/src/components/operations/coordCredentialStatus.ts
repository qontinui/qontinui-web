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
   *   "exp": 1789000000
   * }
   * ```
   *
   * `posture` (not `state`) is the kind; `since` is an ISO-8601 **string**,
   * not unix seconds; `ok` is `false` for every posture that is not
   * `live`/`expiring`, which is what keeps coord's existing dark scan
   * selecting those devices. `tenant_id` and `exp` are carried for the
   * operator's benefit on the producing side and are not read here — this
   * module renders a posture, not a credential's contents. Today's shipped
   * runners publish the `{ ok, reason? }` prefix of that shape, which rung 3
   * of {@link resolveCoordCredential} still reads exactly.
   * `coordCredentialStatus.test.ts` pins the whole shape so a drift on either
   * side fails here rather than on the console.
   */
  reported?: unknown;
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
 */
export function resolveCoordCredential(
  input: CoordCredentialInput
): CoordCredentialStatus {
  const reported = asRecord(input.reported);
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

  // 4 — nothing measured this.
  return status("unknown", POSTURE_REASON.unknown, undefined, false);
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
   * Structurally 0 for the coord-join-only caller below; a device is only
   * counted here when something affirmatively measured it.
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
 * Roll a device list up for the strip. Takes the RAW fleet-health rows: the
 * strip has no access to the device-status stream (that hook lives inside
 * `FleetOverview`, and a second subscription here would break R1), so this is
 * deliberately the coord-join-only view.
 *
 * **Consequence, stated rather than hidden: `ok` is 0 for every fleet.**
 * Coord's join can only conclude `dark` (see the module header), so from these
 * rows alone every device that is not dark is `unknown` — including the ones
 * whose runners are publishing `ok: true` perfectly well, whose report the
 * per-card resolver can see and this one cannot. The strip therefore reports
 * a large `credential unknown N` until either the strip gains the bag or coord
 * serves a positive verdict, and that is the honest reading: `needsAction` is
 * exact, `unknown` is "this view did not measure it", and neither is a claim
 * of health. Counting those devices as `ok` is precisely the defect this
 * module was corrected for.
 */
export function summarizeCoordCredentials(
  devices: ReadonlyArray<{ credential_dark?: DeviceCredentialDark | null }>,
  scrapeUp?: boolean
): CoordCredentialRollup {
  let needsAction = 0;
  let ok = 0;
  let unknown = 0;
  for (const device of devices) {
    const resolved = resolveCoordCredential({
      credentialDark: device.credential_dark,
    });
    if (!resolved.measured) unknown += 1;
    else if (resolved.attention === "author") needsAction += 1;
    else ok += 1;
  }
  return { total: devices.length, needsAction, ok, unknown, scrapeUp };
}
