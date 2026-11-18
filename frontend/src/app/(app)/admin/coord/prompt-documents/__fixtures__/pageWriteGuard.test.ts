/**
 * The page guard fixture answers a write as the page's provider does (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 2 and
 * 5): with no pin a write is refused, and `PINNED_PAGE` pins and allows. No
 * other suite fails if the default goes back to allowing every write, so
 * this one holds it.
 */

import { describe, it, expect } from "vitest";
import type { ProjectPin } from "@/services/http-client";
import { PINNED_PAGE, testPageGuard } from "./pageWriteGuard";

describe("the page guard fixture", () => {
  it("refuses a write while there is no pin, as the page's provider does", () => {
    const guard = testPageGuard();

    expect(guard.pin).toBeUndefined();
    expect(guard.writeAllowed()).toBe(false);
    expect(guard.resolvePin()).toBeUndefined();
    // A state the provider reaches: the layout's provider still reading the
    // membership list on a first visit, so the page's project is UNKNOWN.
    expect(guard.tenantContext?.loading).toBe(true);
    expect(guard.tenantContext?.error).toBeNull();
    expect(guard.mountTenant).toBeNull();
    expect(guard.pageTenant).toBeUndefined();
    expect(guard.projectListFailed).toBe(false);
  });

  it("allows a write once there is a pin, and resolves that pin", () => {
    const pin: ProjectPin = { tenant: "t-bravo" };
    const guard = testPageGuard({ pin });

    expect(guard.writeAllowed()).toBe(true);
    expect(guard.resolvePin()).toBe(pin);
  });

  it("PINNED_PAGE pins every request to the page's project, and allows a write", () => {
    // A state the provider reaches: the layout's provider has read the list
    // and named the page's project, and the pin names it (`usePageProject`).
    expect(PINNED_PAGE.tenantContext?.loading).toBe(false);
    expect(PINNED_PAGE.tenantContext?.error).toBeNull();
    expect(PINNED_PAGE.tenantContext?.activeTenantId).toBe("t-page");
    expect(PINNED_PAGE.tenantContext?.tenants.map((t) => t.id)).toEqual([
      "t-page",
    ]);
    expect(PINNED_PAGE.pageTenant).toBe("t-page");
    expect(PINNED_PAGE.pin).toEqual({ tenant: "t-page" });
    expect(PINNED_PAGE.resolvePin()).toEqual({ tenant: "t-page" });
    expect(PINNED_PAGE.writeAllowed()).toBe(true);
  });
});
