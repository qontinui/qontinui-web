/**
 * The credential posture derivation, and the one rule it exists to hold.
 *
 * Plan `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
 * Phase 5. Every assertion below is a regression guard for a way the fleet
 * console could go back to reporting a dark machine as fine:
 *
 *  1. **A missing verdict is UNKNOWN, never `live`** — asserted from all three
 *     absences (no field, explicit `null`, and an empty bag), because they
 *     arrive by different routes and only one of them is the obvious one.
 *  2. **`{dark: false}` is NOT a measurement** and must read as (1) unless the
 *     runner's own bag says otherwise. Coord stamps it on every device its
 *     `coord_credential.ok = 'false'` scan did not name, which includes every
 *     device that reported nothing — so the presence of the bag, not coord's
 *     stamp, is what can conclude `live`. The first version of this module got
 *     this backwards and rendered unmeasured machines `credential live` on a
 *     calm badge; that is the defect the plan exists to close, reproduced on
 *     the page built to report it.
 *  3. **`{dark: true}` still wins** over a bag claiming health. Correcting (2)
 *     must not cost the dark arm anything.
 *  4. **The posture wins when a producer publishes one**, so this surface
 *     starts reporting `expired` / `unrefreshable` the day the runner half
 *     ships — and never synthesises one before.
 *  5. **The wire contract is pinned**, key by key, so a `posture`→`state`
 *     rename or a numeric `since` on the runner side fails here.
 *  6. **The palette agrees with the audit table** (style guide §4.2 clause 3),
 *     which is what stops `unknown` from being quietly painted calm.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  COORD_CREDENTIAL_ATTENTION_BY_POSTURE,
  COORD_CREDENTIAL_PALETTE,
  coordDeviceHostKey,
  reportedCoordCredential,
  reportedCoordCredentialFor,
  resolveCoordCredential,
  summarizeCoordCredentials,
  COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS,
  type CoordCredentialInput,
} from "./coordCredentialStatus";

/** The injected clock every staleness decision below is measured against. */
const NOW = Date.parse("2026-09-14T12:00:00Z");
/** An ISO stamp `secs` seconds before {@link NOW}. */
function secondsAgo(secs: number): string {
  return new Date(NOW - secs * 1_000).toISOString();
}
/** A report comfortably inside every bound these tests use. */
const FRESH_AT = secondsAgo(30);

/**
 * `resolveCoordCredential` for a bag reported {@link FRESH_AT} — the tests
 * that are about what a bag SAYS, not how old it is. An explicit `reportedAt`
 * or `now` in `input` wins.
 */
function resolveFresh(input: CoordCredentialInput) {
  return resolveCoordCredential({ reportedAt: FRESH_AT, now: NOW, ...input });
}

/** `summarizeCoordCredentials` on the injected clock. */
function summarizeFresh(
  ...args: Parameters<typeof summarizeCoordCredentials>
) {
  const [devices, stream, scrapeUp] = args;
  return summarizeCoordCredentials(devices, stream, scrapeUp, NOW);
}

