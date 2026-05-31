"use client";

/**
 * useCoPilotSessionConsent — per-session (transient) consent for the UI
 * Bridge AI co-pilot.
 *
 * Even with the per-user durable preference ON, every NEW browser session
 * shows a one-time modal before the relay listener mounts. The decision
 * lives in ``sessionStorage`` — closing the tab or opening a new one
 * re-prompts.
 *
 * State machine:
 *   - ``null``     — no decision yet for this session (modal should render).
 *   - ``granted``  — user clicked "Allow this session"; relay may mount.
 *   - ``revoked``  — user clicked "Not now" or hit Stop in the banner; relay
 *                    stays un-mounted until the user re-grants.
 *
 * Multi-tab consistency: tabs share ``sessionStorage`` ONLY when one was
 * opened with ``window.open`` / cmd+click from the other. They do NOT share
 * across user-opened windows. We still listen for the ``storage`` event
 * (which fires for the same-origin twin tabs that DO share), so a decision
 * made in one such tab immediately updates the other.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "qontinui_copilot_session_consent";
const CHANGE_EVENT = "co-pilot-consent-changed";

export type CoPilotSessionConsentState = "granted" | "revoked" | null;

export interface UseCoPilotSessionConsent {
  /** Current per-session consent state. */
  state: CoPilotSessionConsentState;
  /** Allow the relay listener to mount for the rest of this session. */
  grant: () => void;
  /** Revoke session consent immediately (un-mounts the relay listener). */
  revoke: () => void;
  /**
   * Re-evaluate the consent flow — clears the decision so the modal will
   * re-prompt. Used by tests + the "Ask me again" affordance.
   */
  reset: () => void;
}

function readState(): CoPilotSessionConsentState {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v === "granted" || v === "revoked" ? v : null;
  } catch {
    // sessionStorage can throw in some privacy modes.
    return null;
  }
}

function writeState(next: CoPilotSessionConsentState): void {
  if (typeof window === "undefined") return;
  try {
    if (next === null) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // best-effort; fall through so the in-memory state still updates
  }
  // Fire a custom event so SAME-tab subscribers update (the native
  // ``storage`` event ONLY fires in OTHER tabs).
  try {
    document.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { state: next } })
    );
  } catch {
    /* noop */
  }
}

export function useCoPilotSessionConsent(): UseCoPilotSessionConsent {
  const [state, setState] = useState<CoPilotSessionConsentState>(() =>
    readState()
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    // Re-sync on mount in case state changed between server render + hydrate
    setState(readState());

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        setState(readState());
      }
    };
    const onCustom = () => setState(readState());

    window.addEventListener("storage", onStorage);
    document.addEventListener(CHANGE_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener(CHANGE_EVENT, onCustom);
    };
  }, []);

  const grant = useCallback(() => {
    writeState("granted");
    setState("granted");
  }, []);

  const revoke = useCallback(() => {
    writeState("revoked");
    setState("revoked");
  }, []);

  const reset = useCallback(() => {
    writeState(null);
    setState(null);
  }, []);

  return { state, grant, revoke, reset };
}

/** Test helper — exposes the storage key for setup/teardown. */
export const __CO_PILOT_SESSION_CONSENT_KEY__ = STORAGE_KEY;
export const __CO_PILOT_SESSION_CONSENT_EVENT__ = CHANGE_EVENT;
