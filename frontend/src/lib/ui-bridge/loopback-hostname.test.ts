import { describe, it, expect } from "vitest";
import { isLoopbackHostname } from "./provider";

/**
 * Guards the co-pilot consent auto-grant (provider.tsx). The auto-grant is
 * keyed on the browser having addressed loopback, because the dev server
 * binds 0.0.0.0 and UI_BRIDGE_REQUIRE_AUTH is default-off — a LAN visitor
 * reaching the app by IP must NOT auto-register a drivable tab.
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