describe("resolveCoordCredential", () => {
  it("reads a device that PUBLISHED a healthy credential as live", () => {
    const status = resolveFresh({
      credentialDark: { dark: false },
      reported: { ok: true },
    });
    expect(status.kind).toBe("live");
    expect(status.measured).toBe(true);
    expect(status.attention).toBe("none");
  });

  // C5, and the reason this file's first version was wrong: coord's
  // `dark: false` is a ROSTER STAMP, not a measurement. `join_credential_dark`
  // (fleet_health.rs) writes it onto every device its scan did not name, and
  // that scan's only predicate is `coord_credential.ok = 'false'` — so a
  // device that published no `coord_credential` at all, one whose `ok` is
  // non-boolean, and one with no `device_status` row are ALL stamped
  // `dark: false` alongside the genuinely healthy ones.
  it.each([
    ["a device that published nothing at all", undefined],
    ["a bag with no `ok` key", { reason: "…" }],
    ["a bag whose `ok` is non-boolean", { ok: "true" }],
    ["a bag that is not an object", "healthy"],
  ])(
    "refuses to read coord's `dark: false` as live for %s",
    (_name, reported) => {
      const status = resolveFresh({
        credentialDark: { dark: false },
        reported,
      });
      expect(status.kind).toBe("unknown");
      expect(status.kind).not.toBe("live");
      expect(status.measured).toBe(false);
      expect(status.attention).toBe("waiting");
      expect(status.label).not.toMatch(/live/);
      expect(COORD_CREDENTIAL_PALETTE.badgeClass[status.kind]).toMatch(
        /\bbg-amber-/
      );
    }
  );

  it("reads coord's dark join as an author-action posture, carrying the runner's reason", () => {
    const status = resolveFresh({
      credentialDark: { dark: true, reason: "tier not QontinuiAccount" },
    });
    expect(status.kind).toBe("dark");
    expect(status.attention).toBe("author");
    expect(status.reason).toBe("tier not QontinuiAccount");
    expect(status.measured).toBe(true);
  });

  // The defect this whole plan exists for, at the level of one function.
  it.each([
    ["no field at all", {}],
    ["an explicit null join", { credentialDark: null }],
    ["a heartbeat bag with nothing recognisable in it", { reported: {} }],
    ["a non-object bag", { reported: "healthy" }],
  ])("renders %s as UNKNOWN and never as live", (_name, input) => {
    const status = resolveFresh(input);
    expect(status.kind).toBe("unknown");
    expect(status.kind).not.toBe("live");
    expect(status.measured).toBe(false);
    // The ignorance floor: amber, never calm. A calm `unknown` is this
    // incident with a badge attached.
    expect(status.attention).toBe("waiting");
    expect(COORD_CREDENTIAL_PALETTE.badgeClass[status.kind]).toMatch(
      /\bbg-amber-/
    );
  });

  it("keeps a measured-fine device distinguishable from an unmeasured one", () => {
    // Both sides carry coord's identical `dark: false` stamp. The ONLY thing
    // separating them is the presence of the runner's own bag — which is
    // exactly the discriminator, and the reason coord's join alone cannot
    // answer this question.
    const measured = resolveFresh({
      credentialDark: { dark: false },
      reported: { ok: true },
    });
    const unmeasured = resolveFresh({
      credentialDark: { dark: false },
    });
    expect(measured.kind).toBe("live");
    expect(unmeasured.kind).toBe("unknown");
    expect(measured.kind).not.toBe(unmeasured.kind);
    expect(measured.measured).toBe(true);
    expect(unmeasured.measured).toBe(false);
  });

  it("prefers a published posture over coord's boolean join, and carries its `since`", () => {
    const status = resolveFresh({
      // Coord's join has not caught up (or the scan ran before the runner
      // went dark); the runner's own report is the finer, fresher fact.
      credentialDark: { dark: false },
      reported: {
        posture: "unrefreshable",
        since: "2026-09-12T03:54:26Z",
        reason: "device-JWT re-mint failed and the existing JWT is expired",
      },
    });
    expect(status.kind).toBe("unrefreshable");
    expect(status.attention).toBe("author");
    expect(status.since).toBe("2026-09-12T03:54:26Z");
    expect(status.reason).toMatch(/re-mint failed/);
  });

  it("distinguishes expired from unrefreshable — the two the boolean wire cannot", () => {
    const expired = resolveFresh({
      reported: { posture: "expired" },
    });
    const unrefreshable = resolveFresh({
      reported: { posture: "unrefreshable" },
    });
    expect(expired.kind).toBe("expired");
    expect(unrefreshable.kind).toBe("unrefreshable");
    // Both demand a person; neither is amber.
    for (const status of [expired, unrefreshable]) {
      expect(status.attention).toBe("author");
      expect(COORD_CREDENTIAL_PALETTE.badgeClass[status.kind]).toMatch(
        /\bbg-red-/
      );
    }
  });

  it("treats `expiring` as self-clearing, not as an emergency", () => {
    // The runner's whole design is that it re-mints without the user. Paging
    // an operator for the normal case is what teaches them to ignore red.
    const status = resolveFresh({
      reported: { posture: "expiring" },
    });
    expect(status.attention).toBe("waiting");
    expect(COORD_CREDENTIAL_PALETTE.badgeClass[status.kind]).not.toMatch(
      /\bbg-red-/
    );
  });

  it("ignores a posture string it does not know rather than trusting it", () => {
    // A newer runner inventing a posture must not render as an unstyled badge
    // or, worse, fall through to something calm.
    const status = resolveFresh({
      reported: { posture: "vibes", ok: false, reason: "who knows" },
    });
    expect(status.kind).toBe("dark");
    expect(status.reason).toBe("who knows");
  });

  it("falls back to the runner's bare `ok` when coord served no join", () => {
    expect(resolveFresh({ reported: { ok: true } }).kind).toBe(
      "live"
    );
    expect(resolveFresh({ reported: { ok: false } }).kind).toBe(
      "dark"
    );
  });

  it("does not let a bag talk a device back out of coord's dark verdict", () => {
    // The correction for C5 must not cost the dark arm anything. Coord's
    // `dark: true` is a real measurement of ill-health and outranks a bag
    // that may simply be a staler read of the same fact.
    const status = resolveFresh({
      credentialDark: { dark: true, reason: "no bearer" },
      reported: { ok: true },
    });
    expect(status.kind).toBe("dark");
    expect(status.attention).toBe("author");
    expect(status.measured).toBe(true);
  });
});

