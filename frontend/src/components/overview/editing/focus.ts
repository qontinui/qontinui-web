"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Move focus to an element once the render that shows it has committed.
 *
 * `requestAnimationFrame(() => ref.current?.focus())` loses when the state
 * change that mounts the element was made after an `await`: that render runs
 * as a scheduler task, a frame can fall first, and the callback finds nothing
 * to focus. Requesting focus in the same update as the state change, and
 * acting on it in a layout effect, focuses exactly the element that render
 * mounted.
 */
export function useFocusAfterRender(): (
  target: RefObject<HTMLElement | null>
) => void {
  const pending = useRef<RefObject<HTMLElement | null> | null>(null);
  const [request, setRequest] = useState(0);
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    target.current?.focus();
  }, [request]);
  return useCallback((target) => {
    pending.current = target;
    setRequest((n) => n + 1);
  }, []);
}
