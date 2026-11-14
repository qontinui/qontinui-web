/**
 * The saved tab lists fixture (plan
 * `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3): the data the "Saved tab lists" panel tests and the `/sessions`
 * page test render over, and the fake network both answer `httpClient.fetch`
 * from — so every request goes through the real typed client
 * (`lib/api/savedSessionLists.ts`, `lib/api/runners.ts`).
 *
 * The test files own the `vi.mock` calls (vitest hoists them per file); this
 * module owns the data and the route table those mocks answer from. The
 * refusal bodies are the ones Phase 2's backend serves
 * (`endpoints/saved_session_lists.py`, `services/runner_relay.py`).
 */

import { vi, type Mock } from "vitest";
import type { Runner } from "@qontinui/shared-types";
import type {
  SavedSessionListCoordStatus,
  SavedSessionListDetail,
  SavedSessionListSummary,
  TerminalLayoutPage,
  TerminalLayoutSession,
} from "@/lib/api/savedSessionLists";

export const NOW = Date.parse("2026-11-08T12:00:00.000Z");
export const DAY_MS = 86_400_000;

/** Relay-connected: a primary on :9876 and a secondary on :9877. */
export const DEVICE_A = "aaaaaaaa-1111-4111-8111-111111111111";
/** Paired, but its runner holds no relay connection. */
export const DEVICE_B = "bbbbbbbb-2222-4222-8222-222222222222";
/** A second relay-connected device, for the runner filter. */
export const DEVICE_C = "cccccccc-3333-4333-8333-333333333333";

export const USER_ID = "99999999-0000-4000-8000-000000000001";

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function runner(over: Partial<Runner> & Pick<Runner, "id">): Runner {
  return {
    capabilities: [],
    createdAt: iso(NOW - 30 * DAY_MS),
    derivedStatus: "healthy",
    hostname: null,
    instances: [],
    lastHeartbeat: iso(NOW - 5_000),
    name: "runner",
    userId: USER_ID,
    wsConnected: true,
    ...over,
  };
}

/** The runners `GET /api/v1/devices` answers by default. */
export function defaultRunners(): Runner[] {
  return [
    runner({
      id: DEVICE_A,
      hostname: "merytshost",
      instances: [
        {
          connectedAt: iso(NOW - DAY_MS),
          instanceKey: "primary",
          instanceRole: "primary",
          port: 9876,
        },
        {
          connectedAt: iso(NOW - DAY_MS),
          instanceKey: "runner:test-1",
          instanceRole: "secondary",
          port: 9877,
        },
      ],
    }),
    runner({
      id: DEVICE_B,
      hostname: "spaceship",
      wsConnected: false,
      derivedStatus: "offline",
    }),
  ];
}

export function session(
  over: Partial<TerminalLayoutSession> &
    Pick<TerminalLayoutSession, "terminalId">
): TerminalLayoutSession {
  return {
    title: null,
    titleWithheld: false,
    isAlive: true,
    spawnName: null,
    claudeSessionId: null,
    accountLabel: null,
    sessionName: null,
    zoneIndex: null,
    finished: null,
    finishedAt: null,
    finishReason: null,
    ...over,
  };
}

export const CLAUDE_1 = "11111111-aaaa-4aaa-8aaa-000000000001";
export const CLAUDE_2 = "11111111-aaaa-4aaa-8aaa-000000000002";
export const CLAUDE_3 = "11111111-aaaa-4aaa-8aaa-000000000003";
export const CLAUDE_4 = "11111111-aaaa-4aaa-8aaa-000000000004";
export const CLAUDE_5 = "11111111-aaaa-4aaa-8aaa-000000000005";

export const PAGE_BUILD = "0a0a0a0a-0000-4000-8000-00000000000a";
export const PAGE_REVIEW_1 = "1b1b1b1b-0000-4000-8000-00000000001b";
export const PAGE_REVIEW_2 = "2c2c2c2c-0000-4000-8000-00000000002c";
export const PAGE_UNNAMED = "3d3d3d3d-0000-4000-8000-00000000003d";

/**
 * Four tabs in the runner's order, chosen so the order is NOT alphabetical:
 * "Build", two tabs both named "Review" (D2's duplicate rule), and one the
 * runner never registered a name for.
 */