/**
 * Plan `2026-09-14-credential-posture-second-residuals` Phase 4: a runner's
 * report is evidence only while it is younger than its staleness bound. A
 * runner offline for days still has its last `ok: true` on its device-status
 * row, and that must not read `live` on its row or count `ok` on the strip.
 */
describe("resolveCoordCredential — a report past its staleness bound", () => {
  const STALE_AT = secondsAgo(COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS + 60);

  it.each([
    ["a live posture", { ok: true, posture: "live" }],
    ["a bare ok: true", { ok: true }],
  ])("reads %s reported past the bound as UNKNOWN, naming its age", (_n, bag) => {
    const status = resolveCoordCredential({
      credentialDark: { dark: false },
      reported: bag,
      reportedAt: STALE_AT,
      now: NOW,
    });
    expect(status.kind).toBe("unknown");
    expect(status.measured).toBe(false);
    expect(status.attention).toBe("waiting");
    expect(status.since).toBeUndefined();
    // 960 s → "16m ago": the reason says how old the report is.
    expect(status.reason).toMatch(/last credential report was 16m ago/);
    expect(status.reason).toMatch(/900s staleness bound/);
  });

  it("reads the same bag inside the bound as live", () => {
    const status = resolveCoordCredential({
      reported: { ok: true, posture: "live" },
      reportedAt: secondsAgo(COORD_CREDENTIAL_FALLBACK_STALE_AFTER_SECS - 60),
      now: NOW,
    });
    expect(status.kind).toBe("live");
    expect(status.measured).toBe(true);
  });

  it("still honours coord's own dark verdict when the bag is stale", () => {
    const status = resolveCoordCredential({
      credentialDark: { dark: true, reason: "no bearer" },
      reported: { ok: true, posture: "live" },
      reportedAt: STALE_AT,
      now: NOW,
    });
    expect(status.kind).toBe("dark");
    expect(status.reason).toBe("no bearer");
    expect(status.measured).toBe(true);
  });

  it("does not let a stale author posture render either — its age makes it unknown too", () => {
    const status = resolveCoordCredential({
      reported: { ok: false, posture: "unrefreshable" },
      reportedAt: STALE_AT,
      now: NOW,
    });
    expect(status.kind).toBe("unknown");
    expect(status.measured).toBe(false);
  });

  it("reads the runner's own `stale_after_secs`: 60 is fresh at 59s and stale at 61s", () => {
    const bag = { ok: true, posture: "live", stale_after_secs: 60 };
    const at59 = resolveCoordCredential({
      reported: bag,
      reportedAt: secondsAgo(59),
      now: NOW,
    });
    const at61 = resolveCoordCredential({
      reported: bag,
      reportedAt: secondsAgo(61),
      now: NOW,
    });
    expect(at59.kind).toBe("live");
    expect(at61.kind).toBe("unknown");
    expect(at61.reason).toMatch(/was 1m ago, past its 60s staleness bound/);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["a string", "60"],
    ["NaN", Number.NaN],
  ])(
    "falls back to the 900s bound when `stale_after_secs` is %s",
    (_n, declared) => {
      const bag = { ok: true, stale_after_secs: declared };
      // 61 s would be stale under a 60 s bound; under the fallback it is fresh.
      expect(
        resolveCoordCredential({
          reported: bag,
          reportedAt: secondsAgo(61),
          now: NOW,
        }).kind
      ).toBe("live");
      expect(
        resolveCoordCredential({
          reported: bag,
          reportedAt: secondsAgo(901),
          now: NOW,
        }).kind
      ).toBe("unknown");
    }
  );

  it.each([
    ["no reportedAt", undefined],
    ["an unparseable reportedAt", "not a timestamp"],
  ])("treats a bag with %s as stale, not live", (_n, reportedAt) => {
    const status = resolveCoordCredential({
      reported: { ok: true },
      reportedAt,
      now: NOW,
    });
    expect(status.kind).toBe("unknown");
    expect(status.measured).toBe(false);
    expect(status.reason).toMatch(/carries no usable timestamp/);
  });

  it("keeps the no-report reason for a device with no bag at all", () => {
    const noBag = resolveCoordCredential({ reportedAt: STALE_AT, now: NOW });
    expect(noBag.kind).toBe("unknown");
    expect(noBag.reason).toMatch(/No coord-credential verdict/);
    expect(noBag.reason).not.toMatch(/staleness bound/);
  });
});

