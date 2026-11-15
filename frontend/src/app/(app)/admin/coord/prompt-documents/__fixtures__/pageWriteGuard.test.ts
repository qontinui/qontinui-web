/**
 * The page guard fixture answers a write as the page's provider does unless a
 * suite opts out by name (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review round 2, A4). A
 * suite that forgets to opt in therefore gets the provider's refusal, and no
 * test can assert "allowed" on an answer the page never gives without naming
 * `UNPINNED_WRITES_ALLOWED`. No other suite fails if the default goes back to
 * allowing every write, so this one holds it.
 */

import { describe, it, expect } from "vitest";
import type { ProjectPin } from "@/services/http-client";
import { testPageGuard, UNPINNED_WRITES_ALLOWED } from "./pageWriteGuard";

describe("the page guard fixture", () => {
  it("refuses a write while there is no pin, as the page's provider does", () => {
    const guard = testPageGuard();

    expect(guard.pin).toBeUndefined();
    expect(guard.writeAllowed()).toBe(false);
    expect(guard.resolvePin()).toBeUndefined();
  });

  it("allows a write once there is a pin, and resolves that pin", () => {
    const pin: ProjectPin = { tenant: "t-bravo" };
    const guard = testPageGuard({ pin });

    expect(guard.writeAllowed()).toBe(true);
    expect(guard.resolvePin()).toBe(pin);
  });

  it("allows a write with no pin only under UNPINNED_WRITES_ALLOWED, the opt-in by name", () => {
    expect(UNPINNED_WRITES_ALLOWED.pin).toBeUndefined();
    expect(UNPINNED_WRITES_ALLOWED.resolvePin()).toBeUndefined();
    expect(UNPINNED_WRITES_ALLOWED.writeAllowed()).toBe(true);
  });
});