export function layoutPages(): TerminalLayoutPage[] {
  return [
    {
      pageId: PAGE_BUILD,
      label: "Build",
      order: 0,
      sessions: [
        // Finished by the runner's marker only.
        session({
          terminalId: "term-build-1",
          claudeSessionId: CLAUDE_1,
          sessionName: "brave-otter",
          accountLabel: "work",
          finished: true,
          finishedAt: iso(NOW - 3_600_000),
          finishReason: "all phases landed",
          title: "cargo build",
        }),
        // Finished by coord only (the legacy `done` word).
        session({
          terminalId: "term-build-2",
          claudeSessionId: CLAUDE_2,
          sessionName: "calm-heron",
          accountLabel: "personal",
          finished: false,
          isAlive: false,
        }),
      ],
    },
    {
      pageId: PAGE_REVIEW_1,
      label: "Review",
      order: 1,
      sessions: [
        // Finished per both sources; its title withheld (D8).
        session({
          terminalId: "term-review-1",
          claudeSessionId: CLAUDE_3,
          sessionName: "quiet-lynx",
          accountLabel: "work",
          finished: true,
          titleWithheld: true,
        }),
      ],
    },
    {
      pageId: PAGE_REVIEW_2,
      label: "Review",
      order: 2,
      sessions: [
        // No marker, coord could not be read: unknown.
        session({
          terminalId: "term-review-2",
          claudeSessionId: CLAUDE_4,
          sessionName: null,
          accountLabel: null,
        }),
        // No marker, coord answered "working": no badge at all.
        session({
          terminalId: "term-review-3",
          claudeSessionId: CLAUDE_5,
          sessionName: "swift-crane",
          accountLabel: "work",
        }),
      ],
    },
    {
      pageId: PAGE_UNNAMED,
      label: null,
      order: null,
      sessions: [
        // A plain shell: no confirmed session.
        session({ terminalId: "term-shell-1", spawnName: "shell-1" }),
      ],
    },
  ];
}

export function coordStatus(): Record<string, SavedSessionListCoordStatus> {
  return {
    [CLAUDE_1]: { read: "ok", value: null },
    [CLAUDE_2]: { read: "ok", value: "done" },
    [CLAUDE_3]: { read: "ok", value: "finished" },
    [CLAUDE_4]: { read: "failed", value: null },
    [CLAUDE_5]: { read: "ok", value: "working" },
  };
}

export function summary(
  over: Partial<SavedSessionListSummary> & Pick<SavedSessionListSummary, "id">
): SavedSessionListSummary {
  const capturedAt = over.captured_at ?? iso(NOW - 2 * 3_600_000);
  return {
    device_id: DEVICE_A,
    runner_instance: "primary",
    runner_port: 9876,
    runner_build_id: "build-2026-11-08",
    title: null,
    created_by_user_id: USER_ID,
    created_by_name: "Josh",
    captured_at: capturedAt,
    expires_at: iso(Date.parse(capturedAt) + 14 * DAY_MS),
    tab_count: 4,
    session_count: 6,
    ...over,
  };
}

export function detail(
  over: Partial<SavedSessionListDetail> & Pick<SavedSessionListDetail, "id">
): SavedSessionListDetail {
  const { layout, coord_status, ...rowOver } = over;
  const base = summary(rowOver);
  const pages = layout?.pages ?? layoutPages();
  return {
    ...base,
    tab_count: rowOver.tab_count ?? pages.length,
    session_count:
      rowOver.session_count ?? pages.reduce((n, p) => n + p.sessions.length, 0),
    layout: {
      runner: layout?.runner ?? {
        instanceName: base.runner_instance,
        port: base.runner_port,
        buildId: base.runner_build_id,
        deviceId: base.device_id,
      },
      labelsRegistered: layout?.labelsRegistered ?? true,
      capturedAt: layout?.capturedAt ?? base.captured_at,
      pages,
    },
    coord_status: coord_status ?? coordStatus(),
  };
}

// ---------------------------------------------------------------------------
// Refusal bodies, as Phase 2 serves them
// ---------------------------------------------------------------------------

export interface FakeAnswer {
  status: number;
  body: unknown;
}

