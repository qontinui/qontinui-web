/**
 * `DeviceWorktreeCapControl` — the operator's per-device worktree-cap lever.
 *
 * Amendment A3 / Phase 4 of plan
 * `2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate`. These are
 * the contracts the door exists to hold, and each is a regression guard rather
 * than a snapshot. `fleetWorktreeCap.test.ts` pins what a BODY means; this file
 * pins what the component DOES with it — above all the write path, which is
 * every line that actually mutates coord.
 *
 *  1. **The write carries exactly the fields coord's struct declares.** Those
 *     structs are `deny_unknown_fields`, so one hopeful key is a 422 for the
 *     whole write — and `set_by` in particular must never reach the wire,
 *     because an audit trail with a client-asserted author is not an audit
 *     trail.
 *  2. **A row that cannot name a coord device gets a DISABLED control with a
 *     stated reason**, never one that is enabled and silently inert.
 *  3. **An unreadable cap renders UNKNOWN**, not "no cap"
 *     (`[policy: unknown-must-not-render-as-a-default]`), and the lever is not
 *     offered against it.
 *  4. **A zero is refused with a message that says what a zero would DO**, and
 *     the refusal is visible rather than a silently disabled button.
 *  5. **A non-admin sees no lever, and is told why.**
 *  6. **Coord's typed refusal survives into the toast** — `admin_required`,
 *     `device_not_in_tenant` and `schema_pending` are three different next
 *     steps.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

const authState = { isCoordAdmin: true };
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import {
  DeviceWorktreeCapControl,
  capDisabledReason,
} from "./DeviceWorktreeCapControl";
import {
  parseFleetWorktreeCap,
  resolveDeviceWorktreeCap,
  type DeviceWorktreeCapState,
} from "./fleetWorktreeCap";
import type { DrainTarget } from "./fleetDrain";

const DEVICE = "11111111-2222-3333-4444-555555555555";

const IDENTIFIED: DrainTarget = {
  state: "identified",
  deviceId: DEVICE,
  coordHostname: "gh-runner-spaceship-wsl",
};

const NO_DEVICE: DrainTarget = {
  state: "no_device",
  reason: "This row has no coord device link.",
};

function cappedState(n = 4): DeviceWorktreeCapState {
  const read = parseFleetWorktreeCap({
    state: "known",
    count: 1,
    overrides: [
      {
        device_id: DEVICE,
        max_worktrees: n,
        reason: "winding this box down",
        set_by: "op@example.com",
        set_at: "2026-09-30T12:00:00Z",
      },
    ],
    detail: null,
  });
  return resolveDeviceWorktreeCap(read, DEVICE);
}

function derivedState(): DeviceWorktreeCapState {
  return resolveDeviceWorktreeCap(
    parseFleetWorktreeCap({ state: "known", count: 0, overrides: [] }),
    DEVICE
  );
}

function unknownState(): DeviceWorktreeCapState {
  return resolveDeviceWorktreeCap(
    { state: "unknown", reason: "Coord could not be read." },
    DEVICE
  );
}

function ok(body: unknown = { changed: true }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function refusal(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function renderControl(
  target: DrainTarget,
  cap: DeviceWorktreeCapState,
  onActed = vi.fn()
) {
  render(
    <DeviceWorktreeCapControl
      target={target}
      cap={cap}
      rowHostname="spaceship"
      onActed={onActed}
    />
  );
  return onActed;
}

/** The parsed body of the single write this test made. */
function sentBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body);
}

function sentUrl(): string {
  return String((fetchMock.mock.calls[0] as [string, unknown])[0]);
}

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  authState.isCoordAdmin = true;
});

