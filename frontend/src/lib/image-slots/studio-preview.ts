/**
 * Is this page a qontinui-studio preview? Studio's D7 gate (plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 19) loads a preview
 * with `?studio_batch=<id>&studio_attempt=<n>` and refuses a slot image whose
 * `loading` is `lazy`, so `<SlotImage>` renders `eager` there.
 *
 * Read through `useSyncExternalStore` so the answer is never guessed: the
 * server (and the static HTML) cannot see the query string, so its snapshot
 * is `null` (UNKNOWN), for which `<SlotImage>` omits `loading` altogether,
 * the browser's eager default, rather than rendering `lazy` into a preview.
 * The client snapshot reads `window.location.search` directly, which needs
 * no Suspense boundary in a statically rendered route.
 */

import { useSyncExternalStore } from "react";

/** The query parameter that marks a studio preview load. */
export const STUDIO_BATCH_PARAM = "studio_batch";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function clientSnapshot(): boolean {
  return new URLSearchParams(window.location.search).has(STUDIO_BATCH_PARAM);
}

function serverSnapshot(): null {
  return null;
}

/** `true` on a studio preview, `false` otherwise, `null` while unknown
 *  (server render, and hydration's first pass). */
export function useStudioPreview(): boolean | null {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
