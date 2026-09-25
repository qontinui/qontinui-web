/**
 * TranscriptSyncPanel — the states that must not collapse into plain on/off.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/useTranscriptSyncPolicy.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const useTranscriptSyncPolicyMock = vi.fn();
vi.mock("../_hooks/useTranscriptSyncPolicy", () => ({
  useTranscriptSyncPolicy: () => useTranscriptSyncPolicyMock(),
}));

import { TranscriptSyncPanel } from "./TranscriptSyncPanel";

function hookState(
  policy: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    policy,
    loading: false,
    saving: false,
    error: null,
    readbackError: null,
    reload: vi.fn(),
    setEnabled: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const ON = {
  transcript_sync_enabled: true,
  column_missing: false,
  can_edit: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TranscriptSyncPanel", () => {
  it("shows what coord enforces and writes the other value", () => {
    const state = hookState(ON);
    useTranscriptSyncPolicyMock.mockReturnValue(state);
    render(<TranscriptSyncPanel />);

    expect(screen.getByTestId("transcript-sync-effective").textContent).toBe(
      "on"
    );
    fireEvent.click(screen.getByTestId("transcript-sync-off"));
    expect(state.setEnabled).toHaveBeenCalledWith(false);
  });

  it("renders an unreported flag as unknown, not on", () => {
    useTranscriptSyncPolicyMock.mockReturnValue(
      hookState({ ...ON, transcript_sync_enabled: null })
    );
    render(<TranscriptSyncPanel />);

    expect(screen.getByTestId("transcript-sync-effective").textContent).toBe(
      "unknown"
    );
    expect(screen.getByTestId("transcript-sync-unreported")).toBeTruthy();
  });

  it("says a fail-closed off was not anyone's decision", () => {
    useTranscriptSyncPolicyMock.mockReturnValue(
      hookState({ ...ON, transcript_sync_enabled: false, column_missing: true })
    );
    render(<TranscriptSyncPanel />);

    expect(
      screen.getByTestId("transcript-sync-column-missing").textContent
    ).toMatch(/Nobody turned it off/);
  });

  it("disables the write for a non-admin and says why", () => {
    useTranscriptSyncPolicyMock.mockReturnValue(
      hookState({ ...ON, can_edit: false })
    );
    render(<TranscriptSyncPanel />);

    expect(
      (screen.getByTestId("transcript-sync-off") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByTestId("transcript-sync-readonly").textContent).toMatch(
      /not an admin/
    );
  });

  it("separates an unknown role from a refused one when the read failed", () => {
    useTranscriptSyncPolicyMock.mockReturnValue(
      hookState(null, { error: "HTTP 502" })
    );
    render(<TranscriptSyncPanel />);

    expect(screen.getByTestId("transcript-sync-readonly").textContent).toMatch(
      /could not be read/
    );
    expect(screen.getByTestId("transcript-sync-error").textContent).toMatch(
      /unknown/
    );
  });

  it("surfaces a missing read-back instead of the written value", () => {
    useTranscriptSyncPolicyMock.mockReturnValue(
      hookState(ON, {
        readbackError: "coord did not return the policy it re-read",
      })
    );
    render(<TranscriptSyncPanel />);

    expect(screen.getByTestId("transcript-sync-readback-error")).toBeTruthy();
  });
});
