"use client";

/**
 * Extraction screenshots as object URLs, fetched from the ACTIVE runner.
 *
 * Every view that shows an extraction screenshot goes through one of these
 * two hooks instead of calling `runnerClient.getExtractionScreenshot` and
 * `URL.createObjectURL` itself. Both fetch through the per-request transport
 * resolver (loopback for a runner proven local, the relay otherwise), revoke
 * every object URL they create, and are keyed by the runner target — so a
 * runner switch re-fetches from the new runner instead of showing the old
 * one's image.
 *
 * - {@link useExtractionScreenshot}: one screenshot (`useRunnerObjectUrl`).
 * - {@link useExtractionScreenshotCache}: a per-view cache for views that
 *   draw several screenshots on demand; every URL it created is revoked when
 *   the runner or the extraction changes and on unmount.
 *
 * The runner's image routes may not be on its relay allowlist; a refused
 * path comes back as `errorCode === RUNNER_NEEDS_LOCAL`, whose message says
 * the action needs the runner on this machine. Render it with
 * {@link screenshotErrorText} rather than a broken image.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRunnerObjectUrl,
  RUNNER_NEEDS_LOCAL,
  RunnerApiError,
  targetKey,
  useRunnerObjectUrl,
  useRunnerTarget,
  type RunnerObjectUrlState,
} from "@/lib/runner";
import { extractionScreenshotPath } from "@/lib/runner-client/extraction-client";

/** A failed screenshot load: the message and the typed runner error code. */
export interface ScreenshotLoadError {
  message: string;
  code: string | null;
}

/**
 * The text to show for a failed screenshot load: the runner's own
 * "needs the runner on this machine" message for a relay-refused path, the
 * caller's fallback otherwise.
 */
export function screenshotErrorText(
  error: ScreenshotLoadError | null | undefined,
  fallback: string
): string {
  if (error?.code === RUNNER_NEEDS_LOCAL) return error.message;
  return fallback;
}

/** The {@link ScreenshotLoadError} of a `useRunnerObjectUrl` state, if any. */
export function objectUrlError(
  state: RunnerObjectUrlState
): ScreenshotLoadError | null {
  return state.error === null
    ? null
    : { message: state.error, code: state.errorCode };
}

/** One extraction screenshot as an object URL (null ids → nothing fetched). */
export function useExtractionScreenshot(
  extractionId: string | null | undefined,
  screenshotId: string | null | undefined
): RunnerObjectUrlState {
  const target = useRunnerTarget();
  const path =
    extractionId && screenshotId
      ? extractionScreenshotPath(extractionId, screenshotId)
      : null;
  return useRunnerObjectUrl(target, path);
}

export interface ExtractionScreenshotCache {
  /** Object URLs of the screenshots loaded so far, by screenshot id. */
  urls: ReadonlyMap<string, string>;
  /** Screenshot ids being fetched. */
  loading: ReadonlySet<string>;
  /** Failed loads, by screenshot id. */
  errors: ReadonlyMap<string, ScreenshotLoadError>;
  /**
   * Load a screenshot (a no-op returning the cached URL when loaded, and
   * null while it is in flight or when it fails). Stable while the runner
   * and the extraction are unchanged.
   */
  load: (screenshotId: string) => Promise<string | null>;
}

/** A per-view cache of extraction screenshots; see the module comment. */
export function useExtractionScreenshotCache(
  extractionId: string | null | undefined
): ExtractionScreenshotCache {
  const target = useRunnerTarget();
  const key = targetKey(target);
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Map<string, ScreenshotLoadError>>(
    () => new Map()
  );
  // What this cache created (and so must revoke), and what is in flight, for
  // the current runner + extraction. `generation` discards a load that
  // settles after either changed.
  const owned = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);

  useEffect(() => {
    const ownedNow = owned.current;
    const inflightNow = inflight.current;
    setUrls(new Map());
    setLoading(new Set());
    setErrors(new Map());
    return () => {
      generation.current += 1;
      ownedNow.forEach((url) => URL.revokeObjectURL(url));
      ownedNow.clear();
      inflightNow.clear();
    };
  }, [key, extractionId]);

  const load = useCallback(
    async (screenshotId: string): Promise<string | null> => {
      if (!extractionId) return null;
      const cached = owned.current.get(screenshotId);
      if (cached) return cached;
      if (inflight.current.has(screenshotId)) return null;

      const gen = generation.current;
      inflight.current.add(screenshotId);
      setLoading((prev) => new Set(prev).add(screenshotId));
      setErrors((prev) => {
        if (!prev.has(screenshotId)) return prev;
        const next = new Map(prev);
        next.delete(screenshotId);
        return next;
      });
      try {
        const url = await fetchRunnerObjectUrl(
          target,
          extractionScreenshotPath(extractionId, screenshotId)
        );
        if (gen !== generation.current) {
          URL.revokeObjectURL(url);
          return null;
        }
        owned.current.set(screenshotId, url);
        setUrls((prev) => new Map(prev).set(screenshotId, url));
        return url;
      } catch (err) {
        if (gen === generation.current) {
          const error: ScreenshotLoadError = {
            message: err instanceof Error ? err.message : String(err),
            code: err instanceof RunnerApiError ? (err.code ?? null) : null,
          };
          setErrors((prev) => new Map(prev).set(screenshotId, error));
        }
        return null;
      } finally {
        if (gen === generation.current) {
          inflight.current.delete(screenshotId);
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(screenshotId);
            return next;
          });
        }
      }
    },
    [target, extractionId]
  );

  return { urls, loading, errors, load };
}
