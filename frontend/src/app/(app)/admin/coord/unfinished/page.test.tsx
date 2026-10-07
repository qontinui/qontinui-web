/**
 * /admin/coord/unfinished — the states that must not collapse:
 * unknown vs empty, stale vs empty, and the actions' wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    patch: (...a: unknown[]) => patchMock(...a),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import UnfinishedSessionsPage from "./page";
import { RESUME_UNFINISHED_API, UNFINISHED_API } from "./types";

const ROW = {
  claude_session_id: "11111111-1111-1111-1111-111111111111",
  coord_session_id: "22222222-2222-2222-2222-222222222222",
  device_id: "33333333-3333-3333-3333-333333333333",
  hostname: "box",
  account_label: ".claude-x",
  config_dir: null,
  working_dir: null,
  worktree_path: null,
  work_unit_slug: "some-plan",
  last_acted_at: null,
  closed_at: "2026-10-06T00:00:00Z",
  liveness: "process_gone",
  liveness_basis: "census",
  transcript: { coord_warm_bytes: 5, coord_cold: true },
  last_resume_attempt_at: null,
  resume_verdict: "B",
};

function route(
  list: unknown,
  policy: unknown = { resume_unfinished_enabled: false, can_edit: true }
) {
  getMock.mockImplementation(async (url: string) => {
    if (url === UNFINISHED_API) {
      if (list instanceof Error) throw list;
      return list;
    }
    if (url === RESUME_UNFINISHED_API) return policy;
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UnfinishedSessionsPage", () => {
  it("renders UNKNOWN, not an empty list, when coord says unknown", async () => {
    route({
      state: "unknown",
      reason: "census_unreadable",
      detail: null,
      sessions: null,
      truncated: false,
    });
    render(<UnfinishedSessionsPage />);
    await screen.findByTestId("unfinished-unknown");
    expect(screen.queryByTestId("unfinished-empty")).toBeNull();
    expect(screen.getByTestId("unfinished-health").textContent).toMatch(
      /UNKNOWN/
    );
  });

  it("says empty only for a read that was ok and had no rows", async () => {
    route({
      state: "ok",
      reason: null,
      detail: null,
      sessions: [],
      truncated: false,
    });
    render(<UnfinishedSessionsPage />);
    await screen.findByTestId("unfinished-empty");
  });

  it("a failed first read is unknown, not none", async () => {
    route(new Error("boom"));
    render(<UnfinishedSessionsPage />);
    await screen.findByTestId("unfinished-read-failed");
    expect(screen.queryByTestId("unfinished-empty")).toBeNull();
  });

  it("Resume posts the row's device and account; Dismiss posts dismiss", async () => {
    route({
      state: "ok",
      reason: null,
      detail: null,
      sessions: [ROW],
      truncated: false,
    });
    postMock.mockResolvedValue({});
    render(<UnfinishedSessionsPage />);
    const row = await screen.findByTestId("unfinished-row");
    expect(screen.getByTestId("unfinished-verdict").textContent).toMatch(/B/);
    fireEvent.click(row.querySelector("button") ?? row);
    // Wait for the policy read so can_edit enables the buttons.
    await waitFor(() =>
      expect(
        (screen.getByTestId("unfinished-resume") as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByTestId("unfinished-resume"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        `${UNFINISHED_API}/${ROW.coord_session_id}/resume`,
        { target_device_id: ROW.device_id, account: ROW.account_label }
      )
    );
    fireEvent.click(screen.getByTestId("unfinished-dismiss"));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        `${UNFINISHED_API}/${ROW.claude_session_id}/dismiss`,
        {}
      )
    );
  });

  it("disables Resume with a stated reason when the device is unrecorded", async () => {
    route({
      state: "ok",
      reason: null,
      detail: null,
      sessions: [{ ...ROW, device_id: null }],
      truncated: false,
    });
    render(<UnfinishedSessionsPage />);
    const row = await screen.findByTestId("unfinished-row");
    fireEvent.click(row.querySelector("button") ?? row);
    await screen.findByTestId("unfinished-resume-blocked");
    expect(
      (screen.getByTestId("unfinished-resume") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("the toggle never resolves an unreported value to ON", async () => {
    route(
      {
        state: "ok",
        reason: null,
        detail: null,
        sessions: [],
        truncated: false,
      },
      { resume_unfinished_enabled: null, can_edit: true }
    );
    render(<UnfinishedSessionsPage />);
    await screen.findByTestId("resume-unfinished-unreported");
    expect(screen.getByTestId("resume-unfinished-effective").textContent).toBe(
      "unknown"
    );
  });

  it("the toggle sends only the flag and shows coord's re-read", async () => {
    route(
      {
        state: "ok",
        reason: null,
        detail: null,
        sessions: [],
        truncated: false,
      },
      { resume_unfinished_enabled: false, can_edit: true }
    );
    patchMock.mockResolvedValue({
      written: true,
      effective: { resume_unfinished_enabled: true, can_edit: true },
      readback_error: null,
    });
    render(<UnfinishedSessionsPage />);
    await waitFor(() =>
      expect(
        (screen.getByTestId("resume-unfinished-on") as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByTestId("resume-unfinished-on"));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(RESUME_UNFINISHED_API, {
        resume_unfinished_enabled: true,
      })
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("resume-unfinished-effective").textContent
      ).toBe("on")
    );
  });
});
