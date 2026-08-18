import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * DiskSection — the rendered half of the honesty contract.
 *
 * `diskSurvey.test.ts` pins the parse/aggregate rules; these pin that the
 * component actually SHOWS the difference. Phase 1's review caught two
 * honesty violations in rendering code specifically, so the render is worth
 * asserting on rather than trusting the pure layer to imply.
 */

const runnerFetch = vi.fn();
const httpFetch = vi.fn();
const useDeviceInfo = vi.fn();

class MockRunnerApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "RunnerApiError";
  }
}

vi.mock("@/lib/runner-api", () => ({
  runnerFetch: (...args: unknown[]) => runnerFetch(...args),
  RunnerApiError: MockRunnerApiError,
  useDeviceInfo: () => useDeviceInfo(),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

const { DiskSection } = await import("./DiskSection");

const DEVICE = "11111111-1111-1111-1111-111111111111";

function volumesResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeviceInfo.mockReturnValue({
    data: { device_id: DEVICE },
    isLoading: false,
  });
  httpFetch.mockResolvedValue(
    volumesResponse({ device_id: DEVICE, volumes: [] })
  );
  runnerFetch.mockResolvedValue({ items: [], census_status: "fresh" });
});

describe("DiskSection — free space", () => {
  it("consumes the per-device route (deviceVolumesUrl) for THIS device", async () => {
    render(<DiskSection />);
    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    expect(String(httpFetch.mock.calls[0][0])).toContain(
      `/operations/devices/${DEVICE}/volumes`
    );
  });

  it("renders a failed read as UNKNOWN with the reason, never as empty", async () => {
    httpFetch.mockResolvedValue(volumesResponse(null, false, 502));
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/HTTP 502/)).toBeInTheDocument()
    );
    expect(screen.getByText(/not an empty disk/i)).toBeInTheDocument();
  });

  it("distinguishes 'never reported' from a failed read", async () => {
    render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/never reported disk telemetry/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/absence of measurement/i)).toBeInTheDocument();
  });

  it("says the device could not be identified rather than showing zero", async () => {
    useDeviceInfo.mockReturnValue({ data: null, isLoading: false });
    render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/did not report a coord device id/i)
      ).toBeInTheDocument()
    );
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("renders a reading with its free bytes", async () => {
    httpFetch.mockResolvedValue(
      volumesResponse({
        device_id: DEVICE,
        volumes: [
          {
            volume: "D:",
            total_bytes: 4 * 1024 ** 4,
            free_bytes: 1024 ** 4,
            observed_at: new Date().toISOString(),
          },
        ],
      })
    );
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/1.0 TiB free/)).toBeInTheDocument()
    );
  });
});

describe("DiskSection — reclaim survey", () => {
  it("renders a cold census as NOT READY, never as 'nothing to clean'", async () => {
    runnerFetch.mockResolvedValue({ items: [], census_status: "pending" });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/no census has completed yet/i)
      ).toBeInTheDocument()
    );
    // The positive claim is marked in the DOM, so this asserts on the CLAIM
    // rather than on prose that also appears inside disclaimers.
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("says a 404 means the runner CANNOT answer, not that there is nothing", async () => {
    runnerFetch.mockRejectedValue(new MockRunnerApiError(404, "not found"));
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/predates the disk-reclaim survey/i)
      ).toBeInTheDocument()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("only claims 'nothing to reclaim' for a completed, clean census", async () => {
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="measured"]')
      ).not.toBeNull()
    );
    expect(screen.getByText(/Nothing to reclaim/i)).toBeInTheDocument();
  });

  it("separates the actionable bytes from the report-only ones, with the why", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "sibling-worktree",
          status: "reclaimable",
          bytes: 2 * 1024 ** 3,
        },
        {
          id: "b",
          path: "D:/repo/target",
          class: "in-repo-canonical",
          status: "reclaimable",
          bytes: 8 * 1024 ** 3,
        },
      ],
      census_status: "fresh",
      census_age_secs: 30,
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getAllByText("2.0 GiB").length).toBeGreaterThan(0)
    );
    // Each bucket tile carries its own total: 2 GiB actionable, 8 GiB
    // report-only. The split is the requirement — one merged "10 GiB
    // reclaimable" would overstate what the product can act on.
    const actionable = container.querySelector(
      '[data-disk-bucket="actionable"]'
    );
    const reportOnly = container.querySelector(
      '[data-disk-bucket="report-only"]'
    );
    expect(actionable?.textContent).toContain("2.0 GiB");
    expect(reportOnly?.textContent).toContain("8.0 GiB");
    expect(
      screen.getByText(/Why the report-only bytes have no button/i)
    ).toBeInTheDocument();
  });

  it("renders a missing byte count as 'at least', never as a zero total", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
        {
          id: "b",
          path: "D:/wt2/target",
          class: "container",
          status: "reclaimable",
          bytes: null,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getAllByText(/at least/i).length).toBeGreaterThan(0)
    );
    const actionable = container.querySelector(
      '[data-disk-bucket="actionable"]'
    );
    // 1 KiB from the readable item, and an explicit lower-bound qualifier for
    // the one whose size never arrived — NOT "1.0 KiB" presented as exact and
    // NOT the unreadable item summed as 0.
    expect(actionable?.textContent).toContain("at least");
    expect(actionable?.textContent).toContain("1.0 KiB");
    expect(actionable?.textContent).toContain("1 of unknown size");
  });

  it("shows an absent bucket as ABSENT, never as a 0 B tile", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="actionable"]')
      ).not.toBeNull()
    );
    // Nothing in this payload was in-repo-canonical. A "0 B" report-only tile
    // would claim the runner scanned that class — which this page cannot know.
    expect(
      container.querySelector('[data-disk-bucket="report-only"]')
    ).toBeNull();
    expect(
      container.querySelector("[data-disk-absent-buckets]")?.textContent
    ).toMatch(/rather than as 0 B/i);
  });

  it("warns when candidates could not be read at all", async () => {
    runnerFetch.mockResolvedValue({
      items: [{ status: "???" }],
      census_status: "fresh",
    });
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Nothing to reclaim/i)).not.toBeInTheDocument();
  });

  it("Preview is present and gated on nothing but its own request", async () => {
    render(<DiskSection />);
    const button = await screen.findByRole("button", { name: /preview/i });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("does not kick a refresh walk on mount — only the button does", async () => {
    render(<DiskSection />);
    await waitFor(() => expect(runnerFetch).toHaveBeenCalled());
    expect(runnerFetch.mock.calls[0][0]).toBe("/disk/reclaimable");
  });
});
