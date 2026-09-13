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
  resolveCoordCredential,
  summarizeCoordCredentials,
} from "./coordCredentialStatus";

describe("resolveCoordCredential", () => {
  it("reads a device that PUBLISHED a healthy credential as live", () => {
    const status = resolveCoordCredential({
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
      const status = resolveCoordCredential({
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
    const status = resolveCoordCredential({
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
    const status = resolveCoordCredential(input);
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
    const measured = resolveCoordCredential({
      credentialDark: { dark: false },
      reported: { ok: true },
    });
    const unmeasured = resolveCoordCredential({
      credentialDark: { dark: false },
    });
    expect(measured.kind).toBe("live");
    expect(unmeasured.kind).toBe("unknown");
    expect(measured.kind).not.toBe(unmeasured.kind);
    expect(measured.measured).toBe(true);
    expect(unmeasured.measured).toBe(false);
  });

  it("prefers a published posture over coord's boolean join, and carries its `since`", () => {
    const status = resolveCoordCredential({
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
    const expired = resolveCoordCredential({
      reported: { posture: "expired" },
    });
    const unrefreshable = resolveCoordCredential({
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
    const status = resolveCoordCredential({
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
    const status = resolveCoordCredential({
      reported: { posture: "vibes", ok: false, reason: "who knows" },
    });
    expect(status.kind).toBe("dark");
    expect(status.reason).toBe("who knows");
  });

  it("falls back to the runner's bare `ok` when coord served no join", () => {
    expect(resolveCoordCredential({ reported: { ok: true } }).kind).toBe(
      "live"
    );
    expect(resolveCoordCredential({ reported: { ok: false } }).kind).toBe(
      "dark"
    );
  });

  it("does not let a bag talk a device back out of coord's dark verdict", () => {
    // The correction for C5 must not cost the dark arm anything. Coord's
    // `dark: true` is a real measurement of ill-health and outranks a bag
    // that may simply be a staler read of the same fact.
    const status = resolveCoordCredential({
      credentialDark: { dark: true, reason: "no bearer" },
      reported: { ok: true },
    });
    expect(status.kind).toBe("dark");
    expect(status.attention).toBe("author");
    expect(status.measured).toBe(true);
  });
});

/**
 * The cross-repo wire contract for `details.coord_credential`, pinned here so
 * a rename or a type change on the `qontinui-runner` side fails in this repo's
 * test suite rather than silently on an operator's console.
 *
 * Agreed shape:
 * `{ ok: bool, reason: string|null, posture: string, since: ISO-8601 string,
 *    tenant_id: string|null, exp: unix seconds|null }`
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
    };
  }

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
      const status = resolveCoordCredential({
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
    expect(resolveCoordCredential({ reported: renamed }).kind).toBe("dark");
    expect(
      resolveCoordCredential({ reported: bag("unrefreshable", false) }).kind
    ).toBe("unrefreshable");
  });

  it("requires `since` to be an ISO-8601 string, not unix seconds", () => {
    const numeric = { ...bag("expired", false), since: 1789000000 };
    expect(resolveCoordCredential({ reported: numeric }).since).toBeUndefined();
    expect(
      resolveCoordCredential({ reported: bag("expired", false) }).since
    ).toBe("2026-09-12T03:54:26Z");
  });

  it("ignores the fields it does not render rather than failing on them", () => {
    // `tenant_id` and `exp` ride the bag for the producing side's benefit.
    // This module renders a posture, not a credential's contents.
    const status = resolveCoordCredential({ reported: bag("live", true) });
    expect(status.kind).toBe("live");
    expect(status).not.toHaveProperty("tenant_id");
    expect(status).not.toHaveProperty("exp");
  });

  it("still reads today's shipped `{ok, reason}` prefix of the contract", () => {
    // The runner half is in flight; every deployed runner publishes only the
    // first two keys. Rung 3 must keep reading them, or this correction would
    // turn the whole fleet UNKNOWN on the day it deployed.
    const status = resolveCoordCredential({
      credentialDark: { dark: false },
      reported: { ok: true, reason: null },
    });
    expect(status.kind).toBe("live");
    expect(status.measured).toBe(true);
    expect(status.since).toBeUndefined();
  });
});

describe("summarizeCoordCredentials", () => {
  it("counts unknown separately from ok — never folded into the healthy side", () => {
    const rollup = summarizeCoordCredentials([
      { credential_dark: { dark: false } },
      { credential_dark: { dark: true, reason: "no bearer" } },
      { credential_dark: null },
      {},
    ]);
    // `dark: false`, an explicit null and a missing field are three different
    // routes to the same honest answer: this view did not measure them.
    // `needsAction` stays exact — the strip's red count is the one number
    // here that is a measurement.
    expect(rollup).toMatchObject({
      total: 4,
      ok: 0,
      needsAction: 1,
      unknown: 3,
    });
  });

  it("reports ok: 0 from coord's join alone — it cannot measure health", () => {
    // Not an accident and not a TODO: coord's join concludes only `dark`, so
    // a rollup over fleet-health rows has no source for an affirmative
    // verdict. A non-zero `ok` here could only come from having guessed.
    const rollup = summarizeCoordCredentials([
      { credential_dark: { dark: false } },
      { credential_dark: { dark: false } },
    ]);
    expect(rollup.ok).toBe(0);
    expect(rollup.unknown).toBe(2);
    expect(rollup.needsAction).toBe(0);
  });

  it("passes coord's scrape flag through verbatim — undefined is not false", () => {
    expect(summarizeCoordCredentials([], undefined).scrapeUp).toBeUndefined();
    expect(summarizeCoordCredentials([], false).scrapeUp).toBe(false);
  });

  it("reports an empty fleet as nothing to say, not as an all-clear", () => {
    const rollup = summarizeCoordCredentials([]);
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