/** A body `refusal_error` composes (`app/core/refusal.py`). */
function webRefusal(
  status: number,
  code: string,
  discriminator: string,
  kind: string,
  sentence: string,
  target?: string
): FakeAnswer {
  return {
    status,
    body: {
      error: "ERROR",
      message: sentence,
      timestamp: iso(NOW),
      path: "/api/v1/saved-session-lists",
      device_id: DEVICE_A,
      refusal: {
        code,
        discriminator,
        next_action: target === undefined ? { kind } : { kind, target },
        glossary_terms: ["runner"],
        detail: sentence,
        source: "web_backend",
        observed_at: iso(NOW),
      },
    },
  };
}

/** A body `relay_refusal_response` serves (`app/services/runner_relay.py`). */
function relayRefusal(
  status: number,
  code: string,
  discriminator: string,
  kind: string,
  sentence: string,
  legacyDetail: string,
  target?: string
): FakeAnswer {
  return {
    status,
    body: {
      detail: legacyDetail,
      device_id: DEVICE_A,
      request_id: "req-1",
      refusal: {
        code,
        discriminator,
        next_action: target === undefined ? { kind } : { kind, target },
        glossary_terms: ["device"],
        detail: sentence,
        source: "web_backend",
        observed_at: iso(NOW),
      },
    },
  };
}

/** Every typed refusal the capture can answer, by discriminator. */
export const CAPTURE_REFUSALS: Readonly<Record<string, FakeAnswer>> = {
  runner_predates_terminal_layout: webRefusal(
    409,
    "conflict",
    "runner_predates_terminal_layout",
    "open_page",
    "this runner's build predates saved tab lists: install the current runner (or rebuild it from source) to enable saving",
    "/download"
  ),
  runner_egress_off: webRefusal(
    409,
    "permission_denied",
    "runner_egress_off",
    "set_setting",
    "Terminal streaming is off for this project",
    "Terminal streaming"
  ),
  runner_layout_too_large: webRefusal(
    413,
    "quota_exceeded",
    "runner_layout_too_large",
    "report_defect",
    "the runner's terminal layout is 9000000 bytes, over the relay's 8388608-byte cap"
  ),
  runner_error: webRefusal(
    502,
    "upstream_unavailable",
    "runner_error",
    "retry_later",
    "the runner answered 500 for its terminal layout: boom"
  ),
  runner_layout_invalid: webRefusal(
    502,
    "internal_error",
    "runner_layout_invalid",
    "report_defect",
    "the runner's reply body could not be decoded"
  ),
  runner_relay_timeout: webRefusal(
    504,
    "upstream_timeout",
    "runner_relay_timeout",
    "retry_later",
    "the runner did not answer the relayed terminal-layout read in time"
  ),
  device_not_owned: relayRefusal(
    404,
    "not_found",
    "device_not_owned",
    "pair_device",
    "device not found or not owned by caller",
    "device not found or not owned by caller"
  ),
  runner_not_connected: relayRefusal(
    503,
    "device_not_connected",
    "runner_not_connected",
    "retry_later",
    "runner not connected",
    "runner not connected"
  ),
  runner_never_registered: relayRefusal(
    503,
    "device_not_connected",
    "runner_never_registered",
    "set_setting",
    "this device is paired, but its runner has never connected to the cloud relay: start the runner on that device, sign it in, and turn its cloud relay on, then try again",
    "runner not connected",
    "Web Integration"
  ),
  device_lookup_failed: {
    status: 500,
    body: {
      detail: "device lookup failed",
      refusal: {
        code: "internal_error",
        discriminator: "device_lookup_failed",
        next_action: { kind: "report_defect" },
        glossary_terms: ["device"],
        detail: "device lookup failed",
        source: "web_backend",
        observed_at: iso(NOW),
      },
    },
  },
};

// ---------------------------------------------------------------------------
// The fake network
// ---------------------------------------------------------------------------

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

function answer({ status, body }: FakeAnswer): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NOT_FOUND = (listId: string): FakeAnswer => ({
  status: 404,
  body: {
    error: "NOT_FOUND",
    message:
      "saved session list not found: it does not exist, it has expired, or it belongs to a device you do not own",
    saved_session_list_id: listId,
    refusal: {
      code: "not_found",
      discriminator: "saved_session_list_not_found",
      next_action: { kind: "none_terminal" },
      glossary_terms: [],
      detail:
        "saved session list not found: it does not exist, it has expired, or it belongs to a device you do not own",
      source: "web_backend",
      observed_at: iso(NOW),
    },
  },
});

