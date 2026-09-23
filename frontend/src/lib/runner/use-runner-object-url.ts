"use client";

/**
 * A runner-served binary (a screenshot, a captured frame) as an object URL
 * for `<img src>`.
 *
 * A plain `<img src="http://127.0.0.1:<port>/...">` can only reach a runner on
 * this machine, and can reach the WRONG one (whatever owns that port here);
 * it cannot ride the relay either, which needs the device-id header and the
 * app's bearer. So the bytes are fetched through the one resolver
 * (`runnerRequest`: loopback when proven local, the relay otherwise) and
 * handed to the image as an object URL, revoked when it changes or unmounts.
 *
 * A path the relay does not carry (the runner's image routes are not on its
 * relay allowlist) surfaces as `errorCode === RUNNER_NEEDS_LOCAL` — render
 * "this needs the runner on this machine", not a broken image.
 */

import { useEffect, useState } from "react";
import { runnerRequest, RunnerApiError } from "./api-client";
import { targetKey, type RunnerTarget } from "./target";

export interface RunnerObjectUrlState {
  /** The object URL, or null while loading / on error / with no path. */
  url: string | null;
  isLoading: boolean;
  error: string | null;
  /** The typed RunnerApiError code (e.g. RUNNER_NEEDS_LOCAL), if any. */
  errorCode: string | null;
}

/** Fetch a runner binary once and return it as an object URL (caller revokes). */
export async function fetchRunnerObjectUrl(
  target: RunnerTarget,
  path: string,
  init?: RequestInit
): Promise<string> {
  const response = await runnerRequest(target, path, init);
  if (!response.ok) {
    throw new RunnerApiError(
      response.status,
      `Runner API error: ${response.status} ${response.statusText} (${path.split("?")[0]})`
    );
  }
  return URL.createObjectURL(await response.blob());
}

export function useRunnerObjectUrl(
  target: RunnerTarget,
  path: string | null
): RunnerObjectUrlState {
  const key = targetKey(target);
  const [state, setState] = useState<RunnerObjectUrlState>({
    url: null,
    isLoading: path !== null,
    error: null,
    errorCode: null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ url: null, isLoading: false, error: null, errorCode: null });
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, isLoading: true, error: null, errorCode: null });
    fetchRunnerObjectUrl(target, path).then(
      (url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setState({ url, isLoading: false, error: null, errorCode: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          url: null,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof RunnerApiError ? (err.code ?? null) : null,
        });
      }
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // Keyed by the target's route key; the object identity may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path]);

  return state;
}