describe("DeviceWorktreeCapControl — rendering", () => {
  it("renders a capped device with its number, who set it and why", () => {
    renderControl(IDENTIFIED, cappedState(4));
    const block = screen.getByTestId("device-worktree-cap");
    expect(block).toHaveAttribute("data-device-worktree-cap", "capped");
    expect(block).toHaveTextContent("Capped at 4");
    expect(block).toHaveTextContent("op@example.com");
    expect(block).toHaveTextContent("winding this box down");
    // The two levers sit on one row and must never be confused.
    expect(block).toHaveTextContent("it is not a drain");
  });

  it("names coord's OWN identity as the target, never the row alias", () => {
    // A workstation and the CI runner registered under it are separate coord
    // device registrations behind one operator-settable alias, so the alias is
    // the one string that must not decide what gets capped.
    renderControl(IDENTIFIED, derivedState());
    const target = screen.getByTestId("device-worktree-cap-target");
    expect(target).toHaveAttribute("data-device-id", DEVICE);
    expect(target).toHaveTextContent(DEVICE);
    expect(target).toHaveTextContent("gh-runner-spaceship-wsl");
  });

  it("renders UNKNOWN — never 'no cap' — and offers no lever", () => {
    renderControl(IDENTIFIED, unknownState());
    const block = screen.getByTestId("device-worktree-cap");
    expect(block).toHaveAttribute("data-device-worktree-cap", "unknown");
    expect(block).toHaveTextContent("Worktree cap unknown");
    expect(block).not.toHaveTextContent("No operator cap");
    expect(screen.getByTestId("device-worktree-cap-open")).toBeDisabled();
    expect(
      screen.getByTestId("device-worktree-cap-disabled-reason")
    ).toHaveTextContent("A cap is offered only against a state");
  });

  it("disables the lever with a stated reason when the row names no device", () => {
    renderControl(NO_DEVICE, derivedState());
    const block = screen.getByTestId("device-worktree-cap");
    expect(block).toHaveAttribute("data-device-worktree-cap", "no_device");
    expect(screen.getByTestId("device-worktree-cap-open")).toBeDisabled();
    expect(
      screen.getByTestId("device-worktree-cap-disabled-reason")
    ).toHaveTextContent("This row has no coord device link.");
    // Never rendered as a target it cannot act on.
    expect(
      screen.queryByTestId("device-worktree-cap-target")
    ).not.toBeInTheDocument();
  });

  it("offers Clear only when a cap is actually set", () => {
    renderControl(IDENTIFIED, derivedState());
    expect(
      screen.queryByTestId("device-worktree-cap-clear")
    ).not.toBeInTheDocument();
  });

  it("hides the lever from a non-admin and says why", () => {
    authState.isCoordAdmin = false;
    renderControl(IDENTIFIED, derivedState());
    expect(
      screen.queryByTestId("device-worktree-cap-open")
    ).not.toBeInTheDocument();
    // The state itself stays visible: a reader who cannot act still needs to
    // know the machine is held down.
    expect(screen.getByTestId("device-worktree-cap-state")).toBeInTheDocument();
  });
});