/**
 * The cross-repo wire contract for `details.coord_credential`, pinned here so
 * a rename or a type change on the `qontinui-runner` side fails in this repo's
 * test suite rather than silently on an operator's console.
 *
 * Agreed shape:
 * `{ ok: bool, reason: string|null, posture: string, since: ISO-8601 string,
 *    tenant_id: string|null, exp: unix seconds|null,
 *    stale_after_secs: seconds (positive number) }`
 *
 * The two spellings that would break this consumer silently are `state`
 * instead of `posture` (the badge would fall back to the coarse boolean and
 * never show `expired`/`unrefreshable`) and a numeric `since` (the badge would
 * drop the timestamp, since `asString` rejects it) — both asserted below.
 */
describe("the details.coord_credential wire contract", () => {
  /** One bag exactly as the runner publishes it, parameterised by posture. */
  function bag(
    posture: string,
    ok: boolean,
    reason: string | null = null
  ): Record<string, unknown> {
    return {
      ok,
      reason,
      posture,
      since: "2026-09-12T03:54:26Z",
      tenant_id: "11111111-2222-3333-4444-555555555555",
      exp: 1789000000,
      stale_after_secs: 900,
    };
  }

  it("reads `stale_after_secs` as a number of seconds off the contract bag", () => {
    const contract = { ...bag("live", true), stale_after_secs: 120 };
    expect(
      resolveCoordCredential({
        reported: contract,
        reportedAt: secondsAgo(119),
        now: NOW,
      }).kind
    ).toBe("live");
    expect(
      resolveCoordCredential({
        reported: contract,
        reportedAt: secondsAgo(121),
        now: NOW,
      }).kind
    ).toBe("unknown");
  });

  it.each([
    ["live", true, "none"],
    ["expiring", true, "waiting"],
    ["expired", false, "author"],
    ["absent", false, "author"],
    ["unrefreshable", false, "author"],
    ["dark", false, "author"],
  ] as const)(
    "reads posture %s off the contract bag and carries its ISO `since`",
    (posture, ok, attention) => {
      const status = resolveFresh({
        // Coord's join is whatever it is; the published posture is finer and
        // wins. `ok:false` is also what keeps coord's dark scan selecting
        // these devices, so both arms are exercised here.
        credentialDark: { dark: !ok },
        reported: bag(posture, ok),
      });
      expect(status.kind).toBe(posture);
      expect(status.attention).toBe(attention);
      expect(status.measured).toBe(true);
      expect(status.since).toBe("2026-09-12T03:54:26Z");
    }
  );

  it("reads the key `posture`, NOT `state`", () => {
    const renamed = { ...bag("unrefreshable", false) } as Record<
      string,
      unknown
    >;
    renamed.state = renamed.posture;
    delete renamed.posture;
    // A producer that regressed to `state` gets the coarse boolean arm, never
    // a synthesised posture — and this assertion is what says so out loud.
    expect(resolveFresh({ reported: renamed }).kind).toBe("dark");
    expect(
      resolveFresh({ reported: bag("unrefreshable", false) }).kind
    ).toBe("unrefreshable");
  });

  it("requires `since` to be an ISO-8601 string, not unix seconds", () => {
    const numeric = { ...bag("expired", false), since: 1789000000 };
    expect(resolveFresh({ reported: numeric }).since).toBeUndefined();
    expect(
      resolveFresh({ reported: bag("expired", false) }).since
    ).toBe("2026-09-12T03:54:26Z");
  });

  it("ignores the fields it does not render rather than failing on them", () => {
    // `tenant_id` and `exp` ride the bag for the producing side's benefit.
    // This module renders a posture, not a credential's contents.
    const status = resolveFresh({ reported: bag("live", true) });
    expect(status.kind).toBe("live");
    expect(status).not.toHaveProperty("tenant_id");
    expect(status).not.toHaveProperty("exp");
  });

  it("still reads today's shipped `{ok, reason}` prefix of the contract", () => {
    // The runner half is in flight; every deployed runner publishes only the
    // first two keys. Rung 3 must keep reading them, or this correction would
    // turn the whole fleet UNKNOWN on the day it deployed.
    const status = resolveFresh({
      credentialDark: { dark: false },
      reported: { ok: true, reason: null },
    });
    expect(status.kind).toBe("live");
    expect(status.measured).toBe(true);
    expect(status.since).toBeUndefined();
  });
});

