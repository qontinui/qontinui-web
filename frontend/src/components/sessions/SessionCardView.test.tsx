import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SessionCard } from "@/services/agent-sessions-api";
import { SessionCardView } from "./SessionCardView";

/**
 * SessionCardView — the machine + runner-page rows (plan
 * `2026-11-16-runner-page-name-reaches-the-coord-session-identity-card`,
 * Phase 3b, D4/D5/D6). Every case asserts on rendered TEXT: an unknown must
 * say so, never render blank.
 */

// The panes fetch on mount; they are not what this file tests.
vi.mock("./ResumePanel", () => ({ ResumePanel: () => null }));
vi.mock("./TranscriptPane", () => ({ TranscriptPane: () => null }));
vi.mock("./LiveTailPane", () => ({ LiveTailPane: () => null }));

const BASE: SessionCard = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "fix-the-card",
  label: null,
  derived_name: "fix-the-card",
  user_id: null,
  device_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  first_seen: null,
  last_seen: null,
  closed_at: null,
  status: "live",
  machine: null,
  summary: null,
  working_on: null,
};

function renderCard(overrides: Partial<SessionCard>) {
  render(<SessionCardView card={{ ...BASE, ...overrides }} />);
}

const machineRow = () => screen.getByTestId("session-card-machine");
const pageRow = () => screen.getByTestId("session-card-runner-page");

describe("SessionCardView machine row", () => {
  it("links a devenv machine and names the source", () => {
    renderCard({
      machine: {
        id: "m-1",
        name: "nawa",
        hostname: "nawa.local",
        environment: { id: "e-1", name: "home" },
        source: "devenv",
      },
    });
    const link = within(machineRow()).getByRole("link", { name: "nawa" });
    expect(link.getAttribute("href")).toBe("/environments/machines");
    expect(machineRow().textContent).toContain("nawa.local");
    expect(machineRow().textContent).toContain("via devenv");
  });

  it("renders a coord_device machine as text, with no dead link", () => {
    renderCard({
      machine: {
        id: null,
        name: "nawa",
        hostname: "nawa.local",
        environment: null,
        source: "coord_device",
      },
    });
    expect(within(machineRow()).queryByRole("link")).toBeNull();
    expect(machineRow().textContent).toContain("nawa");
    expect(machineRow().textContent).toContain("nawa.local");
    expect(machineRow().textContent).toContain("via coord device");
  });

  it("says the source is unknown on an older coord that serves none", () => {
    renderCard({
      machine: {
        id: "m-1",
        name: "nawa",
        hostname: null,
        environment: null,
      },
    });
    expect(
      within(machineRow()).getByRole("link", { name: "nawa" })
    ).toBeTruthy();
    expect(machineRow().textContent).toContain("source unknown");
  });

  it("renders the reason when machine is null", () => {
    renderCard({ machine: null, machine_unknown_reason: "no_device_row" });
    expect(machineRow().textContent).toContain(
      "machine unknown: no device row"
    );
  });

  it("says the reason is not served when machine and reason are both absent", () => {
    renderCard({ machine: null });
    expect(machineRow().textContent).toContain(
      "machine unknown (reason not served)"
    );
    // The device id is still shown so the operator has a referent.
    expect(machineRow().textContent).toContain(BASE.device_id as string);
  });

  it("renders a bare 'machine unknown' for an explicit null reason", () => {
    renderCard({ machine: null, machine_unknown_reason: null });
    const text = machineRow().textContent ?? "";
    expect(text).toContain("machine unknown");
    expect(text).not.toContain("reason not served");
  });

  it("shows an unrecognised reason verbatim rather than dropping it", () => {
    renderCard({ machine: null, machine_unknown_reason: "brand_new_reason" });
    expect(machineRow().textContent).toContain(
      "machine unknown: brand new reason"
    );
  });

  it("falls back to the hostname when a coord_device machine has no name", () => {
    renderCard({
      machine: {
        id: null,
        name: null,
        hostname: "nawa",
        environment: null,
        source: "coord_device",
      },
    });
    expect(machineRow().textContent).toContain("nawa");
    expect(within(machineRow()).queryByRole("link")).toBeNull();
  });
});

