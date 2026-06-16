/**
 * Minimal helper to GET a path on a paired runner through the web backend's
 * device-bridge runner-proxy (`/api/v1/device-bridge/runner-proxy/{path}`).
 *
 * The proxy tunnels HTTP→WebSocket to the runner identified by the
 * `X-Qontinui-Device-Id` header (cloud relay), or to a co-located localhost
 * runner when the header is absent. It accepts arbitrary safe paths, so the
 * runner's Spec API and the live UI Bridge snapshot are both reachable with no
 * new backend code. Mirrors the relay-call idiom in `lib/co-pilot/planClient.ts`.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const RUNNER_PROXY_PREFIX = "/api/v1/device-bridge/runner-proxy/";
const DEVICE_ID_HEADER = "X-Qontinui-Device-Id";

export class RunnerRelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RunnerRelayError";
  }
}

/**
 * GET `runnerPath` (e.g. `apps/qontinui-web/spec/list`) on `deviceId`'s runner
 * via the relay and parse the JSON body. Throws {@link RunnerRelayError} on a
 * transport failure or non-2xx so React Query surfaces it as an error state.
 */
export async function runnerProxyGet<T>(
  deviceId: string,
  runnerPath: string,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const path = runnerPath.replace(/^\//, "");
  const headers: Record<string, string> = { [DEVICE_ID_HEADER]: deviceId };
  if (opts?.timeoutMs) headers["X-Qontinui-Timeout-Ms"] = String(opts.timeoutMs);

  let resp: Response;
  try {
    resp = await httpClient.fetch(
      `${ApiConfig.API_BASE_URL}${RUNNER_PROXY_PREFIX}${path}`,
      { method: "GET", headers, maxRetries: 0 },
    );
  } catch (err) {
    throw new RunnerRelayError(
      err instanceof Error ? err.message : "runner not reachable",
    );
  }
  if (!resp.ok) {
    throw new RunnerRelayError(
      `runner returned HTTP ${resp.status} for ${path}`,
      resp.status,
    );
  }
  return (await resp.json()) as T;
}