describe("coordDeviceHostKey / reportedCoordCredential", () => {
  it("keys a coord device by hostname, falling back to its device id", () => {
    // The same expression `useDeviceStatusStream` keys its map with.
    expect(coordDeviceHostKey({ device_id: "d-1", hostname: "msi" })).toBe(
      "msi"
    );
    expect(coordDeviceHostKey({ device_id: "d-1" })).toBe("d-1");
    expect(coordDeviceHostKey({ device_id: "d-1", hostname: null })).toBe(
      "d-1"
    );
  });

  it("reads the bag verbatim, with the row's updated_at, and yields undefined for every absence", () => {
    const bag = { ok: true, reason: null };
    const found = reportedCoordCredential({
      details: { coord_credential: bag },
      updated_at: FRESH_AT,
    });
    expect(found.reported).toBe(bag);
    expect(found.reportedAt).toBe(FRESH_AT);
    expect(reportedCoordCredential(undefined)).toEqual({
      reported: undefined,
      reportedAt: undefined,
    });
    for (const details of [{}, null, ["x"]]) {
      expect(
        reportedCoordCredential({ details, updated_at: FRESH_AT }).reported
      ).toBeUndefined();
    }
  });

  it("reads a row's bag only for the device that row belongs to", () => {
    const row = {
      device_id: "d-new",
      details: { coord_credential: { ok: true } },
      updated_at: FRESH_AT,
    };
    expect(reportedCoordCredentialFor("d-new", row)).toEqual({
      reported: { ok: true },
      reportedAt: FRESH_AT,
    });
    // Another device's row lends neither its bag nor its age.
    expect(reportedCoordCredentialFor("d-old", row)).toEqual({
      reported: undefined,
      reportedAt: undefined,
    });
    expect(reportedCoordCredentialFor("d-new", undefined).reported).toBe(
      undefined
    );
  });
});

