/**
 * GET a path on a paired runner named only by its device id.
 *
 * Goes through the app's one runner transport resolver (`runnerRequest`,
 * `@/lib/runner/api-client`). A runner named by device id alone carries no
 * port, so it can never be proven local and the resolver always takes the
 * relay (`@/lib/runner/relay` — the one relay client), which reaches the
 * runner by device id from any origin. The runner's Spec API and live UI
 * Bridge snapshot are on its relay allowlist.
 *
 * This module keeps the digital twin's error shape: a {@link RunnerRelayError}
 * carrying the backend's relay diagnostics.
 */

import { runnerRequest, RunnerApiError } from "@/lib/runner/api-client";
import {
  readRelayDiagnostics,
  type RunnerRelayDiagnostics,
} from "@/lib/runner/relay";
import type { RunnerTarget } from "@/lib/runner/target";

export type { RunnerRelayDiagnostics } from "@/lib/runner/relay";

export class RunnerRelayError extends Error {
  readonly detail?: string;
  readonly deviceId?: string;
  readonly wsConnectedAt?: string | null;
  readonly lastSeenAt?: string | null;
  readonly requestId?: string;
  /** The typed RunnerApiError code, when the resolver refused (e.g. RUNNER_NEEDS_LOCAL). */
  readonly code?: string;

  constructor(
    message: string,
    readonly status?: number,
    diagnostics: RunnerRelayDiagnostics = {},
    code?: string
  ) {
    super(message);
    this.name = "RunnerRelayError";
    this.detail = diagnostics.detail;
    this.deviceId = diagnostics.deviceId;
    this.wsConnectedAt = diagnostics.wsConnectedAt;
    this.lastSeenAt = diagnostics.lastSeenAt;
    this.requestId = diagnostics.requestId;
    this.code = code;
  }
}

/**
 * GET `runnerPath` (e.g. `apps/qontinui-web/spec/list`) on `deviceId`'s runner
 * and parse the JSON body. Throws {@link RunnerRelayError} on a transport
 * failure or non-2xx so React Query surfaces it as an error state.
 */
export async function runnerProxyGet<T>(
  deviceId: string,
  runnerPath: string,
  opts?: { timeoutMs?: number }
): Promise<T> {
  const path = runnerPath.replace(/^\//, "");
  const target: RunnerTarget = {
    kind: "runner",
    runner: { id: deviceId },
    locality: undefined,
  };

  let resp: Response;
  try {
    resp = await runnerRequest(target, `/${path}`, {
      method: "GET",
      timeoutMs: opts?.timeoutMs,
    });
  } catch (err) {
    if (err instanceof RunnerApiError) {
      throw new RunnerRelayError(
        err.message,
        err.status || undefined,
        {},
        err.code
      );
    }
    throw new RunnerRelayError(
      err instanceof Error ? err.message : "runner not reachable"
    );
  }
  if (!resp.ok) {
    const diagnostics = await readRelayDiagnostics(resp);
    // Put `detail` and the request id in the message itself: this string is
    // what React Query surfaces and what lands in the console, and the id is
    // only useful if the person reading it can see it.
    const because = diagnostics.detail ? `: ${diagnostics.detail}` : "";
    const ref = diagnostics.requestId
      ? ` (request ${diagnostics.requestId})`
      : "";
    throw new RunnerRelayError(
      `runner returned HTTP ${resp.status} for ${path}${because}${ref}`,
      resp.status,
      diagnostics
    );
  }
  return (await resp.json()) as T;
}
