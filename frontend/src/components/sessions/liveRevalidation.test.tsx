/**
 * An open session detail refreshes over SSE, not over a second timer.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 4. The list has one
 * 10s poll (`SessionsConsolePolling.test.tsx`); a single OPEN session already
 * has a live transport — `GET /operations/sessions/:id/events`, consumed by
 * `subscribeSessionEvents` — so it re-reads on that stream instead.
 *
 * What is asserted:
 *
 * 1. the denylist, and the direction it fails in — `heartbeat` and
 *    `output_chunk` do NOT revalidate (a 15s heartbeat would make this a poll
 *    in all but name), an unrecognized kind DOES;
 * 2. coord's connect-time replay of 100 events costs ONE revalidation, not 100;
 * 3. a collapsed row and an unmounted one leave no pending timer and no open
 *    subscription — the teardown half of the leak this phase closes;
 * 4. **a failed re-read keeps the previous answer, labelled stale** — the
 *    `readFailure.ts` contract applied per half. A 404 is different: coord
 *    ANSWERED, so it replaces.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";

import { SessionsApiError } from "./api";
import {
  NON_REVALIDATING_EVENT_KINDS,
  REVALIDATE_COALESCE_MS,
  isRevalidatingEvent,
  useSessionEventRevalidation,
  type SessionEventSubscriber,
} from "./liveRevalidation";
import {
  SessionRowExpansion,
  useSessionCoordination,
} from "./SessionRowExpansion";
import { foldRevalidation } from "./sessionKeyResolution";
import type { SessionEventRow } from "./types";
import type { ConsolidatedSessionRow } from "./sessionConsoleStatus";
import type { TranscriptStoresState } from "./TranscriptStores";

const SESSION_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function event(kind: string, seq = 1): SessionEventRow {
  return {
    id: seq,
    session_id: SESSION_ID,
    seq,
    event_kind: kind,
    payload: {},
    occurred_at: "2026-08-26T12:00:00.000Z",
  };
}

/**
 * A stand-in for `subscribeSessionEvents` that hands the test the stream's
 * `onEvent` so frames can be delivered on demand, and counts unsubscribes.
 */
function fakeStream() {
  const state = {
    opened: 0,
    unsubscribed: 0,
    emit: (_row: SessionEventRow) => {},
  };
  const subscribe = vi.fn(((sessionId, handlers) => {
    void sessionId;
    state.opened += 1;
    state.emit = (row) => handlers.onEvent(row);
    return () => {
      state.unsubscribed += 1;
    };
  }) as SessionEventSubscriber);
  return { ...state, subscribe, get self() { return state; } };
}

describe("isRevalidatingEvent — a denylist, and which way it fails", () => {
  it("refuses the two high-volume kinds that cannot change coordination", () => {
    expect(NON_REVALIDATING_EVENT_KINDS.has("heartbeat")).toBe(true);
    expect(NON_REVALIDATING_EVENT_KINDS.has("output_chunk")).toBe(true);
    expect(isRevalidatingEvent(event("heartbeat"))).toBe(false);
    expect(isRevalidatingEvent(event("output_chunk"))).toBe(false);
  });

  it("lets an UNRECOGNIZED kind through — coord's vocabulary is open", () => {
    // `coord.session_events.event_kind` is bare TEXT with no CHECK constraint,
    // so an allowlist here would silently ignore every kind added later. A new
    // kind costs one wasted read; the inverse costs a stale panel nobody knows
    // is stale.
    expect(isRevalidatingEvent(event("claim_stolen"))).toBe(true);
    expect(isRevalidatingEvent(event("some_kind_invented_in_2027"))).toBe(true);
  });

  it("treats a missing kind as nothing to act on", () => {
    expect(isRevalidatingEvent({ event_kind: null })).toBe(false);
    expect(isRevalidatingEvent({})).toBe(false);
  });
});

