/**
 * Tests for the onboarding wizard's paired-elsewhere UX (Phase 1b of plan
 * `2026-07-02-multi-tenant-device-pairing-reconsideration`).
 *
 * One runner device serves one tenant at a time — coord's extended
 * precondition-status returns `paired_elsewhere` (devices the calling user
 * has paired to a DIFFERENT tenant). Under test:
 *   - PairDeviceStep renders a visible warning + requires an explicit
 *     inline "Pair anyway" confirmation before pair-start fires;
 *   - empty/absent `paired_elsewhere` (older coord) degrades to today's
 *     one-click flow;
 *   - the step-2 paired indicator says "paired to a different tenant"
 *     instead of the ambiguous bare "waiting".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  ClaudeCodeStep,
  PairDeviceStep,
} from "./MergeOrchestrationOnboarding";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PAIR_START_OK = {
  state: "PAIR-CODE-123",
  redirect_url: "https://example.test/pair",
  expires_in: 300,
};

const ELSEWHERE = [
  {
    hostname: "spaceship",
    name: "spaceship-runner",
    last_seen_at: "2026-07-01T12:00:00Z",
  },
];

describe("<PairDeviceStep> paired-elsewhere confirmation", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("starts pairing on first click when no device is paired elsewhere", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} pairedElsewhere={[]} />);

    expect(screen.queryByTestId("paired-elsewhere-warning")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/coord/devices/pair-start");
    await waitFor(() =>
      expect(screen.getByText("PAIR-CODE-123")).toBeTruthy()
    );
  });

  it("degrades identically when the field is absent (older coord)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} />);

    expect(screen.queryByTestId("paired-elsewhere-warning")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("shows the steal warning and does NOT call pair-start until 'Pair anyway'", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(
      <PairDeviceStep onPaired={() => {}} pairedElsewhere={ELSEWHERE} />
    );

    // Warning is visible BEFORE pairing starts, naming the device.
    const warning = screen.getByTestId("paired-elsewhere-warning");
    expect(warning.textContent).toContain("spaceship");
    expect(warning.textContent).toContain(
      "is currently paired to a different tenant"
    );
    expect(warning.textContent).toContain(
      "Pairing it here will unpair it there"
    );

    // First click only ARMS the confirmation — no network call.
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    expect(fetchMock).not.toHaveBeenCalled();
    const pairAnyway = screen.getByTestId("pair-anyway-button");
    expect(pairAnyway.textContent).toContain("Pair anyway");

    // Explicit confirm → pair-start fires and the pair code renders.
    fireEvent.click(pairAnyway);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/coord/devices/pair-start");
    await waitFor(() =>
      expect(screen.getByText("PAIR-CODE-123")).toBeTruthy()
    );
  });

  it("cancel disarms the confirmation without pairing", () => {
    render(
      <PairDeviceStep onPaired={() => {}} pairedElsewhere={ELSEWHERE} />
    );

    fireEvent.click(screen.getByTestId("start-pairing-button"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pair-anyway-button")).toBeNull();
    expect(screen.getByTestId("start-pairing-button")).toBeTruthy();
    // Warning stays visible — the situation hasn't changed.
    expect(screen.getByTestId("paired-elsewhere-warning")).toBeTruthy();
  });
});

describe("<ClaudeCodeStep> paired indicator", () => {
  const base = {
    paired: false,
    claude_code_available: false,
    ready: false,
  };

  it("says 'waiting' when never paired anywhere", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired_elsewhere: [] }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "waiting"
    );
  });

  it("says 'paired to a different tenant' when paired elsewhere", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired_elsewhere: ELSEWHERE }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "paired to a different tenant"
    );
  });

  it("says 'yes' when paired for THIS tenant (elsewhere list irrelevant)", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired: true, paired_elsewhere: [] }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "yes"
    );
  });

  it("degrades to 'waiting' when the field is absent (older coord)", () => {
    render(<ClaudeCodeStep status={base} onReady={() => {}} />);
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "waiting"
    );
  });
});
