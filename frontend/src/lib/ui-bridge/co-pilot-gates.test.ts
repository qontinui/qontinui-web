import { describe, it, expect } from "vitest";
import {
  isCoPilotConsentSatisfied,
  isLoopbackAutoGrant,
  isLoopbackHostname,
} from "./co-pilot-gates";

/**
 * Guards the co-pilot consent auto-grant. The auto-grant is keyed on the
 * browser having addressed loopback, because the dev server binds 0.0.0.0
 * and UI_BRIDGE_REQUIRE_AUTH is default-off — a LAN visitor reaching the app
 * by IP must NOT auto-register a drivable tab.
 *
 * Literals, not the module's own Set: widening LOOPBACK_HOSTNAMES must fail
 * here rather than pass by construction.
 */
describe("isLoopbackHostname", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])("accepts %s", (h) => {
    expect(isLoopbackHostname(h)).toBe(true);
  });

  it.each([
    "192.168.1.42",
    "10.0.0.7",
    "qontinui.io",
    "localhost.evil.com",
    "notlocalhost",
    "127.0.0.1.evil.com",
    "0.0.0.0",
    "",
  ])("rejects %s", (h) => {
    expect(isLoopbackHostname(h)).toBe(false);
  });
});

/**
 * The full truth table — every surface (relay listener, active banner,
 * readiness badge, home page) reads this one predicate, so a row changing
 * here changes all of them together.
 */
describe("isCoPilotConsentSatisfied / isLoopbackAutoGrant", () => {
  it.each([
    // loopbackDev, preferenceEnabled, consentState, satisfied, autoGrant
    [true, false, null, true, true],
    [true, true, null, true, true],
    [true, false, "granted", true, true],
    [true, true, "granted", true, false],
    // An explicit revoke beats the loopback auto-grant.
    [true, false, "revoked", false, false],
    [true, true, "revoked", false, false],
    // Off loopback, only the explicit preference + grant opens the gate.
    [false, true, "granted", true, false],
    [false, true, null, false, false],
    [false, false, "granted", false, false],
    [false, true, "revoked", false, false],
    [false, false, null, false, false],
  ] as const)(
    "loopbackDev=%s preference=%s consent=%s → satisfied=%s autoGrant=%s",
    (loopbackDev, preferenceEnabled, consentState, satisfied, autoGrant) => {
      const inputs = { loopbackDev, preferenceEnabled, consentState };
      expect(isCoPilotConsentSatisfied(inputs)).toBe(satisfied);
      expect(isLoopbackAutoGrant(inputs)).toBe(autoGrant);
    }
  );
});