describe("foldRevalidation — a failed re-read is staleness, not unknown", () => {
  const held = { state: "resolved", value: [1] } as const;

  it("keeps the previous value and marks it stale when the re-read fails", () => {
    expect(
      foldRevalidation(held, { state: "unknown", detail: "proxy blipped" })
    ).toEqual({ state: "resolved", value: [1], stale: true });
  });

  it("replaces on a 404 — coord ANSWERED", () => {
    expect(foldRevalidation(held, { state: "absent" })).toEqual({
      state: "absent",
    });
  });

  it("clears staleness when a re-read lands", () => {
    const stale = { state: "resolved", value: [1], stale: true } as const;
    expect(foldRevalidation(stale, { state: "resolved", value: [2] })).toEqual({
      state: "resolved",
      value: [2],
    });
  });

  it("has nothing to retain when the half never resolved", () => {
    expect(
      foldRevalidation({ state: "loading" }, { state: "unknown", detail: "x" })
    ).toEqual({ state: "unknown", detail: "x" });
  });
});

describe("useSessionEventRevalidation — coalescing and teardown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("collapses coord's 100-event connect replay into ONE revalidation", () => {
    const stream = fakeStream();
    const revalidate = vi.fn();
    renderHook(() =>
      useSessionEventRevalidation(SESSION_ID, true, revalidate, {
        subscribe: stream.subscribe,
      })
    );
    expect(stream.self.opened).toBe(1);

    act(() => {
      for (let seq = 1; seq <= 100; seq += 1) {
        stream.self.emit(event("claim_acquired", seq));
      }
    });
    // Nothing yet — the window is trailing.
    expect(revalidate).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(REVALIDATE_COALESCE_MS));
    expect(revalidate).toHaveBeenCalledTimes(1);

    // A later event arms a fresh window rather than being swallowed forever.
    act(() => stream.self.emit(event("claim_released", 101)));
    act(() => void vi.advanceTimersByTime(REVALIDATE_COALESCE_MS));
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("never revalidates on heartbeats — this is not a 15s poll", () => {
    const stream = fakeStream();
    const revalidate = vi.fn();
    renderHook(() =>
      useSessionEventRevalidation(SESSION_ID, true, revalidate, {
        subscribe: stream.subscribe,
      })
    );

    act(() => {
      for (let seq = 1; seq <= 20; seq += 1) {
        stream.self.emit(event("heartbeat", seq));
        stream.self.emit(event("output_chunk", seq));
      }
    });
    act(() => void vi.advanceTimersByTime(60_000));
    expect(revalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens nothing while disabled, and closes on unmount", () => {
    const stream = fakeStream();
    const revalidate = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSessionEventRevalidation(SESSION_ID, enabled, revalidate, {
          subscribe: stream.subscribe,
        }),
      { initialProps: { enabled: false } }
    );
    expect(stream.self.opened).toBe(0);

    rerender({ enabled: true });
    expect(stream.self.opened).toBe(1);

    unmount();
    expect(stream.self.unsubscribed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a pending revalidation when the row is collapsed", () => {
    const stream = fakeStream();
    const revalidate = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSessionEventRevalidation(SESSION_ID, enabled, revalidate, {
          subscribe: stream.subscribe,
        }),
      { initialProps: { enabled: true } }
    );

    act(() => stream.self.emit(event("claim_acquired")));
    // Armed but not fired — now shut the row.
    rerender({ enabled: false });
    expect(stream.self.unsubscribed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    act(() => void vi.advanceTimersByTime(60_000));
    // A panel nobody is looking at must not issue three reads a second later.
    expect(revalidate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// End to end through the row expansion
// ---------------------------------------------------------------------------

const ROW: ConsolidatedSessionRow = {
  id: SESSION_ID,
  device_id: "dev-a",
  row_class: "linked",
  session_kind: "terminal_claude",
  state: "active",
  agent_session: { id: "agent-1", status: "live" },
};

/** Neither store has been probed — this file is about the coordination half. */
const NO_STORES: TranscriptStoresState = {
  live: { state: "unprobed" },
  archived: { state: "unprobed" },
};

function CoordinationHarness({
  subscribe,
  readers,
}: {
  subscribe: SessionEventSubscriber;
  readers: Parameters<typeof useSessionCoordination>[2];
}) {
  const coordination = useSessionCoordination(SESSION_ID, true, readers, {
    subscribe,
  });
  return (
    <SessionRowExpansion row={ROW} coordination={coordination} stores={NO_STORES} />
  );
}

describe("an open row, refreshed over its own SSE stream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("re-reads on an event and keeps the OLD answer, labelled, when that fails", async () => {
    const stream = fakeStream();
    let claimsFail = false;
    const claims = vi.fn(async () => {
      if (claimsFail) throw new Error("proxy blipped");
      return {
        claims: [
          {
            id: "claim-1",
            kind: "file_glob",
            resource_key: "frontend/src/**",
            machine_id: "m1",
            acquired_at: "2026-08-26T11:59:00.000Z",
          },
        ],
        count: 1,
      };
    });
    const readers = {
      claims: claims as never,
      agents: vi.fn(async () => ({ agents: [], count: 0 })) as never,
      lineage: vi.fn(async () => ({ session_id: SESSION_ID, actions: [] })) as never,
    };

    render(<CoordinationHarness subscribe={stream.subscribe} readers={readers} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const panel = screen.getByTestId("sessions-console-detail-claims");
    expect(panel).toHaveTextContent("frontend/src/**");
    expect(claims).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("sessions-console-detail-claims-stale")
    ).toBeNull();

    // Coord says something happened; the re-read does not land.
    claimsFail = true;
    act(() => stream.self.emit(event("claim_stolen")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVALIDATE_COALESCE_MS);
    });
    expect(claims).toHaveBeenCalledTimes(2);

    // D2: the claim we HELD is still on screen. It is not a dash, and the
    // panel does not now say this session holds no claims.
    const after = screen.getByTestId("sessions-console-detail-claims");
    expect(after).toHaveTextContent("frontend/src/**");
    expect(after).not.toHaveTextContent("holds no claims");
    expect(
      screen.getByTestId("sessions-console-detail-claims-stale")
    ).toHaveTextContent(/last refresh failed/i);

    // A re-read that lands clears the label rather than latching it.
    claimsFail = false;
    act(() => stream.self.emit(event("claim_acquired", 2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVALIDATE_COALESCE_MS);
    });
    expect(claims).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByTestId("sessions-console-detail-claims-stale")
    ).toBeNull();
  });

  it("replaces the held answer when coord ANSWERS 404 on the re-read", async () => {
    const stream = fakeStream();
    let gone = false;
    const claims = vi.fn(async () => {
      if (gone) throw new SessionsApiError("GET … failed: 404", 404);
      return {
        claims: [
          {
            id: "claim-1",
            kind: "file_glob",
            resource_key: "frontend/src/**",
            machine_id: "m1",
            acquired_at: "2026-08-26T11:59:00.000Z",
          },
        ],
        count: 1,
      };
    });
    const readers = {
      claims: claims as never,
      agents: vi.fn(async () => ({ agents: [], count: 0 })) as never,
      lineage: vi.fn(async () => ({ session_id: SESSION_ID, actions: [] })) as never,
    };

    render(<CoordinationHarness subscribe={stream.subscribe} readers={readers} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("sessions-console-detail-claims")).toHaveTextContent(
      "frontend/src/**"
    );

    gone = true;
    act(() => stream.self.emit(event("session_closed")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVALIDATE_COALESCE_MS);
    });

    const after = screen.getByTestId("sessions-console-detail-claims");
    expect(after).toHaveTextContent("no claims record");
    expect(after).not.toHaveTextContent("frontend/src/**");
  });

  it("issues no second read while the row just sits there", async () => {
    const stream = fakeStream();
    const readers = {
      claims: vi.fn(async () => ({ claims: [], count: 0 })) as never,
      agents: vi.fn(async () => ({ agents: [], count: 0 })) as never,
      lineage: vi.fn(async () => ({ session_id: SESSION_ID, actions: [] })) as never,
    };
    const { unmount } = render(
      <CoordinationHarness subscribe={stream.subscribe} readers={readers} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Five minutes with a silent stream. A poll would have fired 30 times.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(readers.claims).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    unmount();
    expect(stream.self.unsubscribed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
