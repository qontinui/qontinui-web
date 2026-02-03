/**
 * DOM Observation Utilities for Tutorials
 *
 * Provides hooks for observing DOM changes, element appearance/disappearance,
 * and visibility changes. Used for event-driven tutorial progression.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Types of DOM observation
 */
export type ObservationType = "appear" | "disappear" | "change" | "visible";

/**
 * Options for DOM observation
 */
export interface DOMObserverOptions {
  /** Type of change to observe */
  type: ObservationType;
  /** Callback when observation triggers */
  onTrigger?: () => void;
  /** Whether observation is currently active */
  enabled?: boolean;
  /** Root element for IntersectionObserver (for visibility) */
  root?: Element | null;
  /** Threshold for visibility (0-1) */
  visibilityThreshold?: number;
  /** Debounce time in ms for change events */
  debounce?: number;
}

/**
 * Result of DOM observation
 */
export interface DOMObserverResult {
  /** Whether the observed condition is currently true */
  isTriggered: boolean;
  /** The observed element (if found) */
  element: HTMLElement | null;
  /** Reset the triggered state */
  reset: () => void;
}

/**
 * Hook for observing a single DOM element
 *
 * @param selector - CSS selector for the element to observe
 * @param options - Observation options
 * @returns Observation result
 */
export function useDOMObserver(
  selector: string,
  options: DOMObserverOptions
): DOMObserverResult {
  const { type, onTrigger, enabled = true, visibilityThreshold = 0.5, debounce = 0 } = options;

  const [isTriggered, setIsTriggered] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | IntersectionObserver | null>(null);

  const reset = useCallback(() => {
    setIsTriggered(false);
  }, []);

  const handleTrigger = useCallback(() => {
    if (debounce > 0) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        setIsTriggered(true);
        onTrigger?.();
      }, debounce);
    } else {
      setIsTriggered(true);
      onTrigger?.();
    }
  }, [debounce, onTrigger]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }

    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    const targetElement = document.querySelector<HTMLElement>(selector);

    if (type === "appear") {
      // Check if element already exists
      if (targetElement) {
        setElement(targetElement);
        handleTrigger();
        return;
      }

      // Watch for element to appear
      const mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            const found = document.querySelector<HTMLElement>(selector);
            if (found) {
              setElement(found);
              handleTrigger();
              mutationObserver.disconnect();
              return;
            }
          }
        }
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      observerRef.current = mutationObserver;
    } else if (type === "disappear") {
      // If element doesn't exist, already triggered
      if (!targetElement) {
        setElement(null);
        handleTrigger();
        return;
      }

      setElement(targetElement);

      // Watch for element to disappear
      const mutationObserver = new MutationObserver(() => {
        const stillExists = document.querySelector<HTMLElement>(selector);
        if (!stillExists) {
          setElement(null);
          handleTrigger();
          mutationObserver.disconnect();
        }
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      observerRef.current = mutationObserver;
    } else if (type === "change") {
      if (!targetElement) {
        return;
      }

      setElement(targetElement);

      // Watch for changes to the element
      const mutationObserver = new MutationObserver(() => {
        handleTrigger();
      });

      mutationObserver.observe(targetElement, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });

      observerRef.current = mutationObserver;
    } else if (type === "visible") {
      if (!targetElement) {
        return;
      }

      setElement(targetElement);

      // Use IntersectionObserver for visibility
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= visibilityThreshold) {
              handleTrigger();
              intersectionObserver.disconnect();
              return;
            }
          }
        },
        {
          root: options.root,
          threshold: visibilityThreshold,
        }
      );

      intersectionObserver.observe(targetElement);
      observerRef.current = intersectionObserver;
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [selector, type, enabled, handleTrigger, visibilityThreshold, options.root]);

  return { isTriggered, element, reset };
}

/**
 * Observe multiple elements simultaneously
 */
export function useDOMObserverMultiple(
  selectors: string[],
  options: Omit<DOMObserverOptions, "type"> & { type: "appear" }
): { isTriggered: boolean; elements: (HTMLElement | null)[]; reset: () => void } {
  const [isTriggered, setIsTriggered] = useState(false);
  const [elements, setElements] = useState<(HTMLElement | null)[]>(
    selectors.map(() => null)
  );
  const observerRef = useRef<MutationObserver | null>(null);

  const reset = useCallback(() => {
    setIsTriggered(false);
    setElements(selectors.map(() => null));
  }, [selectors]);

  useEffect(() => {
    if (!options.enabled || typeof document === "undefined") {
      return;
    }

    const checkElements = () => {
      const foundElements = selectors.map((selector) =>
        document.querySelector<HTMLElement>(selector)
      );
      setElements(foundElements);

      if (foundElements.every((el) => el !== null)) {
        setIsTriggered(true);
        options.onTrigger?.();
        return true;
      }
      return false;
    };

    // Check if all elements already exist
    if (checkElements()) {
      return;
    }

    // Watch for elements to appear
    const mutationObserver = new MutationObserver(() => {
      if (checkElements()) {
        mutationObserver.disconnect();
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    observerRef.current = mutationObserver;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [selectors, options]);

  return { isTriggered, elements, reset };
}

/**
 * Simple hook to check if an element exists in the DOM
 */
export function useElementExists(selector: string): boolean {
  const [exists, setExists] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const checkExists = () => {
      setExists(document.querySelector(selector) !== null);
    };

    // Initial check
    checkExists();

    // Watch for changes
    const mutationObserver = new MutationObserver(checkExists);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
    };
  }, [selector]);

  return exists;
}

/**
 * Simple hook to check if an element is visible in the viewport
 */
export function useElementVisible(
  selector: string,
  threshold = 0.5
): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const element = document.querySelector(selector);
    if (!element) {
      setIsVisible(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting && entry.intersectionRatio >= threshold);
        }
      },
      { threshold }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [selector, threshold]);

  return isVisible;
}
