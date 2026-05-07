/**
 * runner-detection.ts
 *
 * Helper for runner-dependent E2E specs. The qontinui-runner desktop
 * app exposes its HTTP API on http://localhost:9876; the web frontend
 * fetches `/spec/list` + `/spec/subscribe` from there to populate
 * runner-aware pages (build/*, /execute, /chat, /configure/*, etc.).
 *
 * CI never starts a runner, so those pages render `RunnerOfflineState`
 * ("Runner Not Connected"). Specs that assert against runner-driven
 * elements have nothing meaningful to check in that state — they fail
 * uselessly with element-not-found.
 *
 * `requireRunner()` probes :9876/health once per worker (cached) and
 * calls Playwright's `test.skip()` when the runner is unreachable.
 * Use it in a top-level `test.beforeAll` so the whole spec file skips:
 *
 *   import { test } from "../fixtures";
 *   import { requireRunner } from "../runner-detection";
 *
 *   test.beforeAll(async () => {
 *     await requireRunner();
 *   });
 *
 * In CI: skipped (no runner). Locally with a runner up: runs as normal.
 */
import { test } from "@playwright/test";

const RUNNER_HEALTH_URL = "http://localhost:9876/health";
const PROBE_TIMEOUT_MS = 2000;

let cachedAvailability: boolean | null = null;

async function probeRunner(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(RUNNER_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function isRunnerAvailable(): Promise<boolean> {
  if (cachedAvailability === null) {
    cachedAvailability = await probeRunner();
  }
  return cachedAvailability;
}

export async function requireRunner(): Promise<void> {
  const available = await isRunnerAvailable();
  test.skip(
    !available,
    "Requires Qontinui runner on http://localhost:9876 — start the runner desktop app to exercise these specs."
  );
}