export interface FakeNetwork {
  /** What `GET /saved-session-lists` answers with while `listAnswer` is unset. */
  lists: SavedSessionListSummary[];
  /** Layouts `GET /saved-session-lists/{id}` serves. */
  details: Map<string, SavedSessionListDetail>;
  runners: Runner[];
  /** Overrides the list read (a refusal, a malformed body). */
  listAnswer: FakeAnswer | null;
  /** Overrides the runners read. */
  runnersAnswer: FakeAnswer | null;
  /**
   * What `POST /saved-session-lists` answers. `null` (the default) saves:
   * it builds a detail from `captureLayout` for the posted device and title,
   * stores it, and answers 201 — as Phase 2 does.
   */
  captureAnswer: FakeAnswer | Error | null;
  captureLayout: TerminalLayoutPage[];
  /** Overrides the one-list read (an outage rather than a 404). */
  getAnswer: FakeAnswer | null;
  deleteAnswer: FakeAnswer | null;
  /** Anything else (the page test's sessions console reads land here). */
  other: (method: string, path: string) => FakeAnswer;
  calls: FakeCall[];
  fetch: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
}

let captureCounter = 0;

export function createFakeNetwork(): FakeNetwork {
  const net: FakeNetwork = {
    lists: [],
    details: new Map(),
    runners: defaultRunners(),
    listAnswer: null,
    runnersAnswer: null,
    captureAnswer: null,
    captureLayout: layoutPages(),
    getAnswer: null,
    deleteAnswer: null,
    other: (method, path) => ({
      status: 404,
      body: { detail: `the fake network has no route for ${method} ${path}` },
    }),
    calls: [],
    fetch: vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const path = new URL(url, "http://fake.local").pathname;
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null;
      net.calls.push({ method, path, body });

      if (path === "/api/v1/devices" && method === "GET") {
        return answer(net.runnersAnswer ?? { status: 200, body: net.runners });
      }
      if (path === "/api/v1/saved-session-lists") {
        if (method === "GET") {
          return answer(net.listAnswer ?? { status: 200, body: net.lists });
        }
        if (method === "POST") {
          if (net.captureAnswer instanceof Error) throw net.captureAnswer;
          if (net.captureAnswer !== null) return answer(net.captureAnswer);
          const posted = body as { device_id: string; title: string | null };
          captureCounter += 1;
          const id = `5a5a5a5a-0000-4000-8000-${String(captureCounter).padStart(12, "0")}`;
          // Stamped on the wall clock, as the backend stamps its own: a test
          // that renders without an injected `now` then reads "14 days".
          const at = Date.now();
          const saved = detail({
            id,
            device_id: posted.device_id,
            title: posted.title,
            captured_at: iso(at),
            expires_at: iso(at + 14 * DAY_MS),
            layout: {
              runner: {
                instanceName: "primary",
                port: 9876,
                buildId: "build-2026-11-08",
                deviceId: posted.device_id,
              },
              labelsRegistered: true,
              capturedAt: iso(at),
              pages: net.captureLayout,
            },
          });
          net.details.set(id, saved);
          const { layout: _layout, coord_status: _coord, ...row } = saved;
          net.lists = [row, ...net.lists];
          return answer({ status: 201, body: saved });
        }
      }
      const one = /^\/api\/v1\/saved-session-lists\/([^/]+)$/.exec(path);
      if (one) {
        const listId = decodeURIComponent(one[1] ?? "");
        if (method === "GET") {
          if (net.getAnswer !== null) return answer(net.getAnswer);
          const found = net.details.get(listId);
          return answer(
            found ? { status: 200, body: found } : NOT_FOUND(listId)
          );
        }
        if (method === "DELETE") {
          if (net.deleteAnswer !== null) return answer(net.deleteAnswer);
          const known =
            net.details.has(listId) || net.lists.some((l) => l.id === listId);
          if (!known) return answer(NOT_FOUND(listId));
          net.details.delete(listId);
          net.lists = net.lists.filter((l) => l.id !== listId);
          return answer({ status: 204, body: null });
        }
      }
      return answer(net.other(method, path));
    }),
  };
  return net;
}

/** Store `d` so both the list and the one-list read serve it. */
export function seedList(net: FakeNetwork, d: SavedSessionListDetail): void {
  net.details.set(d.id, d);
  const { layout: _layout, coord_status: _coord, ...row } = d;
  net.lists = [...net.lists, row];
}
