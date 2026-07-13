/**
 * Tests for the onboarding wizard's paired-elsewhere UX.
 *
 * Pairing is ADDITIVE m:n (plan
 * `2026-07-02-session-scoped-multi-tenant-device-binding` Phase 3/9,
 * repurposing the Phase-1b blocking warning from
 * `2026-07-02-multi-tenant-device-pairing-reconsideration`): a runner
 * device serves many tenants concurrently, and pairing here ADDS a
 * binding without touching the others. Under test:
 *   - PairDeviceStep renders a purely INFORMATIONAL note when
 *     `paired_elsewhere` is non-empty — no confirmation gate, pair-start
 *     fires on the first click;
 *   - empty/absent `paired_elsewhere` (older coord) renders no note and
 *     the same one-click flow;
 *   - repeated entries for one hostname (one per binding) collapse into a
 *     single line with the binding count;
 *   - the step-2 paired indicator says "paired elsewhere — pair here to
 *     add" instead of the ambiguous bare "waiting".
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

describe("<PairDeviceStep> paired-elsewhere informational note", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("starts pairing on first click when no device is paired elsewhere", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} pairedElsewhere={[]} />);

    expect(screen.queryByTestId("paired-elsewhere-info")).toBeNull();
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

    expect(screen.queryByTestId("paired-elsewhere-info")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("shows the additive-pairing note and pair-start fires on the FIRST click (no confirmation gate)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(
      <PairDeviceStep onPaired={() => {}} pairedElsewhere={ELSEWHERE} />
    );

    // Informational note is visible, naming the device — additive copy,
    // no steal language.
    const note = screen.getByTestId("paired-elsewhere-info");
    expect(note.textContent).toContain("spaceship");
    expect(note.textContent).toContain("also serves 1 other tenant");
    expect(note.textContent).toContain(
      "Pairing here adds this tenant — existing pairings are unaffected"
    );
    expect(note.textContent).not.toContain("unpair");

    // No confirmation gate exists: the first click starts pairing.
    expect(screen.queryByTestId("pair-anyway-button")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/coord/devices/pair-start");
    await waitFor(() =>
      expect(screen.getByText("PAIR-CODE-123")).toBeTruthy()
    );
  });

  it("collapses repeated hostname entries (one per binding) into a counted line", () => {
    render(
      <PairDeviceStep
        onPaired={() => {}}
        pairedElsewhere={[
          ...ELSEWHERE,
          { hostname: "spaceship", name: null, last_seen_at: null },
        ]}
      />
    );

    const note = screen.getByTestId("paired-elsewhere-info");
    expect(note.textContent).toContain("also serves 2 other tenants");
    // One line per device, not per binding.
    expect(screen.getAllByText("spaceship")).toHaveLength(1);
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

  it("says 'paired elsewhere — pair here to add' when paired elsewhere", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired_elsewhere: ELSEWHERE }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "paired elsewhere — pair here to add"
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
