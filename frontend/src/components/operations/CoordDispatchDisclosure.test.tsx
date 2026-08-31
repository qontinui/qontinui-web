import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const postMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    post: (...args: unknown[]) => postMock(...args),
    get: vi.fn(),
    fetch: vi.fn(),
  },
}));

// Mutable rather than a constant `true`, so one test can prove the
// `CoordAdminOnly` gate is actually wired — a hard-coded admin mock would let
// an accidental unwrap ship undetected.
const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import { CoordDispatchDisclosure } from "./CoordDispatchDisclosure";
import { drainScopeSentences, type DrainResponse } from "./coordDrain";

/**
 * The "Pause coord dispatch" control — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 1.
 *
 * Three things are under test, in descending order of how badly they would
 * hurt if they broke:
 *
 *  1. **The control does not overstate its reach.** Phase 1's gate has a
 *     negative half: with a host paused, GitHub still routes CI to it and
 *     sessions can still be spawned into it, and the copy must already say so.
 *     A control that reads as "Disable" would have been useless in the incident
 *     this plan was written from.
 *  2. **The expiry is chosen and sent, never defaulted away.** Coord's
 *     `until` is mandatory by construction; a UI that quietly filled it in
 *     would reintroduce exactly the "permanent removal wearing an expiry's
 *     clothes" §D2 forbids.
 *  3. **The write cannot happen by accident** — blank reason refused locally,
 *     a confirm that names the blast radius, and no admin gate bypass.
 */

const DEVICE = "11111111-2222-3333-4444-555555555555";
const HOST = "msi-wsl";

const OK: DrainResponse = {
  device_id: DEVICE,
  drained: true,
  until: "2026-09-01T12:00:00Z",
  reason: "clippy failing 2/2",
  drained_by: "operator@example.com",
  drained_at: "2026-08-31T12:00:00Z",
  version: 17,
  changed: true,
};

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  postMock.mockReset();
  authState.isCoordAdmin = true;
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

/** Render and open the collapsed disclosure. */
function openPanel(
  props: {
    deviceId?: string;
    hostname?: string;
    ciInfrastructure?: boolean;
  } = {}
) {
  render(
    <CoordDispatchDisclosure
      deviceId={"deviceId" in props ? props.deviceId : DEVICE}
      hostname={props.hostname ?? HOST}
      ciInfrastructure={props.ciInfrastructure}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Coord dispatch/i }));
}

describe("disclosure shape", () => {
  it("is collapsed until opened, so a fleet write is never under the cursor", () => {
    render(<CoordDispatchDisclosure deviceId={DEVICE} hostname={HOST} />);
    expect(screen.queryByTestId(`coord-dispatch-pause-${HOST}`)).toBeNull();
  });

  it("persists nothing about being open", () => {
    // No `storageKey` — a consent surface opens because someone opened it,
    // this time. Asserted structurally: the module must not name one.
    expect(CoordDispatchDisclosure.toString().includes("storageKey")).toBe(
      false
    );
  });
});

describe("the honesty gate", () => {
  it("renders the exact scope sentences, not a paraphrase of them", () => {
    openPanel();
    for (const sentence of drainScopeSentences(HOST)) {
      expect(screen.getByText(sentence)).toBeTruthy();
    }
  });

  it("never labels the action a disable", () => {
    openPanel();
    const pause = screen.getByTestId(`coord-dispatch-pause-${HOST}`);
    expect(pause.textContent).toMatch(/Pause coord dispatch/);
    expect(document.body.textContent?.toLowerCase()).not.toContain("disable");
  });

  it("says current drain state is UNKNOWN rather than 'not paused'", () => {
    // Coord serves no read of the drain map. Rendering "not paused" would be a
    // claim about the machine on no evidence.
    openPanel();
    const note = screen.getByTestId("coord-dispatch-state-unknown");
    expect(note.textContent).toMatch(/Current state: unknown/);
    expect(note.textContent).toMatch(/not the same as saying it is not/);
  });
});

