'use client';

import { useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 hour in milliseconds
// REMOVED: REFRESH_INTERVAL - Frontend no longer proactively refreshes tokens
// Backend sliding window middleware handles all proactive refreshes (5min threshold)
const WARN_BEFORE_TIMEOUT = 3 * 60 * 1000; // Warn 3 minutes before timeout

/**
 * Activity Tracker Hook
 *
 * Token Refresh Strategy (Aligned with Backend):
 * - REMOVED proactive token refresh interval (previously every 5 minutes)
 * - Backend sliding window middleware handles all proactive refreshes (5min threshold)
 * - Frontend only tracks user activity for inactivity warnings
 * - This prevents race conditions where both frontend and backend try to refresh simultaneously
 */
export function useActivityTracker() {
  const lastActivityRef = useRef<number>(Date.now());
  // REMOVED: refreshTimerRef - no longer doing proactive refreshes
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activityEventCountRef = useRef<number>(0);

  useEffect(() => {
    // Clear all timers when session expires
    const handleSessionExpired = () => {
      console.log('[ActivityTracker] Session expired, clearing all timers');
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };

    // Listen for session-expired event
    window.addEventListener('session-expired', handleSessionExpired);

    // Update last activity time on user interaction
    const updateActivity = (event: Event) => {
      const previousActivity = lastActivityRef.current;
      const now = Date.now();
      const timeSinceLastActivity = now - previousActivity;

      activityEventCountRef.current++;
      lastActivityRef.current = now;

      resetTimers();
    };

    const resetTimers = () => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityRef.current;

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
        const minutesRemaining = Math.ceil((INACTIVITY_TIMEOUT - timeSinceLastActivity) / 60000);

        if (minutesRemaining > 0) {
          window.dispatchEvent(new CustomEvent('session-expiring', {
            detail: { minutesRemaining }
          }));
        }
      }, warningDelay);

      // Set up inactivity timer - expire session after 1 hour of inactivity
      inactivityTimerRef.current = setTimeout(() => {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;

        // Double-check inactivity before expiring
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
          window.dispatchEvent(new CustomEvent('session-expired'));
        }
      }, INACTIVITY_TIMEOUT);
    };

    // Events that count as user activity
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    // Use passive listeners for scroll/touch for better performance
    const passiveEvents = ['scroll', 'touchstart'];

    events.forEach(event => {
      const options = passiveEvents.includes(event) ? { passive: true } : undefined;
      window.addEventListener(event, updateActivity, options);
    });

    // Initialize timers
    resetTimers();

    // Cleanup
    return () => {
      window.removeEventListener('session-expired', handleSessionExpired);

      events.forEach(event => {
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
