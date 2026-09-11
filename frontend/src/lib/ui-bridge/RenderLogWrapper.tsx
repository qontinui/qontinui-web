"use client";

/**
 * RenderLogWrapper
 *
 * A React component wrapper that enables automatic DOM snapshot capturing
 * for comprehensive render logging across the entire application.
 *
 * Features:
 * - Captures DOM snapshots on route/page changes
 * - Captures on significant DOM mutations (debounced)
 * - Captures on mount
 * - Works with Next.js App Router
 */

import {
  useEffect,
  useRef,
  useCallback,
  Suspense,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUIBridgeOptional } from "@qontinui/ui-bridge/react";
import { createLogger } from "@/lib/logger";

const log = createLogger("RenderLogWrapper");

export interface RenderLogTrackerProps {
  /** Enable capture on mount (default: true) */
  enableOnMount?: boolean;
  /** Enable mutation observer for DOM changes (default: true) */
  enableMutationObserver?: boolean;
  /** Debounce time for mutation captures in ms (default: 500) */
  mutationDebounceMs?: number;
}

export interface RenderLogWrapperProps extends RenderLogTrackerProps {
  children: ReactNode;
}

/**
 * Headless render-log tracker. Renders nothing; all of its work is in
 * effects. Mounted by `RenderLogWrapper` below.
 */
function RenderLogTracker({
  enableOnMount = true,
  enableMutationObserver = false, // Disabled by default - DOM snapshot capture is expensive (several MB per snapshot)
  mutationDebounceMs = 500,
}: RenderLogTrackerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bridge = useUIBridgeOptional();
  const isDev = process.env.NODE_ENV === "development";

  // Refs for tracking
  const lastPathRef = useRef<string | null>(null);
  const mutationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const isCapturingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Full URL for change detection
  const fullPath =
    pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");

  /**
   * Capture a DOM snapshot via ui-bridge RenderLogManager
   */
  // Track mount state for async cleanup safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const captureSnapshot = useCallback(
    async (trigger: string, metadata?: Record<string, unknown>) => {
      if (
        !isDev ||
        !bridge?.renderLog ||
        isCapturingRef.current ||
        !isMountedRef.current
      )
        return;

      isCapturingRef.current = true;

      try {
        // Wait a frame for DOM to settle
        await new Promise((resolve) => requestAnimationFrame(resolve));

        await bridge.renderLog.captureSnapshot({
          trigger,
          pathname,
          ...metadata,
        });

        log.debug(`Captured snapshot: ${trigger}`);
      } catch (error) {
        log.debug("Failed to capture snapshot:", error);
      } finally {
        isCapturingRef.current = false;
      }
    },
    [isDev, bridge, pathname]
  );

  /**
   * Capture on route change
   */
  useEffect(() => {
    if (!isDev || !bridge?.renderLog) return;

    // Skip if path hasn't changed
    if (lastPathRef.current === fullPath) return;
    const previousPath = lastPathRef.current;
    lastPathRef.current = fullPath;

    // Skip initial mount (handled separately)
    if (previousPath === null && enableOnMount) return;

    // Delay slightly to let new content render
    const timeoutId = setTimeout(() => {
      captureSnapshot("route_change", {
        previousPath,
        newPath: fullPath,
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [fullPath, isDev, bridge, captureSnapshot, enableOnMount]);

  /**
   * Capture on mount
   */
  useEffect(() => {
    if (!isDev || !bridge?.renderLog || !enableOnMount) return;

    // Delay to let initial render complete
    const timeoutId = setTimeout(() => {
      captureSnapshot("mount");
      lastPathRef.current = fullPath;
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDev, bridge]); // Only on mount

  /**
   * Setup MutationObserver for significant DOM changes
   */
  useEffect(() => {
    if (!isDev || !bridge?.renderLog || !enableMutationObserver) return;

    const observer = new MutationObserver((mutations) => {
      // Filter for significant mutations
      const significantMutation = mutations.some((mutation) => {
        // Added/removed element nodes
        if (
          mutation.addedNodes.length > 0 ||
          mutation.removedNodes.length > 0
        ) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              // Skip script/style/svg internals
              if (["SCRIPT", "STYLE", "SVG"].includes(el.tagName)) continue;
              // Skip elements marked for no capture
              if (el.hasAttribute("data-no-capture")) continue;
              return true;
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return true;
            }
          }
        }

        // Significant attribute changes
        if (mutation.type === "attributes") {
          const attrName = mutation.attributeName || "";
          if (attrName.startsWith("data-") && attrName !== "data-no-capture") {
            return true;
          }
          // Skip animation-related class changes
          if (attrName === "class") {
            const el = mutation.target as Element;
            // Use getAttribute to get string (className can be SVGAnimatedString for SVG elements)
            const classAttr = el.getAttribute("class");
            if (
              typeof classAttr === "string" &&
              (classAttr.includes("animate-") ||
                classAttr.includes("transition-"))
            ) {
              return false;
            }
          }
        }

        return false;
      });

      if (significantMutation) {
        // Debounce the capture
        if (mutationTimeoutRef.current) {
          clearTimeout(mutationTimeoutRef.current);
        }

        mutationTimeoutRef.current = setTimeout(() => {
          captureSnapshot("mutation");
        }, mutationDebounceMs);
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "data-state",
        "data-selected",
        "aria-expanded",
        "aria-hidden",
      ],
    });

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (mutationTimeoutRef.current) {
        clearTimeout(mutationTimeoutRef.current);
      }
    };
  }, [
    isDev,
    bridge,
    enableMutationObserver,
    mutationDebounceMs,
    captureSnapshot,
  ]);

  // Renders nothing: this component exists only for its effects. Keeping the
  // app tree OUT of it is the point — see RenderLogWrapper below.
  return null;
}

/**
 * `useSearchParams()` (in the tracker above) must sit under a Suspense
 * boundary. It used to be the app tree that sat there: the boundary wrapped
 * `{children}`, i.e. EVERY page, so React's streaming SSR was free to defer
 * the whole document body out-of-order behind a `null` fallback. The served
 * HTML then carried an empty `<main>` plus the real page parked in a
 * `<div hidden id="S:n">` staging container, revealed only once React ran
 * `$RC`/`$RV` on the client (a rAF- and ~300 ms-throttled callback).
 *
 * Two things were wrong with that. For users and crawlers, the initial HTML
 * of every public page — marketing and docs included — had no content in
 * `<main>`. For the Playwright suite it meant that, for the length of the
 * reveal window, the page existed TWICE in the DOM: React's client-rendered
 * copy plus the still-hidden staged copy. `getByText()` matches hidden
 * elements, so any assertion whose first poll landed inside that window died
 * with `strict mode violation: resolved to 2 elements` (20 such failures on
 * shard 3 of run 34039419789; the same window is reproducible under
 * `next dev`, so this was never a production-only defect — the production
 * build only made the window reachable).
 *
 * The boundary belongs around the thing that actually suspends. The tracker
 * renders `null`, so nothing is deferred and `{children}` streams in the
 * shell where it belongs.
 */
export function RenderLogWrapper({
  children,
  ...trackerProps
}: RenderLogWrapperProps) {
  return (
    <>
      <Suspense fallback={null}>
        <RenderLogTracker {...trackerProps} />
      </Suspense>
      {children}
    </>
  );
}
