/**
 * The `/environments` → `/sessions?device=…` cross-link — plan
 * `2026-08-26-sessions-console-consolidation` Phase 3, §D.
 *
 * Two things are pinned here, and the second is the one a later edit would
 * break silently:
 *
 * 1. The link spells `?device=` VERBATIM. That is the same param the deleted
 *    `/environments/sessions` took and the same one `/sessions` reads, which
 *    is why the 308 could pass it through untouched.
 * 2. A machine with no `coord_device_id` gets NO link and an explicit
 *    sentence. Linking it anyway would render a confident empty list for a
 *    machine whose sessions simply cannot be addressed — the absence-is-not-
 *    zero failure this plan's D2 exists to prevent.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SessionsCrossLinkCard } from "./SessionsCrossLinkCard";
import type { Machine } from "@/services/devenv-api";

function machine(over: Partial<Machine> & { id: string }): Machine {
  return {
    name: over.id,
    hostname: null,
    description: null,
    key_prefix: null,
    enrolled: true,
    last_seen_at: null,
    revoked: false,
    environment_id: null,
    coord_device_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("SessionsCrossLinkCard", () => {
  it("deep-links a bridged machine with ?device= verbatim", () => {
    render(
      <SessionsCrossLinkCard
        machines={[
          machine({ id: "m1", hostname: "box-a", coord_device_id: "dev-1" }),
        ]}
      />
    );
    const link = screen.getByTestId("environments-sessions-device-link");
    expect(link).toHaveAttribute("href", "/sessions?device=dev-1");
    expect(link).toHaveTextContent("box-a");
  });

  it("percent-encodes the device id rather than trusting it", () => {
    render(
      <SessionsCrossLinkCard
        machines={[machine({ id: "m1", coord_device_id: "a/b c" })]}
      />
    );
    expect(
      screen.getByTestId("environments-sessions-device-link")
    ).toHaveAttribute("href", "/sessions?device=a%2Fb%20c");
  });

  it("offers no link for an unbridged machine, and says why", () => {
    render(
      <SessionsCrossLinkCard
        machines={[machine({ id: "m1", hostname: "box-a" })]}
      />
    );
    expect(
      screen.queryByTestId("environments-sessions-device-link")
    ).toBeNull();
    expect(
      screen.getByText(/not bridged to coord/i)
    ).toBeInTheDocument();
  });

  it("counts unbridged machines beside the bridged ones", () => {
    render(
      <SessionsCrossLinkCard
        machines={[
          machine({ id: "m1", coord_device_id: "dev-1" }),
          machine({ id: "m2" }),
          machine({ id: "m3" }),
        ]}
      />
    );
    expect(
      screen.getAllByTestId("environments-sessions-device-link")
    ).toHaveLength(1);
    expect(
      screen.getByText(/2 machines not bridged to coord/i)
    ).toBeInTheDocument();
  });

  it("renders an unread list as UNKNOWN, not as an empty fleet", () => {
    render(<SessionsCrossLinkCard machines={null} />);
    expect(
      screen.getByTestId("environments-sessions-unknown")
    ).toHaveTextContent("–");
    expect(screen.queryByText(/No machine is bridged/i)).toBeNull();
  });

  it("distinguishes an EMPTY answer from an unread one", () => {
    render(<SessionsCrossLinkCard machines={[]} />);
    expect(screen.queryByTestId("environments-sessions-unknown")).toBeNull();
    expect(screen.getByText(/No machine is bridged/i)).toBeInTheDocument();
  });

  it("caps the chip list and defers the rest to /environments/machines", () => {
    render(
      <SessionsCrossLinkCard
        limit={2}
        machines={[
          machine({ id: "m1", coord_device_id: "d1" }),
          machine({ id: "m2", coord_device_id: "d2" }),
          machine({ id: "m3", coord_device_id: "d3" }),
        ]}
      />
    );
    expect(
      screen.getAllByTestId("environments-sessions-device-link")
    ).toHaveLength(2);
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  it("always offers the unfiltered console", () => {
    render(<SessionsCrossLinkCard machines={null} />);
    expect(
      screen.getByTestId("environments-sessions-all-link")
    ).toHaveAttribute("href", "/sessions");
  });
});
