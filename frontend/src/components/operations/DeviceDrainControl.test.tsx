/**
 * `DeviceDrainControl` — the operator's Drain / Undrain lever on a machine row.
 *
 * Plan `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase
 * 4b. These are the four contracts the phase exists to hold, and each is a
 * regression guard rather than a snapshot:
 *
 *  1. **A row that cannot name a coord device gets a DISABLED control with a
 *     stated reason** — never one that is enabled and silently inert. The plan
 *     names this failure twice (a row with no coord device link, and the
 *     `spaceship` / `gh-runner-spaceship-wsl` pair), and both need the same
 *     fix: never render an enabled drain control that cannot name its target.
 *  2. **A drained row says until / by / reason** — a bare disabled control
 *     with no provenance is not an acceptable rendering of "this machine is
 *     out of the fleet".
 *  3. **An unreadable drain renders UNKNOWN**, not "not drained" and not
 *     green (`[policy: unknown-must-not-render-as-a-default]`).
 *  4. **Nothing identifying is truncated or occluded**
 *     (`[policy: ux-priorities no-widget-may-hide-identifying-text]`). jsdom
 *     has no layout, so the predicate is structural: no clipping class may
 *     appear on the target line or the state block, and the full device id and
 *     coord hostname must be present as text.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

import { DeviceDrainControl, disabledReason } from "./DeviceDrainControl";
import {
  parseFleetDrain,
  resolveDeviceDrain,
  resolveDrainTarget,
  toLocalInputValue,
  type DeviceDrainState,
  type DrainTarget,
} from "./fleetDrain";

const DEVICE = "11111111-2222-3333-4444-555555555555";
const NOW = Date.parse("2026-09-01T12:00:00Z");

const IDENTIFIED: DrainTarget = {
  state: "identified",
  deviceId: DEVICE,
  coordHostname: "gh-runner-spaceship-wsl",
};

function drainedState(): DeviceDrainState {
  const read = parseFleetDrain({
    drained: {
      [DEVICE]: {
        until: "2026-09-01T18:00:00Z",
        reason: "rebuilding the runner",
        drained_by: "jspinak@gmail.com",
        drained_at: "2026-09-01T11:00:00Z",
      },
    },
  });
  return resolveDeviceDrain(read, DEVICE, NOW);
}

function renderControl(
  overrides: Partial<React.ComponentProps<typeof DeviceDrainControl>> = {}
) {
  const onActed = vi.fn();
  const utils = render(
    <DeviceDrainControl
      target={IDENTIFIED}
      drain={{ state: "not_drained" }}
      rowHostname="spaceship-wsl"
      onActed={onActed}
      {...overrides}
    />
  );
  return { onActed, ...utils };
}

/** A successful `httpClient.fetch` response. */
function okResponse(body: unknown = { changed: true }): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Classes that hide text by clipping it. jsdom does no layout, so an
 * occlusion test has to be structural — this is the executable form of
 * "no widget may hide identifying text".
 */
const CLIPPING_CLASSES = [
  "truncate",
  "text-ellipsis",
  "overflow-hidden",
  "whitespace-nowrap",
  "line-clamp-1",
  "line-clamp-2",
  "max-h-",
];

function assertNoClipping(root: HTMLElement) {
  const offenders: string[] = [];
  const walk = (el: Element) => {
    // `<button>` is exempt: the shared `Button` primitive carries
    // `whitespace-nowrap` for every console surface, and its labels ("Drain…",
    // "Undrain") are fixed UI words, not identifying text. The rule protects
    // the hostname, the device id and the drain state — which is what the rest
    // of this walk covers.
    if (el.tagName === "BUTTON") return;
    const cls = el.className;
    const text = typeof cls === "string" ? cls : "";
    for (const bad of CLIPPING_CLASSES) {
      if (text.split(/\s+/).some((c) => c === bad || c.startsWith(bad))) {
        offenders.push(`${el.tagName.toLowerCase()}.${text}`);
      }
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  expect(offenders).toEqual([]);
}

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  authState.isCoordAdmin = true;
});

