import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { SpawnModal } from "./SpawnModal";

/**
 * SpawnModal — device-roster legibility tests.
 *
 * Why these exist: the device dropdown rendered a single DISABLED
 * "No devices reporting" item for THREE different causes — a failed
 * `fleet/health` fetch, a non-200, and a genuine 200-with-empty-roster —
 * because the fetch's `.catch` only reached `console.warn`. All three
 * looked identical, and none of them offered any way forward, so an
 * operator whose roster was momentarily empty simply could not spawn.
 *
 * That last case is not hypothetical: coord lists a device only while
 * `coord.devices.last_seen_at` is inside `COORD_DEVICE_HEARTBEAT_TTL_SECS`
 * (120s default), while the runner's only regular writer of that column is
 * the budget republisher on `BUDGET_REPUBLISH_DEFAULT_SECS` (600s). A
 * healthy device is therefore ABSENT from the roster most of the time, and
 * the operator surface has to survive that rather than dead-end on it.
 *
 * So the assertions below pin two properties per state:
 *   1. the cause is NAMED (an operator can tell auth from liveness), and
 *   2. a manual device-id entry path EXISTS (the roster is a convenience,
 *      never the only way to name a `target_device_id`).
 */

const DEVICE = "eb2155ed-4152-4a91-be82-5d4346f717fc";

function renderModal() {
  return render(
    <SpawnModal
      open
      onOpenChange={() => {}}
      planSlug="2026-08-25-example-plan"
      initialPhase="1"
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpawnModal device roster", () => {
  it("renders the roster as a select when coord returns devices", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        devices: [{ device_id: DEVICE, hostname: "merytshost", state: "healthy" }],
      }),
    });

    renderModal();

    await waitFor(() =>
      expect(screen.getByTestId("coord-spawn-device-select")).toBeTruthy()
    );
    // A populated roster must NOT force the manual path on the operator.
    expect(screen.queryByTestId("coord-spawn-device-input")).toBeNull();
    expect(screen.queryByTestId("coord-spawn-device-notice")).toBeNull();
  });

  it("names the liveness cause and offers manual entry on an empty roster", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: [], count: 0 }),
    });

    renderModal();

    // The empty case must be a STATEMENT, not a blank control: a 200 with
    // no devices is a real answer about liveness, not a failure.
    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/0 live devices/i);
    expect(notice.textContent).toMatch(/heartbeat/i);
    // ...and it must leave a way to proceed.
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("surfaces the HTTP status on a non-200 rather than showing an empty roster", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    // 403 is an auth/proxy fault with a completely different fix from the
    // empty-roster case — the operator must be able to tell them apart.
    expect(notice.textContent).toMatch(/403/);
    expect(notice.textContent).not.toMatch(/0 live devices/i);
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("surfaces a transport failure and still offers manual entry", async () => {
    fetchMock.mockRejectedValue(new Error("NetworkError: failed to fetch"));

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/NetworkError/);
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });
});