describe("summarizeCoordCredentials", () => {
  type StreamRow = { device_id: string; details?: unknown; updated_at: string };
  const NO_STREAM = new Map<string, StreamRow>();

  /** One device-status row, for `deviceId`, carrying `details.coord_credential`. */
  function streamRow(
    deviceId: string,
    coordCredential: unknown,
    updatedAt: string = FRESH_AT
  ): StreamRow {
    return {
      device_id: deviceId,
      details: { coord_credential: coordCredential },
      updated_at: updatedAt,
    };
  }

  it("counts a device whose report is past its bound as unknown, not ok", () => {
    const stream = new Map<string, StreamRow>([
      ["fresh", streamRow("d-1", { ok: true, posture: "live" })],
      [
        "offline",
        streamRow(
          "d-2",
          { ok: true, posture: "live" },
          secondsAgo(3 * 24 * 60 * 60)
        ),
      ],
    ]);
    const rollup = summarizeFresh(
      [
        { device_id: "d-1", hostname: "fresh", credential_dark: { dark: false } },
        {
          device_id: "d-2",
          hostname: "offline",
          credential_dark: { dark: false },
        },
      ],
      stream
    );
    expect(rollup).toMatchObject({
      total: 2,
      ok: 1,
      unknown: 1,
      needsAction: 0,
    });
  });

  it("counts unknown separately from ok — never folded into the healthy side", () => {
    const rollup = summarizeFresh(
      [
        { device_id: "d-1", hostname: "a", credential_dark: { dark: false } },
        {
          device_id: "d-2",
          hostname: "b",
          credential_dark: { dark: true, reason: "no bearer" },
        },
        { device_id: "d-3", hostname: "c", credential_dark: null },
        { device_id: "d-4", hostname: "d" },
      ],
      NO_STREAM
    );
    // With no heartbeat bag anywhere, `dark: false`, an explicit null and a
    // missing field are three different routes to the same honest answer:
    // nothing measured them. `needsAction` stays exact.
    expect(rollup).toMatchObject({
      total: 4,
      ok: 0,
      needsAction: 1,
      unknown: 3,
    });
  });

  it("reports ok: 0 from coord's join alone — it cannot measure health", () => {
    // Under-claiming is the fallback where no bag is present: coord's join
    // concludes only `dark`, so without a runner report there is no source for
    // an affirmative verdict. A non-zero `ok` here could only come from guessing.
    const rollup = summarizeFresh(
      [
        { device_id: "d-1", hostname: "a", credential_dark: { dark: false } },
        { device_id: "d-2", hostname: "b", credential_dark: { dark: false } },
      ],
      NO_STREAM
    );
    expect(rollup.ok).toBe(0);
    expect(rollup.unknown).toBe(2);
    expect(rollup.needsAction).toBe(0);
  });

  it("reads each device's heartbeat bag: reported healthy → ok, neither source → unknown, dark → needsAction", () => {
    const stream = new Map<string, StreamRow>([
      ["healthy", streamRow("d-1", { ok: true, reason: null })],
      // A device-status row exists but carries no `coord_credential` key.
      [
        "silent",
        {
          device_id: "d-2",
          details: { current_task: "x" },
          updated_at: FRESH_AT,
        },
      ],
    ]);
    const rollup = summarizeFresh(
      [
        {
          device_id: "d-1",
          hostname: "healthy",
          credential_dark: { dark: false },
        },
        {
          device_id: "d-2",
          hostname: "silent",
          credential_dark: { dark: false },
        },
        { device_id: "d-3", hostname: "nobody" },
        {
          device_id: "d-4",
          hostname: "dead",
          credential_dark: { dark: true, reason: "expired" },
        },
      ],
      stream,
      true
    );
    expect(rollup).toEqual({
      total: 4,
      ok: 1,
      unknown: 2,
      needsAction: 1,
      scrapeUp: true,
    });
  });

  it("joins the bag under the same key the rows use — device id when coord serves no hostname", () => {
    const stream = new Map<string, StreamRow>([
      ["d-9", streamRow("d-9", { ok: true })],
    ]);
    expect(summarizeFresh([{ device_id: "d-9" }], stream).ok).toBe(
      1
    );
    // A hostname that matches no stream row is not rescued by an id match:
    // the row for this device would not find the bag either.
    expect(
      summarizeFresh([{ device_id: "d-9", hostname: "msi" }], stream)
        .unknown
    ).toBe(1);
  });

  it("counts a runner-reported dark or finer author posture as needsAction", () => {
    const stream = new Map<string, StreamRow>([
      ["a", streamRow("d-1", { ok: false, reason: "no bearer" })],
      ["b", streamRow("d-2", { ok: false, posture: "unrefreshable" })],
      ["c", streamRow("d-3", { ok: true, posture: "expiring" })],
    ]);
    const rollup = summarizeFresh(
      [
        { device_id: "d-1", hostname: "a", credential_dark: { dark: false } },
        { device_id: "d-2", hostname: "b" },
        { device_id: "d-3", hostname: "c" },
      ],
      stream
    );
    // `expiring` is measured and self-clearing: ok, not needsAction.
    expect(rollup).toMatchObject({ needsAction: 2, ok: 1, unknown: 0 });
  });

  it("never lets a device borrow another device's report under a shared hostname", () => {
    // A re-paired box: coord holds the old and the new device record, both
    // named `msi`. The stream keeps only the last row under `msi`, and that
    // row is the NEW device's. The old device published nothing of its own.
    const stream = new Map<string, StreamRow>([
      ["msi", streamRow("d-new", { ok: true })],
    ]);
    const rollup = summarizeFresh(
      [
        {
          device_id: "d-old",
          hostname: "msi",
          credential_dark: { dark: false },
        },
        {
          device_id: "d-new",
          hostname: "msi",
          credential_dark: { dark: false },
        },
      ],
      stream
    );
    expect(rollup).toMatchObject({
      total: 2,
      ok: 1,
      unknown: 1,
      needsAction: 0,
    });
  });

  it("passes coord's scrape flag through verbatim — undefined is not false", () => {
    expect(
      summarizeFresh([], NO_STREAM, undefined).scrapeUp
    ).toBeUndefined();
    expect(summarizeFresh([], NO_STREAM, false).scrapeUp).toBe(
      false
    );
  });

  it("reports an empty fleet as nothing to say, not as an all-clear", () => {
    const rollup = summarizeFresh([], NO_STREAM);
    expect(rollup.total).toBe(0);
    expect(rollup.needsAction).toBe(0);
    expect(rollup.unknown).toBe(0);
  });
});

describe("the R3 palette invariant", () => {
  it("agrees with the audited attention table", () => {
    // Registered in `console/consoleSurfaces.ts` as well, which is what makes
    // this audit run even if someone deletes this file. Asserted here too so
    // a failure names THIS surface.
    expect(
      paletteDisagreements(
        COORD_CREDENTIAL_ATTENTION_BY_POSTURE,
        COORD_CREDENTIAL_PALETTE
      )
    ).toEqual([]);
  });
});
