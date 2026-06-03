import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSessionHashForTests,
  getSessionHash,
} from "./session-hash";

describe("session-hash", () => {
  beforeEach(() => {
    __resetSessionHashForTests();
  });

  it("is stable within a page-load (cached in memory)", () => {
    const a = getSessionHash();
    const b = getSessionHash();
    expect(a).toBe(b);
  });

  it("produces a distinct value on a fresh page-load", () => {
    const first = getSessionHash();
    __resetSessionHashForTests(); // simulate a new page load
    const second = getSessionHash();
    expect(second).not.toBe(first);
  });

  it("is a non-empty opaque hex token (non-reversible, not a raw id)", () => {
    const h = getSessionHash();
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeGreaterThanOrEqual(8);
  });

  it("NEVER writes to any device storage (ePrivacy load-bearing)", () => {
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const cookieSetter = vi.fn();
    const originalCookie = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie"
    );
    // Trap any attempt to write document.cookie.
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: cookieSetter,
    });

    __resetSessionHashForTests();
    getSessionHash();

    expect(localSpy).not.toHaveBeenCalled();
    expect(cookieSetter).not.toHaveBeenCalled();

    // restore
    if (originalCookie) {
      Object.defineProperty(document, "cookie", originalCookie);
    }
    localSpy.mockRestore();
  });
});

afterEach(() => {
  __resetSessionHashForTests();
});
