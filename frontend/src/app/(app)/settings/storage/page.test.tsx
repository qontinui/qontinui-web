import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/settings/storage` — INV-D1 at the PAGE level.
 *
 * The Disk section's two data paths fail independently and say so
 * independently, but that is worth nothing if a page-level early return blanks
 * the whole surface before it renders. Free space comes from COORD, not the
 * runner, so an offline runner must not be able to hide it — and a page that
 * renders nothing cannot tell an operator why.
 */

const useRunnerHealth = vi.fn();
const getStorageInfo = vi.fn();

vi.mock("@/lib/runner-api", () => ({
  useRunnerHealth: () => useRunnerHealth(),
  runnerApi: {
    getStorageInfo: () => getStorageInfo(),
    cleanupStorage: vi.fn(),
    clearAllStorage: vi.fn(),
  },
}));

vi.mock("@/components/runner/RunnerOfflineState", () => ({
  RunnerOfflineState: () => <div data-testid="offline-state" />,
}));

// The section itself is pinned by `DiskSection.test.tsx`; here it only needs to
// be identifiable, so the assertion is about PLACEMENT rather than content.
vi.mock("@/components/settings/storage/DiskSection", () => ({
  DiskSection: () => <div data-testid="disk-section" />,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const StorageSettingsPage = (await import("./page")).default;

const STORAGE_INFO = {
  screenshot_usage_mb: 1,
  screenshot_max_mb: 100,
  screenshot_file_count: 2,
  screenshot_path: "D:/shots",
  video_usage_mb: 3,
  video_max_mb: 200,
  video_file_count: 4,
  video_path: "D:/videos",
};

beforeEach(() => {
  vi.clearAllMocks();
  useRunnerHealth.mockReturnValue({ isOffline: false, isLoading: false });
  getStorageInfo.mockResolvedValue(STORAGE_INFO);
});

describe("StorageSettingsPage — the Disk section outranks the runner guards", () => {
  it("renders the Disk section even when the runner is OFFLINE", async () => {
    useRunnerHealth.mockReturnValue({ isOffline: true, isLoading: false });
    render(<StorageSettingsPage />);
    // Free space is a coord read. An offline runner has nothing to say about
    // it, so hiding it behind the runner's health was a failed read presented
    // as no read at all.
    await waitFor(() =>
      expect(screen.getByTestId("disk-section")).toBeInTheDocument()
    );
    expect(screen.getByTestId("offline-state")).toBeInTheDocument();
    expect(getStorageInfo).not.toHaveBeenCalled();
  });

  it("renders the Disk section while the media read is still loading", async () => {
    useRunnerHealth.mockReturnValue({ isOffline: false, isLoading: true });
    render(<StorageSettingsPage />);
    expect(screen.getByTestId("disk-section")).toBeInTheDocument();
  });

  it("still renders both once the media read lands", async () => {
    render(<StorageSettingsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Screenshots and videos/i })
      ).toBeInTheDocument()
    );
    expect(screen.getByTestId("disk-section")).toBeInTheDocument();
    expect(screen.queryByTestId("offline-state")).not.toBeInTheDocument();
  });
});
