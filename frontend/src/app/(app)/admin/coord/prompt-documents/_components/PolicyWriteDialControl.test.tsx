/**
 * PolicyWriteDialControl — what the operator can read off the dial, and what it
 * refuses to do on one click.
 *
 * The hook's own tests pin the resolution rules. These pin the two things only
 * the rendered control can get wrong:
 *
 * 1. **Every state the dial can be in is NAMED.** A level coord cannot parse, a
 *    narrower band overriding the tenant row this control writes, a write whose
 *    read-back failed — each is a case where the level shown alone would leave
 *    the operator with a wrong belief that nothing else on the page corrects.
 * 2. **`full` is not applied on a single click.** It is the only level at which
 *    a policy change reaches the fleet without the operator seeing it first,
 *    which is the same reason `AgentWriteAccessControl` confirms overriding a
 *    built-in protection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FleetPolicyView } from "../../_shared/fleetPolicy";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PolicyWriteDialControl } from "./PolicyWriteDialControl";

function view(over: Partial<FleetPolicyView> = {}): FleetPolicyView {
  return {
    domain: "policy_write",
    effective_level: "tightening_only",
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    ...over,
  };
}

function okWrite(effective: FleetPolicyView | null, readbackError = null) {
  return {
    ok: true,
    domain: "policy_write",
    written_level: "full",
    written_master_enabled: true,
    versioned: true,
    version: 1,
    updated_by: "operator@example.com",
    effective,
    readback_error: readbackError,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PolicyWriteDialControl — names every state it can be in", () => {
  it("labels a missing row as coord's built-in default, not as off", async () => {
    getMock.mockResolvedValue(
      view({
        effective_level: "off",
        master_enabled: false,
        resolved_scope: "none",
      })
    );

    render(<PolicyWriteDialControl />);

    // The wire says `off`; the fleet is on `tightening_only`. The readout must
    // show the second and say where it came from — scoped to the readout,
    // because the level list describes the default too and an assertion that
    // matched either would pass on a badge still rendering `off`.
    const inForce = await screen.findByTestId("policy-write-in-force");
    expect(inForce).toHaveTextContent("tightening_only");
    expect(inForce).not.toHaveTextContent(/^In force:\s*off/);
    expect(inForce).toHaveTextContent(/built-in default/i);
    expect(inForce).toHaveTextContent(/no one has set this tenant/i);
  });

  it("names an unparseable row, and shows the level coord actually enforces", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "tightening-only", resolved_scope: "tenant" })
    );

    render(<PolicyWriteDialControl />);

    const banner = await screen.findByTestId("policy-write-unrecognized-level");
    // The raw stored value, so the operator knows which row to fix...
    expect(banner).toHaveTextContent("tightening-only");
    // ...and what it costs them right now: coord refuses everything.
    expect(banner).toHaveTextContent(/refuses/i);
    // The readout shows what the fleet enforces, not what the row stores.
    const inForce = screen.getByTestId("policy-write-in-force");
    expect(inForce).toHaveTextContent(/^In force:\s*off/);
    expect(inForce).toHaveTextContent(/fail-closed/i);
    expect(inForce).not.toHaveTextContent("tightening-only");
  });

  it("does not promise to fix an unparseable row this control cannot write", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "tightening-only", resolved_scope: "repo" })
    );

    render(<PolicyWriteDialControl />);

    const banner = await screen.findByTestId("policy-write-unrecognized-level");
    // The control writes the tenant band only. Telling the operator that
    // picking a level below clears a broken REPO row would send them round a
    // loop that cannot terminate.
    expect(banner).toHaveTextContent(/cannot rewrite that row/i);
    expect(banner).not.toHaveTextContent(/rewrites that row and clears this/i);
  });

  it("says the level is unknown, not off, when the very first read fails", async () => {
    getMock.mockRejectedValue(new Error("coord is not reachable"));

    render(<PolicyWriteDialControl />);

    // Nothing has ever been read, so there is no "value below" to call stale —
    // and the one claim the console must never make on no evidence is that
    // agent policy writes are off.
    expect(await screen.findByText(/unknown/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("policy-write-in-force")
    ).not.toBeInTheDocument();
  });

  it("warns when a repo-band row overrides the tenant row this control writes", async () => {
    getMock.mockResolvedValue(view({ resolved_scope: "repo" }));

    render(<PolicyWriteDialControl />);

    const banner = await screen.findByTestId("policy-write-overridden-by-repo");
    expect(banner).toHaveTextContent(/keeps.*overriding/i);
    expect(
      screen.queryByTestId("policy-write-system-fallback")
    ).not.toBeInTheDocument();
  });

  it("says a write takes effect when only a system-band row is answering", async () => {
    getMock.mockResolvedValue(view({ resolved_scope: "system" }));

    render(<PolicyWriteDialControl />);

    const note = await screen.findByTestId("policy-write-system-fallback");
    expect(note).toHaveTextContent(/takes effect immediately/i);
  });

  it("accounts for control blocks coord returned but this view does not carry", async () => {
    getMock.mockResolvedValue(
      view({
        keys_not_shown: ["controls", "drain"],
        keys_not_shown_source: "fleet_resources_row",
      })
    );

    render(<PolicyWriteDialControl />);

    const note = await screen.findByTestId("policy-write-keys-not-shown");
    expect(note).toHaveTextContent("controls, drain");
    // Whose data it is matters: reading another domain's blocks as this
    // domain's is the mistake the field exists to prevent.
    expect(note).toHaveTextContent(/fleet_resources/);
  });

  it("names what was written beside a read-back that failed", async () => {
    getMock.mockResolvedValue(view({ effective_level: "off" }));
    putMock.mockResolvedValue({
      ...okWrite(null, "coord returned 502" as unknown as null),
      written_level: "propose_only",
    });

    const user = userEvent.setup();
    render(<PolicyWriteDialControl />);
    await screen.findByTestId("policy-write-dial");

    await user.click(screen.getByLabelText(/propose_only/));

    const banner = await screen.findByTestId("policy-write-readback-error");
    // Both halves: the write that landed, and the resolution that is unknown.
    expect(banner).toHaveTextContent("propose_only");
    expect(banner).toHaveTextContent(/unknown/i);
  });
});

describe("PolicyWriteDialControl — full is offered, and confirmed", () => {
  it("offers full at all — coord retired the clamp that justified hiding it", async () => {
    getMock.mockResolvedValue(view());

    render(<PolicyWriteDialControl />);

    await screen.findByTestId("policy-write-dial");
    expect(screen.getByLabelText(/full/)).toBeInTheDocument();
    // The old copy claimed coord clamps `full` server-side. It no longer does,
    // and a console that keeps saying so is describing a restriction it is in
    // fact imposing itself.
    expect(screen.queryByText(/clamps it to/i)).not.toBeInTheDocument();
  });

  it("does not write full on the first click", async () => {
    getMock.mockResolvedValue(view());

    const user = userEvent.setup();
    render(<PolicyWriteDialControl />);
    await screen.findByTestId("policy-write-dial");

    await user.click(screen.getByLabelText(/full/));

    await screen.findByTestId("policy-write-confirm");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("leaves the fleet untouched when the confirmation is cancelled", async () => {
    getMock.mockResolvedValue(view());

    const user = userEvent.setup();
    render(<PolicyWriteDialControl />);
    await screen.findByTestId("policy-write-dial");

    await user.click(screen.getByLabelText(/full/));
    await screen.findByTestId("policy-write-confirm");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("policy-write-confirm")
      ).not.toBeInTheDocument()
    );
    expect(putMock).not.toHaveBeenCalled();
    // The selection is controlled by what the fleet resolves, so a cancelled
    // confirmation must not leave the radio sitting on a level nobody set.
    expect(screen.getByLabelText(/tightening_only/)).toBeChecked();
  });

  it("writes full once confirmed", async () => {
    getMock.mockResolvedValue(view());
    putMock.mockResolvedValue(okWrite(view({ effective_level: "full" })));

    const user = userEvent.setup();
    render(<PolicyWriteDialControl />);
    await screen.findByTestId("policy-write-dial");

    await user.click(screen.getByLabelText(/full/));
    await screen.findByTestId("policy-write-confirm");
    await user.click(screen.getByRole("button", { name: /set to full/i }));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1].level).toBe("full");
  });

  it("applies a narrowing level immediately — only widening is confirmed", async () => {
    getMock.mockResolvedValue(view());
    putMock.mockResolvedValue({
      ...okWrite(view({ effective_level: "off" })),
      written_level: "off",
    });

    const user = userEvent.setup();
    render(<PolicyWriteDialControl />);
    await screen.findByTestId("policy-write-dial");

    await user.click(screen.getByLabelText(/^off/));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(
      screen.queryByTestId("policy-write-confirm")
    ).not.toBeInTheDocument();
  });
});
