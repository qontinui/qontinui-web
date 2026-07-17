/**
 * Component test for DeployStatusStrip — coord-down retention.
 *
 * Follow-up to web#770, which fixed this same bug class one level up on the
 * same page. The admin-dev proxy converts a coord outage into a 200
 * `{verdict: {surfaces: []}, coord_error}` envelope. The strip must RETAIN the
 * last-good surface chips (dimmed, with a subtle "reconnecting" marker) rather
 * than applying the empty envelope and collapsing to "deploy status
 * unavailable" — the muted one-liner is reserved for a cold start with nothing
 * to retain. A thrown fetch error retains on the same rule.
 *
 * The five states under test:
 *   1. healthy                          → chips, no marker, no one-liner
 *   2. degraded after healthy           → chips RETAINED + reconnecting marker
 *   3. degraded on the very first fetch → one-liner, no marker
 *   4. recovery                         → marker gone, fresh chips
 *   5. thrown error after healthy       → chips retained + marker
 *
 * The strip has no manual refresh control, so the degraded transitions are
 * driven by advancing its poll interval. `vi.useFakeTimers({shouldAdvanceTime:
 * true})` keeps `waitFor` working on the real clock while letting us jump the
 * interval — the convention already used in `useCoPilotActivity.test.tsx`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReleaseVerdictResponse } from "./release-verdict";

const get = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

import { DeployStatusStrip } from "./DeployStatusStrip";

// Mirrors the component's own cadences; advancing past the longer one fires the
// poll under either state.
const REFRESH_MS = 60_000;

/** Minimal healthy envelope — one `ecs` surface reading "current". */
function healthy(surface = "ecs"): ReleaseVerdictResponse {
  return {
    verdict: {
      surfaces: [
        {
          components: {
            surface,
            drift_class: "in_sync",
            deployed_sha: "abc1234def5678901234567890abcdef12345678",
            lag_seconds: 0,
          },
        },
      ],
    },
  };
}

/** The degraded 200 the admin-dev proxy returns when coord is unreachable. */
function degraded(msg = "timeout waiting for coord"): ReleaseVerdictResponse {
  return { verdict: { surfaces: [] }, coord_error: msg };
}

/** Fire the strip's poll and let the resulting state settle. */
async function tickPoll() {
  await act(async () => {
    vi.advanceTimersByTime(REFRESH_MS + 1_000);
  });
}

describe("DeployStatusStrip coord-down retention", () => {
  beforeEach(() => {
    get.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the surface chips on a healthy response", async () => {
    get.mockResolvedValue(healthy());
    render(<DeployStatusStrip />);

    await waitFor(() =>
      expect(screen.getByTestId("deploy-status-strip")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument();
    expect(screen.queryByTestId("deploy-strip-reconnecting")).toBeNull();
    expect(screen.queryByTestId("deploy-strip-unavailable")).toBeNull();
  });

  it("retains the last-good chips with a reconnecting marker when a refetch degrades", async () => {
    get.mockResolvedValueOnce(healthy());
    render(<DeployStatusStrip />);
    await waitFor(() =>
      expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument(),
    );

    get.mockResolvedValue(degraded("timeout waiting for coord"));
    await tickPoll();

    await waitFor(() =>
      expect(
        screen.getByTestId("deploy-strip-reconnecting"),
      ).toBeInTheDocument(),
    );
    // The regression that matters: the chips survive the empty degraded
    // envelope instead of collapsing to the one-liner.
    expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument();
    expect(screen.queryByTestId("deploy-strip-unavailable")).toBeNull();
    expect(
      screen.getByTestId("deploy-strip-reconnecting").getAttribute("title"),
    ).toMatch(/timeout waiting for coord/);
  });

  it("shows the muted one-liner when the very first fetch is degraded", async () => {
    get.mockResolvedValue(degraded("boom"));
    render(<DeployStatusStrip />);

    await waitFor(() =>
      expect(screen.getByTestId("deploy-strip-unavailable")).toBeInTheDocument(),
    );
    // Nothing to retain → no marker, and the reason rides the tooltip.
    expect(screen.queryByTestId("deploy-strip-reconnecting")).toBeNull();
    expect(screen.queryByTestId("deploy-status-strip")).toBeNull();
    expect(
      screen.getByTestId("deploy-strip-unavailable").getAttribute("title"),
    ).toBe("boom");
  });

  it("clears the reconnecting marker and shows fresh chips on recovery", async () => {
    get.mockResolvedValueOnce(healthy());
    render(<DeployStatusStrip />);
    await waitFor(() =>
      expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument(),
    );

    get.mockResolvedValueOnce(degraded());
    await tickPoll();
    await waitFor(() =>
      expect(
        screen.getByTestId("deploy-strip-reconnecting"),
      ).toBeInTheDocument(),
    );

    get.mockResolvedValue(healthy("vercel"));
    await tickPoll();

    await waitFor(() =>
      expect(screen.getByTestId("deploy-surface-vercel")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("deploy-strip-reconnecting")).toBeNull();
    expect(screen.queryByTestId("deploy-strip-unavailable")).toBeNull();
  });

  it("retains the chips with a reconnecting marker when a refetch throws", async () => {
    get.mockResolvedValueOnce(healthy());
    render(<DeployStatusStrip />);
    await waitFor(() =>
      expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument(),
    );

    get.mockRejectedValue(new Error("boom"));
    await tickPoll();

    await waitFor(() =>
      expect(
        screen.getByTestId("deploy-strip-reconnecting"),
      ).toBeInTheDocument(),
    );
    // A genuine fetch failure degrades on the same rule as a coord_error
    // envelope — the chips stay put.
    expect(screen.getByTestId("deploy-surface-ecs")).toBeInTheDocument();
    expect(screen.queryByTestId("deploy-strip-unavailable")).toBeNull();
    expect(
      screen.getByTestId("deploy-strip-reconnecting").getAttribute("title"),
    ).toMatch(/boom/);
  });
});
