/**
 * Tests for ``useCoPilotSessionConsent``.
 *
 * Pins the consent SAFETY rails described in §4.5:
 *   - default state is null (no decision yet); the modal MUST render
 *   - grant -> "granted"; revoke -> "revoked"
 *   - sessionStorage (not localStorage) — closing the tab re-prompts
 *   - same-tab subscribers update via the custom event;
 *     cross-tab via the native ``storage`` event
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  useCoPilotSessionConsent,
  __CO_PILOT_SESSION_CONSENT_KEY__,
  __CO_PILOT_SESSION_CONSENT_EVENT__,
} from "./useCoPilotSessionConsent";

describe("useCoPilotSessionConsent", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("starts at null when no prior decision exists", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    expect(result.current.state).toBeNull();
  });

  it("grant() flips state to 'granted' and persists to sessionStorage", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    act(() => result.current.grant());
    expect(result.current.state).toBe("granted");
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("granted");
  });

  it("revoke() flips state to 'revoked' and persists to sessionStorage", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    act(() => result.current.revoke());
    expect(result.current.state).toBe("revoked");
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("revoked");
  });

  it("reset() clears the decision so the modal will re-prompt", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    act(() => result.current.grant());
    expect(result.current.state).toBe("granted");
    act(() => result.current.reset());
    expect(result.current.state).toBeNull();
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBeNull();
  });

  it("uses sessionStorage, NOT localStorage (closing the tab re-prompts)", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    act(() => result.current.grant());
    expect(
      window.localStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBeNull();
  });

  it("ignores garbage values stored externally", () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "TOTALLY_NOT_VALID"
    );
    const { result } = renderHook(() => useCoPilotSessionConsent());
    expect(result.current.state).toBeNull();
  });

  it("custom event in the same tab re-reads state", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    expect(result.current.state).toBeNull();

    // Simulate the audit-log banner's revoke dispatch:
    act(() => {
      window.sessionStorage.setItem(
        __CO_PILOT_SESSION_CONSENT_KEY__,
        "revoked"
      );
      document.dispatchEvent(
        new CustomEvent(__CO_PILOT_SESSION_CONSENT_EVENT__, {
          detail: { state: "revoked" },
        })
      );
    });
    expect(result.current.state).toBe("revoked");
  });

  it("native storage event (sibling tab) re-reads state", () => {
    const { result } = renderHook(() => useCoPilotSessionConsent());
    expect(result.current.state).toBeNull();

    act(() => {
      window.sessionStorage.setItem(
        __CO_PILOT_SESSION_CONSENT_KEY__,
        "granted"
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: __CO_PILOT_SESSION_CONSENT_KEY__,
          newValue: "granted",
        })
      );
    });
    expect(result.current.state).toBe("granted");
  });
});