describe("DeviceDrainControl — a row with no drainable identity", () => {
  const NO_DEVICE = resolveDrainTarget({ matched: false });

  it("disables the control and STATES the reason in visible prose", () => {
    renderControl({ target: NO_DEVICE });

    const button = screen.getByTestId("device-drain-open");
    expect(button).toBeDisabled();
    // Not merely a `title` — a reader on a touch device never sees one.
    const reason = screen.getByTestId("device-drain-disabled-reason");
    expect(reason).toBeInTheDocument();
    expect(reason.textContent).toContain("no device row for this host");
    expect(screen.getByTestId("device-drain")).toHaveAttribute(
      "data-device-drain",
      "no_device"
    );
  });

  it("names no target it cannot act on", () => {
    // The label must never be manufactured from the row's display name: the
    // whole hazard is a control that claims to act on a machine it does not.
    renderControl({ target: NO_DEVICE });
    expect(screen.queryByTestId("device-drain-target")).not.toBeInTheDocument();
  });

  it("says nothing about whether the machine is taking work", () => {
    renderControl({ target: NO_DEVICE, drain: { state: "not_drained" } });
    const state = screen.getByTestId("device-drain-state");
    // `no_device` wins over the drain state: with no device id there was
    // nothing to ask about, so a calm "not drained" here would be a claim on
    // no evidence.
    expect(state.textContent).not.toContain("Not drained — coord may send");
    expect(state.textContent).toContain("No coord device to drain");
  });

  it("opens no dialog when the disabled button is clicked", () => {
    renderControl({ target: NO_DEVICE });
    fireEvent.click(screen.getByTestId("device-drain-open"));
    expect(screen.queryByTestId("device-drain-dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DeviceDrainControl — a drained row", () => {
  it("renders until, by and reason", () => {
    renderControl({ drain: drainedState(), now: NOW });

    const block = screen.getByTestId("device-drain-state");
    expect(block.textContent).toContain("Drained until");
    expect(block.textContent).toContain("jspinak@gmail.com");
    expect(block.textContent).toContain("rebuilding the runner");
    // The remaining time, so a deadline six hours out does not read as "just
    // now" (which is what the shared relative formatter would say).
    expect(block.textContent).toContain("in 6h");
    expect(screen.getByTestId("device-drain")).toHaveAttribute(
      "data-device-drain",
      "drained"
    );
  });

  it("does not imply that running work is stopped", () => {
    renderControl({ drain: drainedState(), now: NOW });
    expect(screen.getByTestId("device-drain-state").textContent).toContain(
      "anything already running on it keeps running"
    );
  });

  it("offers Undrain rather than Drain", () => {
    renderControl({ drain: drainedState(), now: NOW });
    expect(screen.getByTestId("device-drain-undrain")).toBeEnabled();
    expect(screen.queryByTestId("device-drain-open")).not.toBeInTheDocument();
  });

  it("names the coord device the release will act on", async () => {
    renderControl({ drain: drainedState(), now: NOW });
    fireEvent.click(screen.getByTestId("device-drain-undrain"));
    const dialog = await screen.findByTestId("device-drain-dialog");
    expect(dialog.textContent).toContain(DEVICE);
    expect(dialog.textContent).toContain("gh-runner-spaceship-wsl");
  });

  it("requires a reason before releasing, as coord does", async () => {
    renderControl({ drain: drainedState(), now: NOW });
    fireEvent.click(screen.getByTestId("device-drain-undrain"));
    await screen.findByTestId("device-drain-dialog");
    expect(screen.getByTestId("device-drain-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuild finished" },
    });
    expect(screen.getByTestId("device-drain-submit")).toBeEnabled();
  });

  it("reports a no-op release honestly rather than as a success", async () => {
    fetchMock.mockResolvedValue(okResponse({ changed: false }));
    const { onActed } = renderControl({ drain: drainedState(), now: NOW });
    fireEvent.click(screen.getByTestId("device-drain-undrain"));
    await screen.findByTestId("device-drain-dialog");
    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuild finished" },
    });
    fireEvent.click(screen.getByTestId("device-drain-submit"));

    await waitFor(() => expect(onActed).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0]?.[0])).toContain("was not drained");
  });
});

