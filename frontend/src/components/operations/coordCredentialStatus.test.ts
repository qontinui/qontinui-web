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
 *  2. **`{dark: false}` is a MEASUREMENT** and must not read the same as (1).
 *  3. **The posture wins when a producer publishes one**, so this surface
 *     starts reporting `expired` / `unrefreshable` the day the runner half
 *     ships — and never synthesises one before.
 *  4. **The palette agrees with the audit table** (style guide §4.2 clause 3),
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
  it("reads a measured-healthy device as live", () => {
    const status = resolveCoordCredential({
      credentialDark: { dark: false },
    });
    expect(status.kind).toBe("live");
    expect(status.measured).toBe(true);
    expect(status.attention).toBe("none");
  });

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
    const measured = resolveCoordCredential({
      credentialDark: { dark: false },
    });
    const unmeasured = resolveCoordCredential({});
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
});

describe("summarizeCoordCredentials", () => {
  it("counts unknown separately from ok — never folded into the healthy side", () => {
    const rollup = summarizeCoordCredentials([
      { credential_dark: { dark: false } },
      { credential_dark: { dark: true, reason: "no bearer" } },
      { credential_dark: null },
      {},
    ]);
    expect(rollup).toMatchObject({
      total: 4,
      ok: 1,
      needsAction: 1,
      unknown: 2,
    });
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