describe("SessionCardView runner-page row", () => {
  const MACHINE = {
    id: null,
    name: "nawa",
    hostname: "nawa.local",
    environment: null,
    source: "coord_device" as const,
  };

  it("renders name, page id, window and machine for a fresh page", () => {
    renderCard({
      machine: MACHINE,
      runner_page: {
        page_id: "page-7",
        name: "Reviews",
        name_withheld: false,
        window: "main",
        terminal_id: "t-1",
        observed_at: new Date().toISOString(),
        fresh: true,
      },
    });
    const text = pageRow().textContent ?? "";
    expect(text).toContain("Reviews");
    expect(text).toContain("page-7");
    expect(text).toContain("window main");
    expect(text).toContain("on nawa");
    expect(text).not.toContain("stale");
  });

  it("marks a stale page and shows when it was observed", () => {
    renderCard({
      machine: MACHINE,
      runner_page: {
        page_id: "page-7",
        name: "Reviews",
        name_withheld: false,
        window: "popout-2",
        terminal_id: null,
        observed_at: "2026-11-01T10:00:00Z",
        fresh: false,
      },
    });
    const text = pageRow().textContent ?? "";
    expect(text).toContain("stale");
    expect(text).toContain("last observed");
    expect(text).toContain("window popout-2");
  });

  it("renders 'withheld' when the name was withheld", () => {
    renderCard({
      machine: MACHINE,
      runner_page: {
        page_id: "page-7",
        name: null,
        name_withheld: true,
        window: "main",
        terminal_id: null,
        observed_at: new Date().toISOString(),
        fresh: true,
      },
    });
    expect(pageRow().textContent).toContain("name withheld");
    expect(pageRow().textContent).toContain("page-7");
  });

  it("renders 'unnamed' for a null, non-withheld name", () => {
    renderCard({
      machine: MACHINE,
      runner_page: {
        page_id: "page-7",
        name: null,
        name_withheld: false,
        window: null,
        terminal_id: null,
        observed_at: new Date().toISOString(),
        fresh: true,
      },
    });
    expect(pageRow().textContent).toContain("unnamed");
    expect(pageRow().textContent).toContain("window unknown");
  });

  it("keeps a long name whole and exposes it in a title", () => {
    const long = "A".repeat(119) + "…";
    renderCard({
      machine: MACHINE,
      runner_page: {
        page_id: "page-7",
        name: long,
        name_withheld: false,
        window: "main",
        terminal_id: null,
        observed_at: new Date().toISOString(),
        fresh: true,
      },
    });
    const name = within(pageRow()).getByText(long);
    expect(name.getAttribute("title")).toBe(long);
  });

  it("renders the reason when runner_page is null", () => {
    renderCard({
      runner_page: null,
      runner_page_unknown_reason: "never_reported",
    });
    expect(pageRow().textContent).toContain(
      "Runner page: unknown (never reported)"
    );
  });

  it("renders 'not served' when the field is absent entirely", () => {
    renderCard({});
    expect(pageRow().textContent).toContain(
      "Runner page: unknown (not served)"
    );
  });
  it("renders a bare unknown when runner_page is null with no reason", () => {
    renderCard({ runner_page: null, runner_page_unknown_reason: null });
    const text = pageRow().textContent ?? "";
    expect(text).toContain("Runner page: unknown");
    expect(text).not.toContain("not served");
  });

  it("never says 'observed never' for an unparseable observed_at", () => {
    renderCard({
      runner_page: {
        page_id: "page-7",
        name: "Reviews",
        name_withheld: false,
        window: "main",
        terminal_id: null,
        observed_at: "not-a-time",
        fresh: true,
      },
    });
    const text = pageRow().textContent ?? "";
    expect(text).not.toContain("never");
    expect(text).toContain("observed at an unknown time");
  });
});