describe("DeviceDrainControl — an unreadable drain", () => {
  const UNKNOWN: DeviceDrainState = {
    state: "unknown",
    reason: "Coord serves no drain read on this deployment (404).",
  };

  it("renders UNKNOWN, never 'not drained'", () => {
    renderControl({ drain: UNKNOWN });
    const block = screen.getByTestId("device-drain-state");
    expect(block.textContent).toContain("Drain state unknown");
    expect(block.textContent).toContain("404");
    expect(block.textContent).not.toContain("Not drained");
    expect(screen.getByTestId("device-drain")).toHaveAttribute(
      "data-device-drain",
      "unknown"
    );
  });

  it("says the unknown is about the READ, not about the machine", () => {
    renderControl({ drain: UNKNOWN });
    expect(screen.getByTestId("device-drain-state").textContent).toContain(
      "a statement about the read, not about the machine"
    );
  });

  it("disables the control with a reason rather than acting on a guess", () => {
    renderControl({ drain: UNKNOWN });
    expect(screen.getByTestId("device-drain-open")).toBeDisabled();
    expect(
      screen.getByTestId("device-drain-disabled-reason").textContent
    ).toContain("404");
  });

  it("still names the target, which IS known", () => {
    // The join succeeded; only the drain read failed. Withdrawing the target
    // label too would report the wrong thing as missing.
    renderControl({ drain: UNKNOWN });
    expect(screen.getByTestId("device-drain-target").textContent).toContain(
      DEVICE
    );
  });
});

describe("DeviceDrainControl — an expired drain", () => {
  it("says it lapsed rather than that somebody released it", () => {
    const state = resolveDeviceDrain(
      parseFleetDrain({
        drained: {
          [DEVICE]: {
            until: "2026-09-01T11:30:00Z",
            reason: "rebuild",
            drained_by: "jspinak@gmail.com",
            drained_at: "2026-09-01T10:00:00Z",
          },
        },
      }),
      DEVICE,
      NOW
    );
    renderControl({ drain: state, now: NOW });
    const block = screen.getByTestId("device-drain-state");
    expect(block.textContent).toContain("the last drain expired");
    expect(block.textContent).toContain("Nobody undrained it");
    // And the row is drainable again.
    expect(screen.getByTestId("device-drain-open")).toBeEnabled();
  });
});

describe("DeviceDrainControl — the mandatory expiry", () => {
  function openDrainDialog() {
    renderControl();
    fireEvent.click(screen.getByTestId("device-drain-open"));
    return screen.findByTestId("device-drain-dialog");
  }

  it("offers no 'no expiry' option and starts with none chosen", async () => {
    const dialog = await openDrainDialog();
    expect(
      (screen.getByTestId("device-drain-until") as HTMLInputElement).value
    ).toBe("");
    expect(dialog.textContent).toMatch(/no.{0,3}expiry.{0,3} option/i);
    // Nothing can be submitted until the operator picks one.
    expect(screen.getByTestId("device-drain-submit")).toBeDisabled();
  });

  it("explains why the field is blocking, in the dialog", async () => {
    await openDrainDialog();
    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuild" },
    });
    expect(screen.getByTestId("device-drain-error").textContent).toContain(
      "An expiry is required"
    );
  });

  it("fills the field from a preset, and only then permits the write", async () => {
    await openDrainDialog();
    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuild" },
    });
    fireEvent.click(screen.getByTestId("device-drain-preset-4h"));
    expect(
      (screen.getByTestId("device-drain-until") as HTMLInputElement).value
    ).not.toBe("");
    expect(screen.getByTestId("device-drain-submit")).toBeEnabled();
  });

  it("posts device_id, until and reason — and nothing else", async () => {
    // Coord's `DrainRequest` is `deny_unknown_fields`: one extra key is a 422
    // for the whole write.
    fetchMock.mockResolvedValue(okResponse());
    const { onActed } = renderControl();
    fireEvent.click(screen.getByTestId("device-drain-open"));
    await screen.findByTestId("device-drain-dialog");
    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuilding the runner" },
    });
    fireEvent.change(screen.getByTestId("device-drain-until"), {
      target: { value: toLocalInputValue(Date.now() + 3_600_000) },
    });
    fireEvent.click(screen.getByTestId("device-drain-submit"));

    await waitFor(() => expect(onActed).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/fleet/drain");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["device_id", "reason", "until"]);
    expect(body.device_id).toBe(DEVICE);
    expect(body.reason).toBe("rebuilding the runner");
    expect(Date.parse(body.until)).toBeGreaterThan(Date.now());
  });

  it("surfaces coord's typed refusal rather than a bare failure", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(403, {
        detail: {
          error: "device_not_in_tenant",
          detail: "this device is not bound to your tenant",
        },
      })
    );
    const { onActed } = renderControl();
    fireEvent.click(screen.getByTestId("device-drain-open"));
    await screen.findByTestId("device-drain-dialog");
    fireEvent.change(screen.getByTestId("device-drain-reason"), {
      target: { value: "rebuild" },
    });
    fireEvent.change(screen.getByTestId("device-drain-until"), {
      target: { value: toLocalInputValue(Date.now() + 3_600_000) },
    });
    fireEvent.click(screen.getByTestId("device-drain-submit"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const description = String(
      (toastError.mock.calls[0]?.[1] as { description?: string })?.description
    );
    expect(description).toContain("device_not_in_tenant");
    expect(onActed).not.toHaveBeenCalled();
  });
});

