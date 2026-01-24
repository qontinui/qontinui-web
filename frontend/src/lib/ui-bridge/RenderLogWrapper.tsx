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

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUIBridgeOptional } from "ui-bridge/react";

export interface RenderLogWrapperProps {
  children: ReactNode;
  /** Enable capture on mount (default: true) */
  enableOnMount?: boolean;
  /** Enable mutation observer for DOM changes (default: true) */
  enableMutationObserver?: boolean;
  /** Debounce time for mutation captures in ms (default: 500) */
  mutationDebounceMs?: number;
}

/**
 * Wrapper component that enables automatic render log capturing.
 *
 * Place this at the root of your app (inside UIBridgeProvider) for
 * comprehensive DOM snapshot coverage.
 */
export function RenderLogWrapper({
  children,
  enableOnMount = true,
  enableMutationObserver = true,
  mutationDebounceMs = 500,
}: RenderLogWrapperProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bridge = useUIBridgeOptional();
  const isDev = process.env.NODE_ENV === "development";

  // Refs for tracking
  const lastPathRef = useRef<string | null>(null);
  const mutationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const isCapturingRef = useRef(false);

  // Full URL for change detection
  const fullPath = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");

  /**
   * Capture a DOM snapshot via ui-bridge RenderLogManager
   */
  const captureSnapshot = useCallback(
    async (trigger: string, metadata?: Record<string, unknown>) => {
      if (!isDev || !bridge?.renderLog || isCapturingRef.current) return;

      isCapturingRef.current = true;

      try {
        // Wait a frame for DOM to settle
        await new Promise((resolve) => requestAnimationFrame(resolve));

        await bridge.renderLog.captureSnapshot({
          trigger,
          pathname,
          ...metadata,
        });

        console.debug(`[RenderLogWrapper] Captured snapshot: ${trigger}`);
      } catch (error) {
        console.debug("[RenderLogWrapper] Failed to capture snapshot:", error);
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
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
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
              (classAttr.includes("animate-") || classAttr.includes("transition-"))
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
      attributeFilter: ["class", "data-state", "data-selected", "aria-expanded", "aria-hidden"],
    });

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (mutationTimeoutRef.current) {
        clearTimeout(mutationTimeoutRef.current);
      }
    };
  }, [isDev, bridge, enableMutationObserver, mutationDebounceMs, captureSnapshot]);

  return <>{children}</>;
}
