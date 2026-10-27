import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviceStatusTile } from "./DeviceStatusTile";
import { UNKNOWN_AMBER } from "@/components/console";
import { FixedPresentationMode } from "@/components/presentation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEVICE_STATUS_POLL_FALLBACK_MS } from "./utils";
import type { DeviceStatus, StalledSession } from "./types";
import type { UseDeviceStatusStreamResult } from "./useDeviceStatusStream";

/**
 * Phase 5 (plan `2026-06-24-coord-session-progress-and-stall-detection`) —
 * the device tile surfaces a stalled badge + age when coord's enriched
 * device-status payload reports a stalled session, with a distinct
 * "dispatched, never started" indicator for expected-unstarted continuations.
 */

const STALL_SELECTOR = "[data-ui-bridge-id='operations.device-status-stalled']";

function baseRow(overrides: Partial<DeviceStatus> = {}): DeviceStatus {
  return {
    device_id: "00000000-0000-0000-0000-000000000001",
    hostname: "test-host",
    current_task: "finish deploy",
    current_repo: "qontinui-coord",
    current_branch: "main",
    free_text: null,
    details: {},
    tenant_id: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockStream(rows: DeviceStatus[]): UseDeviceStatusStreamResult {
  const byHostname = new Map<string, DeviceStatus>();
  for (const r of rows) byHostname.set(r.hostname ?? r.device_id, r);
  return {
    byHostname,
    connected: true,
    error: null,
    seeded: true,
    everSeeded: true,
    refetch: async () => {},
  } as unknown as UseDeviceStatusStreamResult;
}

function renderTile(rows: DeviceStatus[]) {
  return render(
    <TooltipProvider>
      <DeviceStatusTile stream={mockStream(rows)} />
    </TooltipProvider>
  );
}

describe("DeviceStatusTile stalled badge", () => {
  it("renders no stalled badge for a healthy device", () => {
    const { container } = renderTile([
      baseRow({ stalled_session_count: 0, most_stalled_session: null }),
    ]);
    expect(container.querySelector(STALL_SELECTOR)).toBeNull();
  });

  it("renders an amber 'stalled <age>' badge for an active stall", () => {
    const stall: StalledSession = {
      session_id: "00000000-0000-0000-0000-0000000000aa",
      device_id: "00000000-0000-0000-0000-000000000001",
      kind: "stalled",
      state: "active",
      session_status: "stalled",
      stall_age_secs: 720,
      last_progress_at: new Date().toISOString(),
      correlation_topic: "plan-42",
    };
    const { container } = renderTile([
      baseRow({ stalled_session_count: 1, most_stalled_session: stall }),
    ]);
    const badge = container.querySelector(STALL_SELECTOR);
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-stall-kind")).toBe("stalled");
    // 720s → "12m"; the active-stall label is "stalled <age>".
    expect(badge?.textContent).toContain("stalled 12m");
  });

  it("renders a 'never started' indicator for an expected-unstarted continuation", () => {
    const stall: StalledSession = {
      session_id: "00000000-0000-0000-0000-0000000000bb",
      device_id: "00000000-0000-0000-0000-000000000001",
      kind: "expected_unstarted",
      state: "expected",
      session_status: "stalled",
      stall_age_secs: 1800,
      expected_at: new Date().toISOString(),
      continuation_gate_id: "fec1da6e",
      work_unit_slug: "coord-workunit-authz-graduated-trust",
    };
    const { container } = renderTile([
      baseRow({ stalled_session_count: 2, most_stalled_session: stall }),
    ]);
    const badge = container.querySelector(STALL_SELECTOR);
    expect(badge?.getAttribute("data-stall-kind")).toBe("expected_unstarted");
    // 1800s → "30m"; the distinct dispatched-but-never-started label.
    expect(badge?.textContent).toContain("never started 30m");
    // count=2 ⇒ a "+1" suffix for the other stalled session on the device.
    expect(badge?.textContent).toContain("+1");
  });
});

/**
 * The tile's list states (style guide R6; plan
 * `2026-10-23-console-presentation-spaces` D3; served policy
 * `verification-and-evidence` `silent-empty-is-unknown`): a failed read is
 * never an empty list and never a count of 0. Keyed on
 * whether a fleet read has ANSWERED, so a list a read answered empty and a
 * list no read ever answered say different things.
 */
describe("DeviceStatusTile — a failed read is never an empty list", () => {
  /** Failure text naming a machine, so its absence is checkable. */
  const FAILURE = "network error: device-host-4471 refused the connection";
  const NEVER_ANSWERED = { error: FAILURE, seeded: true, everSeeded: false };
  const ANSWERED_THEN_FAILED = {
    error: FAILURE,
    seeded: true,
    everSeeded: true,
  };
  const ANSWERED = { error: null, seeded: true, everSeeded: true };
  const LOADING = { error: null, seeded: false, everSeeded: false };

  function renderTileIn(
    presenting: boolean,
    rows: DeviceStatus[],
    read: Pick<UseDeviceStatusStreamResult, "error" | "seeded" | "everSeeded">
  ) {
    const stream = {
      ...mockStream(rows),
      ...read,
      connected: false,
    } as UseDeviceStatusStreamResult;
    return render(
      <FixedPresentationMode presenting={presenting}>
        <TooltipProvider>
          <DeviceStatusTile stream={stream} />
        </TooltipProvider>
      </FixedPresentationMode>
    );
  }

  const count = () => screen.getByTestId("device-status-count").textContent;
  /**
   * Style guide R3: what we do not know wears the ignorance-floor amber —
   * every class of `UNKNOWN_AMBER` — never the calm of a known value.
   */
  function expectUnknownAmber(testId: string) {
    expect(screen.getByTestId(testId)).toHaveClass(...UNKNOWN_AMBER.split(" "));
  }
  const connection = () =>
    document.querySelector(
      "[data-ui-bridge-id='operations.device-status-connection']"
    )?.textContent;

  it("presenting, no read ever answered: UNKNOWN in fixed words, on amber — no 0, no 'no machine reported', no failure text, no transport", () => {
    renderTileIn(true, [], NEVER_ANSWERED);
    expect(screen.getByTestId("device-status-unknown")).toHaveTextContent(
      "UNKNOWN — the machines' status reports could not be read, so whether any machine has reported what it is working on is not known."
    );
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(screen.queryByTestId("device-status-stale-empty")).toBeNull();
    expect(count()).toBe("unknown");
    // Both the statement and the count are ignorance, and look it.
    expectUnknownAmber("device-status-unknown");
    expectUnknownAmber("device-status-count");
    // The read's own text names a machine: it never reaches an outsider.
    expect(document.body.innerHTML).not.toContain("device-host-4471");
    // The socket is down, so the stream re-reads the list on its fallback
    // poll: said as that cadence, without naming the socket — and never as a
    // list that stopped updating.
    expect(connection()).toBe("re-read every few seconds");
    expect(document.body.textContent).not.toMatch(/\bWS\b|polling|paused/);
  });

  it("operator, no read ever answered: UNKNOWN with the read's own text, on amber, and the transport named", () => {
    renderTileIn(false, [], NEVER_ANSWERED);
    const unknown = screen.getByTestId("device-status-unknown");
    expect(unknown).toHaveTextContent(FAILURE);
    expect(unknown).toHaveTextContent(/this is not an empty list/);
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(count()).toBe("unknown");
    expectUnknownAmber("device-status-unknown");
    expectUnknownAmber("device-status-count");
    expect(connection()).toBe("polling (WS offline)");
  });

  it("rows pushed before any read answered stay listed, and the count stays unknown, on amber", () => {
    renderTileIn(true, [baseRow()], NEVER_ANSWERED);
    expect(
      document.querySelectorAll(
        "[data-ui-bridge-id='operations.device-status-row']"
      )
    ).toHaveLength(1);
    expect(count()).toBe("unknown");
    expectUnknownAmber("device-status-count");
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
  });

  it("operator, rows pushed before any read answered: listed under their own names, and the count stays unknown, on amber", () => {
    renderTileIn(false, [baseRow()], NEVER_ANSWERED);
    const rows = document.querySelectorAll(
      "[data-ui-bridge-id='operations.device-status-row']"
    );
    expect(rows).toHaveLength(1);
    // The operator's row names the machine as it reported itself.
    expect(rows[0]).toHaveTextContent("test-host");
    expect(count()).toBe("unknown");
    expectUnknownAmber("device-status-count");
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
  });

  it("presenting, a read answered empty and the latest one failed: past tense, qualified by the failure — never the present-tense sentence", () => {
    renderTileIn(true, [], ANSWERED_THEN_FAILED);
    expect(screen.getByTestId("device-status-stale-empty")).toHaveTextContent(
      "No machine had reported what it is working on at the last read that succeeded. The latest read failed, so whether one has reported since is not known."
    );
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
    // The answered count stands (R6: a retained count is kept, not dashed).
    expect(count()).toBe("0");
    expect(document.body.innerHTML).not.toContain("device-host-4471");
  });

  it("operator, a read answered empty and the latest one failed: the same, with the failure's own text", () => {
    renderTileIn(false, [], ANSWERED_THEN_FAILED);
    const stale = screen.getByTestId("device-status-stale-empty");
    expect(stale).toHaveTextContent(
      "No devices were reporting status at the last read that answered."
    );
    expect(stale).toHaveTextContent(FAILURE);
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(count()).toBe("0");
  });

  it("(control) a read that answered empty is a known zero, said in the present tense, not on amber", () => {
    renderTileIn(true, [], ANSWERED);
    expect(screen.getByTestId("device-status-empty")).toHaveTextContent(
      "No machine has reported what it is working on in the last hour."
    );
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
    expect(screen.queryByTestId("device-status-stale-empty")).toBeNull();
    expect(count()).toBe("0");
    // A known count does not wear the ignorance floor.
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(screen.getByTestId("device-status-count")).not.toHaveClass(cls);
    }
  });

  it("(control) operator, a read that answered empty: a known zero, with the route agents post to and how long a row lives", () => {
    renderTileIn(false, [], ANSWERED);
    expect(screen.getByTestId("device-status-empty")).toHaveTextContent(
      "No devices reporting status. Agents post here voluntarily via POST /coord/status; rows older than 1h are pruned."
    );
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
    expect(screen.queryByTestId("device-status-stale-empty")).toBeNull();
    expect(count()).toBe("0");
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(screen.getByTestId("device-status-count")).not.toHaveClass(cls);
    }
  });

  it("while the first read is in flight the count is a dash, never 0, and the body says it is loading", () => {
    renderTileIn(true, [], LOADING);
    expect(count()).toBe("–");
    expect(document.body.textContent).toContain("Loading device status");
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
  });

  it("operator, while the first read is in flight: the count is a dash, never 0, and the body says it is loading", () => {
    renderTileIn(false, [], LOADING);
    expect(count()).toBe("–");
    expect(document.body.textContent).toContain("Loading device status");
    expect(screen.queryByTestId("device-status-empty")).toBeNull();
    expect(screen.queryByTestId("device-status-unknown")).toBeNull();
    expect(screen.queryByTestId("device-status-stale-empty")).toBeNull();
  });
});

/**
 * The presented connection line claims a cadence: while the socket is down
 * the stream re-reads the list on its fallback poll, and the line says "every
 * few seconds". That sentence is true only while the poll's interval is a few
 * seconds, so the bound is held here, beside the words, rather than left to
 * whoever next edits the interval.
 */
describe("DeviceStatusTile — the presented connection line", () => {
  it("'re-read every few seconds' holds: the fallback poll re-reads the list in under ten seconds", () => {
    expect(DEVICE_STATUS_POLL_FALLBACK_MS).toBeLessThan(10_000);
  });
});
