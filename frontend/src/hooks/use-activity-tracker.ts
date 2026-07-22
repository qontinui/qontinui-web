"use client";

import { useEffect, useRef } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("ActivityTracker");

// Matches the Cognito app client's IdTokenValidity (3h) so an idle-timeout
// sign-out can't fire earlier than the session it is meant to bound.
const INACTIVITY_TIMEOUT = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
const WARN_BEFORE_TIMEOUT = 3 * 60 * 1000; // Warn 3 minutes before timeout

/**
 * Activity Tracker Hook
 *
 * CURRENTLY UNMOUNTED: `<ActivityTracker />` is rendered by no layout, so this
 * hook is dead code today. The constants are kept in sync with the live session
 * length anyway, so mounting it later doesn't silently reintroduce a 1-hour
 * sign-out.
 *
 * Token Refresh Strategy:
 * - This hook does NOT refresh tokens. `TokenRefreshService` owns both the
 *   proactive (pre-expiry) and reactive (401) refresh paths, single-flighted.
 * - Frontend only tracks user activity here, for inactivity warnings.
 */
export function useActivityTracker() {
  const lastActivityRef = useRef<number>(Date.now());
  // REMOVED: refreshTimerRef - no longer doing proactive refreshes
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activityEventCountRef = useRef<number>(0);
  const lastCallTimeRef = useRef<number>(0);

  useEffect(() => {
    // Clear all timers when session expires
    const handleSessionExpired = () => {
      log.debug("Session expired, clearing all timers");
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };

    // Listen for session-expired event
    window.addEventListener("session-expired", handleSessionExpired);

    // Update last activity time on user interaction (throttled to 1s)
    const updateActivity = () => {
      const now = Date.now();
      if (now - lastCallTimeRef.current < 1000) return;
      lastCallTimeRef.current = now;

      activityEventCountRef.current++;
      lastActivityRef.current = now;

      resetTimers();
    };

    const resetTimers = () => {
      // Clear existing timers
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }

      // REMOVED: Proactive token refresh interval
      // Backend sliding window middleware now handles all proactive refreshes (5min threshold)
      // Frontend only refreshes reactively on 401 responses

      // Set up warning timer - warn 3 minutes before timeout
      const warningDelay = INACTIVITY_TIMEOUT - WARN_BEFORE_TIMEOUT;
      warningTimerRef.current = setTimeout(() => {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        const minutesRemaining = Math.ceil(
          (INACTIVITY_TIMEOUT - timeSinceLastActivity) / 60000
        );

        if (minutesRemaining > 0) {
          window.dispatchEvent(
            new CustomEvent("session-expiring", {
              detail: { minutesRemaining },
            })
          );
        }
      }, warningDelay);

      // Set up inactivity timer - expire session after 1 hour of inactivity
      inactivityTimerRef.current = setTimeout(() => {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;

        // Double-check inactivity before expiring
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
          window.dispatchEvent(new CustomEvent("session-expired"));
        }
      }, INACTIVITY_TIMEOUT);
    };

    // Events that count as user activity
    const events = [
      "mousedown",
      "mousemove",
      "keypress",
      "scroll",
      "touchstart",
      "click",
    ];

    // Use passive listeners for scroll/touch for better performance
    const passiveEvents = ["scroll", "touchstart"];

    events.forEach((event) => {
      const options = passiveEvents.includes(event)
        ? { passive: true }
        : undefined;
      window.addEventListener(event, updateActivity, options);
    });

    // Initialize timers
    resetTimers();

    // Cleanup
    return () => {
      window.removeEventListener("session-expired", handleSessionExpired);

      events.forEach((event) => {
        window.removeEventListener(event, updateActivity);
      });

      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
    };
  }, []);
}
