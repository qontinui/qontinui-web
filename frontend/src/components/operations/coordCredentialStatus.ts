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
 *    own UNKNOWN, deliberately not `{dark:false}`.
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
 * `dark: false` means the scan ran and this device was not in its result set —
 * a MEASUREMENT. The absence of the whole object is the other thing entirely;
 * see {@link resolveCoordCredential}.
 */
export interface DeviceCredentialDark {
  /**
   * `true` = the runner published `coord_credential.ok == false` on its last
   * status heartbeat: it holds no usable coord device JWT.
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
   * `undefined` on every device today: no producer writes it yet (see the
   * module header). It is read rather than derived on purpose — a `since` this
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
   * Read as `unknown` and narrowed here because the runner, not this repo,
   * owns its shape: today `{ ok, reason? }`, and after the plan's Phase 1
   * `{ posture, since, tenant_id, exp, … }`. Anything unrecognised falls
   * through to the coord join rather than being guessed at.
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
    "No coord-credential verdict for this device. UNKNOWN, not healthy: coord ran no join, this coord predates the field, or the runner has never reported one.",
};

/**
 * Resolve one device row's credential posture from whatever the wire carried.
 *
 * Precedence, richest first — and every rung is a READ, never an inference:
 *
 * 1. A real `posture` string in the runner's heartbeat bag (Phase 1's shape).
 *    It is the only source that can carry `since`, and the only one that can
 *    distinguish `expired` from `unrefreshable`.
 * 2. Coord's `credential_dark` join. Boolean, but it is the page's own spine
 *    read and it is what exists today.
 * 3. A bare `ok` boolean in the heartbeat bag — the same fact as (2) without
 *    coord's join, for a row whose device-status stream arrived and whose
 *    fleet-health join did not.
 * 4. **UNKNOWN.** Nothing measured this.
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

  // 2 — coord's join.
  const dark = input.credentialDark;
  if (dark && typeof dark.dark === "boolean") {
    const kind: CoordCredentialPosture = dark.dark ? "dark" : "live";
    return status(
      kind,
      asString(dark.reason) ?? reportedReason ?? POSTURE_REASON[kind],
      since,
      true
    );
  }

  // 3 — the runner's boolean, unjoined.
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
  /** Devices with a measured, healthy-or-self-clearing posture. */
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
 * strip has no access to the device-status stream (that join happens per card),
 * so this is deliberately the coord-join-only view and will report `unknown`
 * for a device whose only verdict rode the heartbeat bag.
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