describe("DeviceDrainControl — identifying text is never hidden", () => {
  it("renders the full coord device id and hostname as text", () => {
    renderControl({ drain: drainedState(), now: NOW });
    const target = screen.getByTestId("device-drain-target");
    // Whole UUID, not an abbreviation: it is the field that distinguishes two
    // coord registrations of the same physical box.
    expect(target.textContent).toContain(DEVICE);
    expect(target.textContent).toContain("gh-runner-spaceship-wsl");
    expect(target).toHaveAttribute("data-device-id", DEVICE);
  });

  it("puts no clipping class on the target line or the state block", () => {
    renderControl({ drain: drainedState(), now: NOW });
    assertNoClipping(screen.getByTestId("device-drain-target"));
    assertNoClipping(screen.getByTestId("device-drain-state"));
  });

  it("puts no clipping class anywhere in the control, in any state", () => {
    for (const drain of [
      { state: "not_drained" } as DeviceDrainState,
      drainedState(),
      { state: "unknown", reason: "read failed" } as DeviceDrainState,
    ]) {
      const { unmount } = renderControl({ drain });
      assertNoClipping(screen.getByTestId("device-drain"));
      unmount();
    }
    const { unmount } = renderControl({
      target: resolveDrainTarget({ matched: false }),
    });
    assertNoClipping(screen.getByTestId("device-drain"));
    unmount();
  });

  it("keeps the reason legible next to a drained badge", () => {
    renderControl({ drain: drainedState(), now: NOW });
    const block = screen.getByTestId("device-drain-state");
    // The badge word and the provenance are siblings in one block, so the
    // badge cannot cover the sentence.
    expect(within(block).getByText("Drained")).toBeInTheDocument();
    expect(block.textContent).toContain("rebuilding the runner");
  });
});

describe("DeviceDrainControl — who may act", () => {
  it("hides the lever from a non-admin and says why", () => {
    authState.isCoordAdmin = false;
    renderControl({ drain: drainedState(), now: NOW });
    expect(screen.queryByTestId("device-drain-undrain")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-admin-only-notice")).toBeInTheDocument();
    // The STATE is still readable — hiding a mutation control must not hide
    // the fact that a machine is out of the fleet.
    expect(screen.getByTestId("device-drain-state").textContent).toContain(
      "Drained until"
    );
  });
});

describe("disabledReason", () => {
  it("returns undefined when the control is genuinely actionable", () => {
    expect(disabledReason(IDENTIFIED, { state: "not_drained" })).toBeUndefined();
  });

  it("words the two blocked cases differently", () => {
    const noDevice = disabledReason(resolveDrainTarget({ matched: false }), {
      state: "not_drained",
    });
    const unknown = disabledReason(IDENTIFIED, {
      state: "unknown",
      reason: "read failed",
    });
    expect(noDevice).not.toEqual(unknown);
    expect(noDevice).toContain("no device row for this host");
    expect(unknown).toContain("read failed");
  });
});
