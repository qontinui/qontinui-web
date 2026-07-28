"use client";

import { useEffect } from "react";

/**
 * Run `reset` when the page is restored from the browser's back/forward cache.
 *
 * The problem it solves: a control that navigates AWAY from the app (an
 * external OAuth/install hop) sets an in-flight flag and deliberately never
 * clears it, because the document is leaving. But a cross-origin nav is exactly
 * the case where the browser may put this document in the bfcache with its JS
 * heap intact — so pressing Back restores React state as it was, with the flag
 * still true and the page's only call-to-action stuck disabled, spinning, with
 * no error and no retry short of a manual reload.
 *
 * `pageshow` with `event.persisted` is the standard signal for that restore; a
 * normal (non-cached) back re-executes the module and needs nothing.
 */
export function useResetOnBackNavigation(reset: () => void): void {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [reset]);
}