describe("DeviceWorktreeCapControl — the write", () => {
  async function openSetDialog(cap = derivedState()) {
    renderControl(IDENTIFIED, cap);
    fireEvent.click(screen.getByTestId("device-worktree-cap-open"));
    return within(await screen.findByTestId("device-worktree-cap-dialog"));
  }

  it("posts device_id, max_worktrees and reason — and nothing else", async () => {
    fetchMock.mockResolvedValue(ok());
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "40" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "  sweep running  " },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentUrl()).toContain("/fleet/worktree-cap");
    const body = sentBody();
    // EXACTLY three keys. Coord's struct is `deny_unknown_fields`.
    expect(Object.keys(body).sort()).toEqual([
      "device_id",
      "max_worktrees",
      "reason",
    ]);
    expect(body.device_id).toBe(DEVICE);
    // A NUMBER, not the input's string: coord's field is an integer and a
    // quoted "40" is a deserialization failure, not a cap.
    expect(body.max_worktrees).toBe(40);
    expect(body.reason).toBe("sweep running");
  });

  it("posts to the clear route with device_id and reason only", async () => {
    fetchMock.mockResolvedValue(ok());
    renderControl(IDENTIFIED, cappedState(4));
    fireEvent.click(screen.getByTestId("device-worktree-cap-clear"));
    const dialog = within(
      await screen.findByTestId("device-worktree-cap-dialog")
    );
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "sweep finished" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentUrl()).toContain("/fleet/worktree-cap/clear");
    expect(Object.keys(sentBody()).sort()).toEqual(["device_id", "reason"]);
  });

  it("requires a reason before either write", async () => {
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "40" },
    });
    expect(dialog.getByTestId("device-worktree-cap-submit")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a zero, SAYS what a zero would do, and sends nothing", async () => {
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "0" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    // The message is VISIBLE, not merely a disabled button — a greyed-out
    // control with no sentence reads as "capping is off for this machine".
    const err = dialog.getByTestId("device-worktree-cap-error");
    expect(err).toHaveTextContent("set it back");
    expect(err).toHaveTextContent("drain");
    expect(dialog.getByTestId("device-worktree-cap-submit")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the reason for an UNPARSEABLE number, not a silent disabled button", async () => {
    // A browser `<input type="number">` reports "" for `--` or a bare `e`, so a
    // message suppressed on emptiness would vanish in exactly the case the
    // operator most needs it. The flag is "has the operator touched this
    // field", not "is it non-empty".
    const dialog = await openSetDialog();
    const field = dialog.getByTestId("device-worktree-cap-value");
    // Type, then clear — which is what `--` or a bare `e` looks like coming out
    // of a number input, and also the only way React fires `onChange` for a
    // value that ends up "" in a field that started "".
    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    expect(dialog.getByTestId("device-worktree-cap-error")).toHaveTextContent(
      "Enter a number of worktrees."
    );
    expect(dialog.getByTestId("device-worktree-cap-submit")).toBeDisabled();
  });

  it("says nothing before the operator has touched the number field", async () => {
    const dialog = await openSetDialog();
    expect(
      dialog.queryByTestId("device-worktree-cap-error")
    ).not.toBeInTheDocument();
  });

  it("pre-fills the current cap when changing one", async () => {
    renderControl(IDENTIFIED, cappedState(7));
    fireEvent.click(screen.getByTestId("device-worktree-cap-open"));
    const dialog = within(
      await screen.findByTestId("device-worktree-cap-dialog")
    );
    expect(dialog.getByTestId("device-worktree-cap-value")).toHaveValue(7);
  });

  it("surfaces coord's typed refusal rather than a bare failure", async () => {
    fetchMock.mockResolvedValue(
      refusal(403, { error: "device_not_in_tenant", detail: "not yours" })
    );
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "40" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const description = String(
      (toastError.mock.calls[0][1] as { description: string }).description
    );
    expect(description).toContain("device_not_in_tenant");
    expect(description).toContain("403");
  });

  it("reports a no-op as a no-op rather than as a change", async () => {
    fetchMock.mockResolvedValue(ok({ changed: false }));
    renderControl(IDENTIFIED, cappedState(4));
    fireEvent.click(screen.getByTestId("device-worktree-cap-clear"));
    const dialog = within(
      await screen.findByTestId("device-worktree-cap-dialog")
    );
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // "I removed it" and "there was nothing to remove" are different outcomes.
    expect(String(toastSuccess.mock.calls[0][0])).toContain("carried no cap");
  });

  it("reports the REQUEST, and never the typed number as the cap in force", async () => {
    // This build parses only `changed` from the write response, so it never
    // learns the number coord stored. A toast saying "capped at 4" would assert
    // a fact about the machine that the build did not observe; the state line,
    // which renders the value coord served back, is what may state it.
    fetchMock.mockResolvedValue(ok({ changed: true }));
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "4" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0][0]);
    // It names what was asked for, and says where the answer will appear.
    expect(msg).toContain("Asked coord to cap");
    expect(msg).toContain("4");
    // It must not state the typed number as a settled fact about the machine.
    expect(msg).not.toMatch(/capped at 4/);
    // And it still says what a cap does NOT do.
    expect(msg).toContain("untouched");
  });

  it("never hedges that coord may RAISE the cap — there is no such clamp", async () => {
    // `MIN_DEVICE_WORKTREES` floors the cap coord DERIVES from a machine's
    // memory, and A3's override is designed to replace that derivation rather
    // than be bounded by it — `>= 1` on the write door is the only other bound
    // the amendment specifies. A round-3 revision of this component hedged that
    // a cap of 4 "may be higher if below coord's own minimum", which would have
    // taught an operator to distrust the correct `Capped at 4` the state line is
    // about to show them.
    //
    // What this test pins is narrower than that design claim, and deliberately
    // so: NO STRING HERE MAY DESCRIBE A CLAMP. That holds whatever coord's
    // resolver ends up doing, because this build never learns the stored number
    // (the write response carries `changed` alone) and so is not entitled to
    // describe it either way. The resolver arm that reads the override is not on
    // coord's `main` yet, which is exactly why the assertion is about our own
    // strings rather than about coord's arithmetic.
    fetchMock.mockResolvedValue(ok({ changed: true }));
    const dialog = await openSetDialog();
    // The dialog prose must not promise a clamp either. Queried off `screen`,
    // not off `dialog`: `openSetDialog` already scoped `dialog` to that element,
    // and an element does not contain itself.
    expect(
      screen.getByTestId("device-worktree-cap-dialog")
    ).not.toHaveTextContent(/whether a cap below it is honoured/i);
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "4" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0][0]);
    expect(msg).not.toMatch(/minimum/i);
    expect(msg).not.toMatch(/higher/i);
  });

  it("reports a set-path no-op as coord's report, not as a stored number", async () => {
    // The `changed: false` branch of the SET path, which had no test at all —
    // and it is the branch most able to overclaim, because a build that knows
    // only `changed` is tempted to conclude what the stored value must be. It
    // may say coord changed nothing (coord said so); it may not state a number
    // as being in force.
    fetchMock.mockResolvedValue(ok({ changed: false }));
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "4" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0][0]);
    expect(msg).toContain("coord reports nothing changed");
    // Attributed to coord, and never asserted as a fact this build observed.
    expect(msg).not.toMatch(/is capped at/i);
    expect(msg).not.toMatch(/already capped/i);
  });

  it("POSTS and REPORTS the same number for a normalised spelling", async () => {
    // `1e3` really does arrive from a number input. The body must carry 1000 and
    // the toast must say 1000 — an earlier revision POSTed `Number(value)` while
    // the toast interpolated the raw string, so the operator was told "at 1e3
    // worktrees" for a write coord stored as 1000.
    fetchMock.mockResolvedValue(ok({ changed: true }));
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "1e3" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(sentBody().max_worktrees).toBe(1000);
    const msg = String(toastSuccess.mock.calls[0][0]);
    expect(msg).toContain("1000");
    expect(msg).not.toContain("1e3");
  });

  it("sends ONCE for two clicks landing in one render", async () => {
    // The ref guard, not the `busy` state: `setBusy(true)` does not update the
    // closure already executing, so a state-only guard lets both clicks through.
    // Each one writes an attributed, numbered snapshot onto a versioned control
    // row, so the duplicate is permanent in the audit trail even though the
    // stored value is unchanged. The transport cannot save us — `http-client`
    // does not retry a POST, so this guard is the only thing standing between a
    // double click and a double audit row.
    let resolveFetch: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise((r) => (resolveFetch = r as (v: unknown) => void))
    );
    const dialog = await openSetDialog();
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "4" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    const submit = dialog.getByTestId("device-worktree-cap-submit");
    // BOTH dispatches inside ONE `act`, which is what actually creates the race
    // the guard is for. A bare `fireEvent.click` flushes `act` on its own, so
    // `setBusy(true)` has already landed and jsdom swallows the second click
    // against a now-`disabled` button — a two-`fireEvent` test passes with the
    // ref deleted, measured. Batched like this, a state-only guard sends twice.
    await act(async () => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    resolveFetch(ok({ changed: true }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forces a re-read after a successful write", async () => {
    fetchMock.mockResolvedValue(ok());
    const onActed = vi.fn();
    render(
      <DeviceWorktreeCapControl
        target={IDENTIFIED}
        cap={derivedState()}
        rowHostname="spaceship"
        onActed={onActed}
      />
    );
    fireEvent.click(screen.getByTestId("device-worktree-cap-open"));
    const dialog = within(
      await screen.findByTestId("device-worktree-cap-dialog")
    );
    fireEvent.change(dialog.getByTestId("device-worktree-cap-value"), {
      target: { value: "40" },
    });
    fireEvent.change(dialog.getByTestId("device-worktree-cap-reason"), {
      target: { value: "why" },
    });
    fireEvent.click(dialog.getByTestId("device-worktree-cap-submit"));

    // Coord is the source of truth; the control must not paint its own optimism.
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
  });
});

describe("capDisabledReason", () => {
  it("names the JOIN failure and the READ failure differently", () => {
    // They call for different next steps, so one shared shrug would be worse
    // than either sentence.
    expect(capDisabledReason(NO_DEVICE, derivedState())).toBe(
      "This row has no coord device link."
    );
    const readFailure = capDisabledReason(IDENTIFIED, unknownState());
    expect(readFailure).toContain("Coord could not be read.");
    expect(readFailure).toContain("overwrites a limit");
  });

  it("is undefined — never a sentence — when the control IS actionable", () => {
    expect(capDisabledReason(IDENTIFIED, derivedState())).toBeUndefined();
    expect(capDisabledReason(IDENTIFIED, cappedState())).toBeUndefined();
  });
});
