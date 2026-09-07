/**
 * SessionsConsole — the ONE list poll.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 4: *"one list poll
 * plus the existing per-session SSE"*, at a **10s** cadence that is a stated
 * decision (see `POLL_INTERVAL_MS`'s docstring — a 15s heartbeat going stale at
 * 45s does not need a 5s poll).
 *
 * Four things are asserted here and each of them is a defect this phase closes:
 *
 * 1. exactly ONE interval, and it fires at 10s — not 5s, and not two timers
 *    racing over the same list;
 * 2. unmount leaves NO pending timer — a leaked interval on a console an
 *    operator leaves open all day is the failure this phase prevents;
 * 3. a hidden tab STOPS the timer rather than skipping its body, and coming
 *    back visible reads once immediately;
 * 4. a failed poll renders the previous rows LABELLED STALE — never `0`, never
 *    "unknown", never an empty list (D2 / `readFailure.ts`).
 *
 * Fake timers throughout, and the fetcher is injected, so nothing here touches
 * a clock or a network it does not own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { SessionsConsole } from "./SessionsConsole";
import type {
  ConsolidatedSessionRow,
  ConsolidatedSessionsResponse,
} from "./sessionConsoleStatus";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ROW: ConsolidatedSessionRow = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  device_id: "dev-a",
  row_class: "linked",
  session_kind: "terminal_claude",
  provider: "claude",
  state: "active",
  started_at: ago(600_000),
  last_heartbeat_at: ago(5_000),
  intent: { purpose: "ship the console" },
  agent_session: { id: "agent-1", status: "live", last_seen: ago(5_000) },
};

function envelope(
  sessions: ConsolidatedSessionRow[]
): ConsolidatedSessionsResponse {
  return {
    count: sessions.length,
    scope: "all",
    shape: "consolidated",
    sessions,
    row_class_counts: {
      linked: sessions.length,
      lifecycle_only: 0,
      agent_only: 0,
      unknown: 0,
    },
    agent_half: { read: "ok" },
  };
}

/** Nothing an OPEN row would read — every row here stays shut. */
const STUBS = {
  coordinationReaders: {
    claims: vi.fn(async () => ({ claims: [], count: 0 })),
    agents: vi.fn(async () => ({ agents: [], count: 0 })),
    lineage: vi.fn(async () => ({ session_id: "s", actions: [] })),
  },
  readOutput: vi.fn(async () => ({
    session_id: "s",
    tier: "warm",
    chunks: [],
    count: 0,
  })),
  listArtifacts: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 10 })),
  // The per-session SSE an open row would subscribe to. Stubbed so no test in
  // this file can reach the network even if a row were opened.
  revalidation: { subscribe: vi.fn(() => () => {}) },
};

/** `document.hidden` is a getter with no setter — install our own. */
function installVisibility() {
  let hidden = false;
  const original = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "hidden"
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  return {
    set(next: boolean) {
      hidden = next;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    restore() {
      if (original) Object.defineProperty(document, "hidden", original);
      else delete (document as unknown as { hidden?: boolean }).hidden;
    },
  };
}

/** Let the 300ms query debounce fire and settle, so only the poll is left. */
async function settleDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

function mount(fetcher: ReturnType<typeof vi.fn>) {
  return render(
    <SessionsConsole
      now={NOW}
      fetcher={fetcher as never}
      hostnameFor={() => "alpha"}
      {...(STUBS as never)}
    />
  );
}

describe("SessionsConsole — the one list poll (Phase 4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("registers exactly ONE timer and it fires at 10s, not 5s", async () => {
    const fetcher = vi.fn(async () => envelope([ROW]));
    mount(fetcher);
    await settleDebounce();

    // The debounce has fired and is not rescheduled: whatever is left is the
    // poll, and there is one of it.
    expect(vi.getTimerCount()).toBe(1);
    // One read on mount.
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 5s is deliberately NOT a tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 10s is.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // And it keeps a single cadence rather than compounding — three more
    // ticks, three more reads, still one timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("leaves NO pending timer after unmount", async () => {
    const fetcher = vi.fn(async () => envelope([ROW]));
    const { unmount } = mount(fetcher);
    await settleDebounce();
    expect(vi.getTimerCount()).toBe(1);

    act(() => unmount());

    expect(vi.getTimerCount()).toBe(0);

    // And nothing fires afterwards.
    const before = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(before);
  });

  it("STOPS the timer while the tab is hidden, and reads once on return", async () => {
    const visibility = installVisibility();
    try {
      const fetcher = vi.fn(async () => envelope([ROW]));
      mount(fetcher);
      await settleDebounce();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      // Hidden: the interval is cleared, not merely skipped. A skipped tick
      // still wakes the event loop every 10s forever.
      await act(async () => {
        visibility.set(true);
      });
      expect(vi.getTimerCount()).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Visible again: one immediate read (the screen is up to a poll old),
      // then the single interval resumes.
      await act(async () => {
        visibility.set(false);
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      visibility.restore();
    }
  });

  it("does not start a second interval when visibilitychange repeats", async () => {
    const visibility = installVisibility();
    try {
      const fetcher = vi.fn(async () => envelope([ROW]));
      mount(fetcher);
      await settleDebounce();

      await act(async () => {
        visibility.set(false);
        visibility.set(false);
        visibility.set(false);
      });
      expect(vi.getTimerCount()).toBe(1);

      const before = fetcher.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      // Exactly one tick's worth of reads, not three.
      expect(fetcher).toHaveBeenCalledTimes(before + 1);
    } finally {
      visibility.restore();
    }
  });

  it("keeps the rows it already has when a poll fails, labelled stale", async () => {
    let fail = false;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error("coord unreachable");
      return envelope([ROW]);
    });
    mount(fetcher);
    await settleDebounce();

    expect(screen.getByText("ship the console")).toBeInTheDocument();
    const stats = screen.getByTestId("sessions-console-stats");
    expect(stats).toHaveTextContent("rows 1");

    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // D2: the read failed, so the counts are OLD — they are not 0 and the row
    // has not vanished. The health strip says which of the two it is.
    expect(screen.getByText("ship the console")).toBeInTheDocument();
    expect(screen.getByTestId("sessions-console-stats")).toHaveTextContent(
      "rows 1"
    );
    expect(screen.queryByTestId("sessions-console-unknown-state")).toBeNull();
    expect(screen.queryByTestId("sessions-console-empty")).toBeNull();
    expect(screen.getByTestId("sessions-console-health")).toHaveTextContent(
      /stale/i
    );

    // A later poll that lands clears the staleness rather than latching it.
    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("sessions-console-health")).not.toHaveTextContent(
      /could not be refreshed/i
    );
  });

  it("renders UNKNOWN, never an empty list, when the FIRST read fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("coord unreachable");
    });
    mount(fetcher);
    await settleDebounce();

    // Nothing was ever answered, so this is unknown — a different sentence
    // from the stale case above, and from "no sessions on the fleet".
    expect(screen.getByTestId("sessions-console-unknown-state")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-console-empty")).toBeNull();
    expect(screen.getByTestId("sessions-console-stats")).not.toHaveTextContent(
      "rows 0"
    );
  });
});
