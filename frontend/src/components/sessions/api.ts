// ============================================================================
// Sessions panel — API client
//
// Thin wrapper around the web-backend session proxy
// (`/api/v1/operations/sessions*`). Centralizes URL building, fetch
// options (credentials, error mapping), and SSE subscription so
// `page.tsx` stays declarative.
// ============================================================================

import { OPERATIONS_API } from "../operations/utils";
import type {
  SessionEventRow,
  SessionListResponse,
  SessionRow,
  TenantListResponse,
} from "./types";

/** Common fetch options — cookie-auth, no client cache. */
const DEFAULT_INIT: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

export type ListSessionsScope = "active" | "all";

export interface ListSessionsOptions {
  scope?: ListSessionsScope;
  /** RFC 3339 timestamp; incremental polling. */
  since?: string;
  signal?: AbortSignal;
}

export async function listSessions(
  opts: ListSessionsOptions = {}
): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.since) params.set("since", opts.since);

  const qs = params.toString();
  const url = `${OPERATIONS_API}/sessions${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, { ...DEFAULT_INIT, signal: opts.signal });
  if (!res.ok) {
    throw new SessionsApiError(
      `GET ${url} failed: ${res.status}`,
      res.status
    );
  }
  return (await res.json()) as SessionListResponse;
}

export async function getSession(
  id: string,
  signal?: AbortSignal
): Promise<SessionRow> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}`;
  const res = await fetch(url, { ...DEFAULT_INIT, signal });
  if (!res.ok) {
    throw new SessionsApiError(
      `GET ${url} failed: ${res.status}`,
      res.status
    );
  }
  return (await res.json()) as SessionRow;
}

export async function closeSession(id: string): Promise<SessionRow> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    ...DEFAULT_INIT,
    method: "DELETE",
  });
  if (!res.ok) {
    throw new SessionsApiError(
      `DELETE ${url} failed: ${res.status}`,
      res.status
    );
  }
  return (await res.json()) as SessionRow;
}

export interface StealSessionRequest {
  reason: string;
  machine_id: string;
}

export async function stealSession(
  id: string,
  body: StealSessionRequest
): Promise<unknown> {
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(id)}/steal`;
  const res = await fetch(url, {
    ...DEFAULT_INIT,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new SessionsApiError(
      `POST ${url} failed: ${res.status}`,
      res.status
    );
  }
  return await res.json();
}

export async function listTenants(
  signal?: AbortSignal
): Promise<TenantListResponse> {
  const url = `${OPERATIONS_API}/tenants`;
  const res = await fetch(url, { ...DEFAULT_INIT, signal });
  if (!res.ok) {
    throw new SessionsApiError(
      `GET ${url} failed: ${res.status}`,
      res.status
    );
  }
  return (await res.json()) as TenantListResponse;
}

// ---- SSE subscription ---------------------------------------------------

/**
 * Subscribe to the per-session event stream. Returns an
 * `EventSource`-like cleanup function. The browser's native
 * `EventSource` constructor doesn't carry credentials by default;
 * we instead consume the proxy's chunked HTTP body via `fetch` +
 * a manual SSE-frame parser. This is the same shape that
 * `qontinui-runner` uses for its own dashboards and matches the
 * behavior of `coord`'s SSE route (replay-then-live-tail).
 *
 * Caller receives:
 *   - `onEvent(row)` for every event row parsed
 *   - `onError(err)` for transport/parse errors
 *   - `onClose()` when the upstream closes cleanly
 *
 * The returned function cancels the underlying fetch.
 */
export interface SessionEventStreamHandlers {
  onEvent: (event: SessionEventRow) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

export function subscribeSessionEvents(
  sessionId: string,
  handlers: SessionEventStreamHandlers
): () => void {
  const controller = new AbortController();
  const url = `${OPERATIONS_API}/sessions/${encodeURIComponent(
    sessionId
  )}/events`;

  void (async () => {
    try {
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new SessionsApiError(
          `GET ${url} failed: ${res.status}`,
          res.status
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames separated by blank line. Split eagerly so we
        // surface each complete frame ASAP.
        while (true) {
          const sep = buf.indexOf("\n\n");
          if (sep === -1) break;
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          parseFrame(frame, handlers);
        }
      }
      handlers.onClose?.();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(err);
    }
  })();

  return () => controller.abort();
}

function parseFrame(
  frame: string,
  handlers: SessionEventStreamHandlers
): void {
  // Each frame is a sequence of `field: value` lines. We only care
  // about `data:` lines; per the SSE spec, multiple `data:` lines in
  // one frame concatenate with `\n` joins.
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return;
  const payload = dataLines.join("\n");
  try {
    const parsed = JSON.parse(payload) as SessionEventRow;
    handlers.onEvent(parsed);
  } catch (err) {
    handlers.onError?.(
      new Error(
        `failed to parse SSE frame: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
}

export class SessionsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "SessionsApiError";
  }
}
