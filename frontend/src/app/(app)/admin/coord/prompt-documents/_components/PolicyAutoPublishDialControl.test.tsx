/**
 * PolicyAutoPublishDialControl — the D5 kill switch for automatic publishing.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish`. The sibling dials'
 * tests pin the shared resolution rules; these pin the three things this domain
 * gets wrong in a way nothing else on the page corrects:
 *
 * 1. **"No row" is `on`, not the resolver's bare `off`.** Coord answers
 *    `effective_level: "off"` both for "nobody ever wrote a row" and for "an
 *    operator turned it off". Reading the first literally ships the whole
 *    feature dark — the worker decides nothing, holds nothing and publishes
 *    nothing, with no error anywhere, which is indistinguishable from the eight
 *    silent days the plan exists to end.
 * 2. **An unparseable level is `off`, and the row is NAMED.** What this dial
 *    authorises is this tenant's bodies reaching every other tenant with no
 *    human in the loop; a setting coord cannot read is not permission to do
 *    that, and it must not render as an operator's choice.
 * 3. **`on` is confirmed; `off` is not.** `on` is the direction that sends
 *    documents out without a click. A kill switch that needs a confirmation to
 *    PULL is a kill switch nobody pulls in time.
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

import { PolicyAutoPublishDialControl } from "./PolicyAutoPublishDialControl";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function view(over: Partial<FleetPolicyView> = {}): FleetPolicyView {
  return {
    domain: "policy_auto_publish",
    effective_level: "on",
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what the operator can read off the dial", () => {
  it("names 'no row' as coord's built-in default rather than as off", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "off", resolved_scope: "none" })
    );
    render(<PolicyAutoPublishDialControl />);

    const inForce = await screen.findByTestId("policy-auto-publish-in-force");
    expect(inForce).toHaveTextContent("on");
    expect(inForce).toHaveTextContent(/built-in default \(on\)/);
    expect(inForce).toHaveTextContent(/no one has set this tenant/i);
  });

  it("resolves an unrecognised level to off and names the row that holds it", async () => {
    getMock.mockResolvedValue(
      view({ effective_level: "sometimes", resolved_scope: "tenant" })
    );
    render(<PolicyAutoPublishDialControl />);

    const notice = await screen.findByTestId(
      "policy-auto-publish-unrecognized-level"
    );
    expect(notice).toHaveTextContent("sometimes");
    expect(notice).toHaveTextContent("tenant");
    expect(
      screen.getByTestId("policy-auto-publish-in-force")
    ).toHaveTextContent("off");
    // NOT the typed default. "Nobody ruled" and "somebody ruled unreadably"
    // are different facts, and only one of them is permission.
    expect(
      screen.getByTestId("policy-auto-publish-in-force")
    ).toHaveTextContent(/fail-closed reading/i);
  });

  it("says a narrower band is overriding the row this control writes", async () => {
    getMock.mockResolvedValue(view({ resolved_scope: "repo" }));
    render(<PolicyAutoPublishDialControl />);

    expect(
      await screen.findByTestId("policy-auto-publish-overridden-by-repo")
    ).toHaveTextContent(/repo/);
  });

  it("states what the switch does NOT stop", async () => {
    // D5: publish-all, the single Publish button and the daily recovery
    // reconcile keep running at `off`. An operator who reads this as "nothing
    // publishes any more" will go looking for a broken button.
    getMock.mockResolvedValue(view());
    render(<PolicyAutoPublishDialControl />);

    await screen.findByTestId("policy-auto-publish-in-force");
    expect(screen.getByTestId("policy-auto-publish-dial")).toHaveTextContent(
      /Publish all changed and the per-document Publish/
    );
  });
});

describe("what it refuses to do on one click", () => {
  it("confirms turning automatic publishing on", async () => {
    getMock.mockResolvedValue(view({ effective_level: "off" }));
    render(<PolicyAutoPublishDialControl />);

    await screen.findByTestId("policy-auto-publish-in-force");
    await user().click(screen.getByTestId("policy-auto-publish-level-on"));

    const confirm = await screen.findByTestId("policy-auto-publish-confirm");
    expect(confirm).toHaveTextContent(/cannot be withdrawn/i);
    // The plain statement of operator decision 3, unsoftened.
    expect(confirm).toHaveTextContent(
      /agent's edit publishes on the same terms/i
    );
    expect(putMock).not.toHaveBeenCalled();

    await user().click(
      screen.getByTestId("policy-auto-publish-confirm-accept")
    );
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [, body] = putMock.mock.calls[0] as [
      string,
      { domain: string; level: string; master_enabled: boolean },
    ];
    expect(body.domain).toBe("policy_auto_publish");
    expect(body.level).toBe("on");
    // `off` stays a LEVEL, never a master flip: coord folds `master_enabled`
    // into `effective_level`, so flipping both gives "off" two spellings the
    // operator cannot tell apart.
    expect(body.master_enabled).toBe(true);
  });

  it("applies off immediately, with no confirmation in the way", async () => {
    getMock.mockResolvedValue(view({ effective_level: "on" }));
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_auto_publish",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      effective: view({ effective_level: "off" }),
      readback_error: null,
    });
    render(<PolicyAutoPublishDialControl />);

    await screen.findByTestId("policy-auto-publish-in-force");
    await user().click(screen.getByTestId("policy-auto-publish-level-off"));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(
      screen.queryByTestId("policy-auto-publish-confirm")
    ).not.toBeInTheDocument();
    const [, body] = putMock.mock.calls[0] as [string, { level: string }];
    expect(body.level).toBe("off");
  });
  it("tells the page a level landed, so the list re-reads its badges", async () => {
    getMock.mockResolvedValue(view({ effective_level: "on" }));
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_auto_publish",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      effective: view({ effective_level: "off" }),
      readback_error: null,
    });
    const onLevelChanged = vi.fn();
    render(<PolicyAutoPublishDialControl onLevelChanged={onLevelChanged} />);

    await screen.findByTestId("policy-auto-publish-in-force");
    await user().click(screen.getByTestId("policy-auto-publish-level-off"));

    await waitFor(() => expect(onLevelChanged).toHaveBeenCalledTimes(1));
  });

  it("reports a change after the confirmed path too", async () => {
    getMock.mockResolvedValue(view({ effective_level: "off" }));
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_auto_publish",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      effective: view({ effective_level: "on" }),
      readback_error: null,
    });
    const onLevelChanged = vi.fn();
    render(<PolicyAutoPublishDialControl onLevelChanged={onLevelChanged} />);

    await screen.findByTestId("policy-auto-publish-in-force");
    await user().click(screen.getByTestId("policy-auto-publish-level-on"));
    expect(onLevelChanged).not.toHaveBeenCalled();
    await user().click(
      await screen.findByTestId("policy-auto-publish-confirm-accept")
    );

    await waitFor(() => expect(onLevelChanged).toHaveBeenCalledTimes(1));
  });

  it("does not report a change when the write fails", async () => {
    getMock.mockResolvedValue(view({ effective_level: "on" }));
    putMock.mockRejectedValue(new Error("boom"));
    const onLevelChanged = vi.fn();
    render(<PolicyAutoPublishDialControl onLevelChanged={onLevelChanged} />);

    await screen.findByTestId("policy-auto-publish-in-force");
    await user().click(screen.getByTestId("policy-auto-publish-level-off"));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(onLevelChanged).not.toHaveBeenCalled();
  });
});