describe("the write", () => {
  it("refuses a blank reason locally and posts nothing", () => {
    openPanel();
    fireEvent.click(screen.getByTestId(`coord-dispatch-pause-${HOST}`));
    expect(
      screen.getByTestId(`coord-dispatch-error-${HOST}`).textContent
    ).toMatch(/Reason is required/);
    expect(postMock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("posts device_id, a chosen expiry and the reason", async () => {
    postMock.mockResolvedValue(OK);
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "clippy failing 2/2" },
    });
    fireEvent.change(screen.getByTestId(`coord-dispatch-until-${HOST}`), {
      target: { value: "24h" },
    });
    const before = Date.now();
    fireEvent.click(screen.getByTestId(`coord-dispatch-pause-${HOST}`));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [url, body] = postMock.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(url).toMatch(/\/operations\/fleet\/drain$/);
    expect(body.device_id).toBe(DEVICE);
    expect(body.reason).toBe("clippy failing 2/2");
    // The expiry is REAL — computed from the selected window at click time,
    // ~24h out, and carrying an explicit UTC offset.
    const until = Date.parse(body.until as string);
    expect(until - before).toBeGreaterThan(23.5 * 3_600_000);
    expect(until - before).toBeLessThan(24.5 * 3_600_000);
    expect(body.until).toMatch(/Z$/);
  });

  it("confirms with the blast radius before posting", async () => {
    postMock.mockResolvedValue(OK);
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "because" },
    });
    fireEvent.click(screen.getByTestId(`coord-dispatch-pause-${HOST}`));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const text = confirmSpy.mock.calls[0]?.[0] as string;
    expect(text).toContain(HOST);
    expect(text).toMatch(/GitHub Actions routing is UNCHANGED/);
  });

  it("posts nothing when the confirm is declined", () => {
    confirmSpy.mockReturnValue(false);
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "because" },
    });
    fireEvent.click(screen.getByTestId(`coord-dispatch-pause-${HOST}`));
    expect(postMock).not.toHaveBeenCalled();
  });

  it("sends NO expiry on a resume", async () => {
    postMock.mockResolvedValue({ ...OK, drained: false, until: null });
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "host healthy again" },
    });
    fireEvent.click(screen.getByTestId(`coord-dispatch-resume-${HOST}`));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [url, body] = postMock.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(url).toMatch(/\/operations\/fleet\/undrain$/);
    expect(body).not.toHaveProperty("until");
  });

  it("reports a no-op release as a no-op, not as a release", async () => {
    postMock.mockResolvedValue({
      ...OK,
      drained: false,
      until: null,
      changed: false,
    });
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "just checking" },
    });
    fireEvent.click(screen.getByTestId(`coord-dispatch-resume-${HOST}`));
    await waitFor(() =>
      expect(
        screen.getByTestId(`coord-dispatch-result-${HOST}`).textContent
      ).toMatch(/nothing to release/)
    );
  });

  it("surfaces a failed write rather than implying it worked", async () => {
    postMock.mockRejectedValue(new Error("POST failed: 403 - not_operator"));
    openPanel();
    fireEvent.change(screen.getByTestId(`coord-dispatch-reason-${HOST}`), {
      target: { value: "because" },
    });
    fireEvent.click(screen.getByTestId(`coord-dispatch-pause-${HOST}`));
    await waitFor(() =>
      expect(
        screen.getByTestId(`coord-dispatch-error-${HOST}`).textContent
      ).toMatch(/403/)
    );
    expect(screen.queryByTestId(`coord-dispatch-result-${HOST}`)).toBeNull();
  });
});

describe("gating", () => {
  it("offers no control to a non-admin", () => {
    authState.isCoordAdmin = false;
    openPanel();
    expect(screen.queryByTestId(`coord-dispatch-pause-${HOST}`)).toBeNull();
    expect(screen.getByTestId("coord-admin-only-notice")).toBeTruthy();
  });

  it("offers no control — and makes no claim — for a row with no coord device", () => {
    openPanel({ deviceId: undefined });
    expect(screen.queryByTestId(`coord-dispatch-pause-${HOST}`)).toBeNull();
    const notice = screen.getByTestId("coord-dispatch-unavailable");
    expect(notice.getAttribute("data-coord-dispatch")).toBe("no_device");
    expect(notice.textContent).toMatch(/Nothing here says/);
  });

  it("offers NO control for a GitHub Actions runner — the write reaches nothing", () => {
    // Coord would ACCEPT it: these devices are tenant-bound, so Gate 2 passes
    // and the route answers 200. But the registrar gives them
    // `capabilities = ["ci_runner"]` and no `role`, while both readers of the
    // drain map select `ci_node` / `role = 'build'`. A button here would
    // report "Paused." over a guaranteed no-op — the worse direction of the
    // same defect an earlier cut had.
    openPanel({ ciInfrastructure: true });
    expect(screen.queryByTestId(`coord-dispatch-pause-${HOST}`)).toBeNull();
    const notice = screen.getByTestId("coord-dispatch-unavailable");
    expect(notice.getAttribute("data-coord-dispatch")).toBe(
      "ci_runner_not_a_dispatch_target"
    );
  });

  it("says WHY, without repeating the retracted tenant-binding story", () => {
    openPanel({ ciInfrastructure: true });
    const notice = screen.getByTestId("coord-dispatch-unavailable");
    expect(notice.textContent).toMatch(/would accept the pause/);
    expect(notice.textContent).toContain("ci_runner");
    expect(notice.textContent).toContain("ci_node");
    // And it points at the lever that DOES move this host.
    expect(notice.textContent).toContain("qontinui");
    // The false premise must not come back.
    expect(notice.textContent).not.toMatch(/tenant_devices/);
  });

  it("adds no such note to an ordinary workstation row", () => {
    openPanel({ ciInfrastructure: false });
    expect(screen.queryByTestId("coord-dispatch-ci-note")).toBeNull();
    expect(screen.getByTestId(`coord-dispatch-pause-${HOST}`)).toBeTruthy();
  });
});
