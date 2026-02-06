/**
 * Event-Driven Tutorial Progression Hook
 *
 * Implements event-driven step progression inspired by Node-RED's tour system.
 * Steps can wait for DOM events, element appearance, custom app actions, or route changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { StepWaitCondition, TourState } from "@/types/tutorial";

/**
 * Custom event for app actions
 */
const TUTORIAL_ACTION_EVENT = "tutorial-action";

/**
 * Dispatch a tutorial action event
 */
export function dispatchTutorialAction(
  actionName: string,
  data?: unknown
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(TUTORIAL_ACTION_EVENT, {
      detail: { actionName, data },
    })
  );
}

export interface UseTutorialEventsOptions {
  /** The wait condition for the current step */
  waitCondition: StepWaitCondition | null | undefined;
  /** Current tour state for filter functions */
  tourState: TourState;
  /** Callback when the wait condition is satisfied */
  onAdvance: () => void;
  /** Whether event listening is enabled */
  enabled?: boolean;
}

export interface UseTutorialEventsResult {
  /** Whether currently waiting for an event */
  isWaiting: boolean;
  /** Whether the wait condition has timed out */
  isTimedOut: boolean;
  /** Hint message to show (on timeout) */
  hintMessage: string | null;
  /** Whether the user can skip this step */
  canSkip: boolean;
  /** Notify the tutorial of a custom app action */
  notifyAction: (actionName: string, data?: unknown) => void;
}

/**
 * Hook for event-driven tutorial step progression
 *
 * Supports four event types:
 * - dom-event: Wait for a DOM event (click, input, etc.) on an element
 * - dom-appear: Wait for an element to appear in the DOM
 * - app-action: Wait for a custom application action
 * - route-change: Wait for navigation to a specific route
 */
export function useTutorialEvents(
  options: UseTutorialEventsOptions
): UseTutorialEventsResult {
  const { waitCondition, tourState, onAdvance, enabled = true } = options;

  const [isWaiting, setIsWaiting] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [canSkip, setCanSkip] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const previousPathRef = useRef(pathname);

  // Notify action function (for external use)
  const notifyAction = useCallback((actionName: string, data?: unknown) => {
    dispatchTutorialAction(actionName, data);
  }, []);

  // Handle successful event
  const handleEventSuccess = useCallback(() => {
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Apply advance delay if specified
    const delay = waitCondition?.advanceDelay ?? 0;
    if (delay > 0) {
      advanceDelayRef.current = setTimeout(() => {
        setIsWaiting(false);
        setIsTimedOut(false);
        setHintMessage(null);
        setCanSkip(false);
        onAdvance();
      }, delay);
    } else {
      setIsWaiting(false);
      setIsTimedOut(false);
      setHintMessage(null);
      setCanSkip(false);
      onAdvance();
    }
  }, [waitCondition?.advanceDelay, onAdvance]);

  // Handle timeout
  const handleTimeout = useCallback(() => {
    setIsTimedOut(true);
    setHintMessage(waitCondition?.hint ?? null);
    setCanSkip(waitCondition?.onTimeout === "allow-skip");
  }, [waitCondition?.hint, waitCondition?.onTimeout]);

  // Set up event listeners based on wait condition type
  useEffect(() => {
    if (!enabled || !waitCondition || typeof window === "undefined") {
      setIsWaiting(false);
      return;
    }

    setIsWaiting(true);
    setIsTimedOut(false);
    setHintMessage(null);
    setCanSkip(false);

    // Set up timeout if specified
    if (waitCondition.timeout) {
      timeoutRef.current = setTimeout(handleTimeout, waitCondition.timeout);
    }

    const { type, selector, event, actionName, route, filter } = waitCondition;

    // Event handler with filter support
    const checkFilter = (eventData: unknown): boolean => {
      if (!filter) return true;
      try {
        return filter(eventData, tourState);
      } catch (error) {
        console.error("Tutorial filter error:", error);
        return false;
      }
    };

    let cleanup: (() => void) | undefined;

    switch (type) {
      case "dom-event": {
        if (!selector || !event) {
          console.warn("dom-event requires selector and event");
          break;
        }

        const element = document.querySelector(selector);
        if (!element) {
          console.warn(`Element not found: ${selector}`);
          break;
        }

        const handleDOMEvent = (e: Event) => {
          if (checkFilter(e)) {
            handleEventSuccess();
          }
        };

        element.addEventListener(event, handleDOMEvent);
        cleanup = () => element.removeEventListener(event, handleDOMEvent);
        break;
      }

      case "dom-appear": {
        if (!selector) {
          console.warn("dom-appear requires selector");
          break;
        }

        // Check if element already exists
        const existing = document.querySelector(selector);
        if (existing) {
          handleEventSuccess();
          break;
        }

        // Watch for element to appear
        const observer = new MutationObserver(() => {
          const found = document.querySelector(selector);
          if (found && checkFilter(found)) {
            observer.disconnect();
            handleEventSuccess();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        cleanup = () => observer.disconnect();
        break;
      }

      case "app-action": {
        if (!actionName) {
          console.warn("app-action requires actionName");
          break;
        }

        const handleAction = (e: Event) => {
          const customEvent = e as CustomEvent<{
            actionName: string;
            data?: unknown;
          }>;
          if (
            customEvent.detail.actionName === actionName &&
            checkFilter(customEvent.detail.data)
          ) {
            handleEventSuccess();
          }
        };

        window.addEventListener(TUTORIAL_ACTION_EVENT, handleAction);
        cleanup = () =>
          window.removeEventListener(TUTORIAL_ACTION_EVENT, handleAction);
        break;
      }

      case "route-change": {
        if (!route) {
          console.warn("route-change requires route");
          break;
        }

        // Check if already on the target route
        if (pathname === route || pathname?.startsWith(route)) {
          handleEventSuccess();
        }
        // Route change will be detected in the pathname effect below
        break;
      }
    }

    return () => {
      cleanup?.();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (advanceDelayRef.current) {
        clearTimeout(advanceDelayRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitCondition, enabled, tourState, handleTimeout, handleEventSuccess]);

  // Handle route changes
  useEffect(() => {
    if (
      !enabled ||
      !waitCondition ||
      waitCondition.type !== "route-change" ||
      !waitCondition.route
    ) {
      return;
    }

    // Check if route changed to target
    if (
      pathname !== previousPathRef.current &&
      (pathname === waitCondition.route ||
        pathname?.startsWith(waitCondition.route))
    ) {
      handleEventSuccess();
    }

    previousPathRef.current = pathname;
  }, [pathname, waitCondition, enabled, handleEventSuccess]);

  return {
    isWaiting: isWaiting && !!waitCondition,
    isTimedOut,
    hintMessage,
    canSkip,
    notifyAction,
  };
}

/**
 * Hook to access the notifyAction function without the full event system
 */
export function useTutorialNotify(): (
  actionName: string,
  data?: unknown
) => void {
  return useCallback((actionName: string, data?: unknown) => {
    dispatchTutorialAction(actionName, data);
  }, []);
}
