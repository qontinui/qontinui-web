import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchChangeLog: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import type { ChangeLogEntry } from "./api";
import { ChangeLogPanel } from "./ChangeLogPanel";

function entry(over: Partial<ChangeLogEntry>): ChangeLogEntry {
  return {
    id: "e1",
    resource: "pages",
    record_id: "p1",
    action: "update",
    source: "ui",
    actor: "dana@example.com",
    created_at: "2026-10-07T00:00:00Z",
    version_before: 1,
    version_after: 2,
    before: null,
    after: null,
    ...over,
  };
}

const viaApi = entry({
  id: "e2",
  source: "api",
  actor: "ops@example.com",
  via_session: "1d390724-33f3-42f8-98d4-a17ff7621116",
  via_device: "7c2e9a10-0000-4000-8000-000000000001",
});

function renderPanel() {
  render(
    <ChangeLogPanel
      resource="pages"
      recordId="p1"
      updatedBy="ops@example.com"
      updatedAt="2026-10-07T00:00:00Z"
      uiBridgeId="t.log"
    />
  );
}

describe("ChangeLogPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the reported session and device of a write an agent made", async () => {
    api.fetchChangeLog.mockResolvedValue({
      entries: [viaApi, entry({})],
      truncated: false,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(
      await screen.findByText(
        /through the API \(reported session 1d390724, device 7c2e9a10\)/
      )
    ).toBeTruthy();
    expect(api.fetchChangeLog).toHaveBeenCalledWith("pages", "p1", undefined);
  });

  it("filters to the writes made through the API", async () => {
    api.fetchChangeLog.mockResolvedValue({
      entries: [viaApi, entry({})],
      truncated: false,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(api.fetchChangeLog).toHaveBeenLastCalledWith("pages", "p1", {
      source: "api",
    });
    // A server that ignored the filter still shows API writes only.
    await screen.findByText(/through the API/);
    expect(screen.queryByText(/on the overview/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show all changes" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    // The unfiltered reply was the whole history: the local filter is
    // complete, so nothing is said about older changes.
    expect(screen.queryByText(/were checked for API writes/)).toBeNull();
  });

  it("says the API-only view is partial when an unfiltered reply was cut short", async () => {
    api.fetchChangeLog.mockResolvedValue({
      entries: [viaApi, entry({})],
      truncated: true,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(
      await screen.findByText(
        /Only the latest 2 changes were checked for API writes/
      )
    ).toBeTruthy();
    expect(
      screen.queryByText("Showing the most recent changes only.")
    ).toBeNull();
  });

  it("says plainly there is no API write when an unfiltered reply was the whole history", async () => {
    api.fetchChangeLog.mockResolvedValue({
      entries: [entry({}), entry({ id: "e3" })],
      truncated: false,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findAllByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(
      await screen.findByText("No change has been made through the API yet.")
    ).toBeTruthy();
    expect(screen.queryByText(/None of the latest/)).toBeNull();
    expect(screen.queryByText(/were checked for API writes/)).toBeNull();
  });

  it("does not claim no API write when an unfiltered reply was cut short", async () => {
    api.fetchChangeLog.mockResolvedValue({
      entries: [entry({}), entry({ id: "e3" })],
      truncated: true,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findAllByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(
      await screen.findByText(
        "None of the latest 2 changes was made through the API."
      )
    ).toBeTruthy();
    expect(
      screen.queryByText("No change has been made through the API yet.")
    ).toBeNull();
    // The unfiltered history's truncation is not the filtered view's.
    expect(
      screen.queryByText("Showing the most recent changes only.")
    ).toBeNull();
  });

  it("trusts a server that filtered and found no API write", async () => {
    api.fetchChangeLog
      .mockResolvedValueOnce({ entries: [entry({})], truncated: false })
      .mockResolvedValueOnce({ entries: [], truncated: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(
      await screen.findByText("No change has been made through the API yet.")
    ).toBeTruthy();
  });

  it("passes on a filtering server's truncation", async () => {
    api.fetchChangeLog
      .mockResolvedValueOnce({ entries: [entry({})], truncated: false })
      .mockResolvedValueOnce({ entries: [viaApi], truncated: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText(/on the overview/);
    fireEvent.click(
      screen.getByRole("button", { name: "Only changes through the API" })
    );
    expect(
      await screen.findByText("Showing the most recent changes only.")
    ).toBeTruthy();
    expect(screen.queryByText(/were checked for API writes/)).toBeNull();
  });
});
