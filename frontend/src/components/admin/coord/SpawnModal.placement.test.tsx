import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}));

import { SpawnModal } from "./SpawnModal";

/**
 * SpawnModal — automatic placement vs a named-device pin (plan
 * `2026-09-20-runner-selector-drives-a-transport-not-a-target` Phase 5; coord
 * half qontinui-coord#2403).
 *
 * The device roster is served EMPTY so the manual input is armed: that makes
 * "no device" and "this device" each one keystroke apart, with no Radix
 * portal in the way. NOTE: `tsconfig.json` excludes `.test.tsx`, so keep the
 * props in sync with `app/(app)/admin/coord/spawn/page.tsx` by hand.
 */

const DEVICE = "eb2155ed-4152-4a91-be82-5d4346f717fc";

let spawnResponses: Array<{ status: number; body: unknown }>;
let spawnBodies: Array<Record<string, unknown>>;

function respond(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => text,
  };
}

beforeEach(() => {
  spawnResponses = [];
  spawnBodies = [];
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
  vi.stubGlobal("fetch", (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("/claude-accounts")) {
      return Promise.resolve(
        respond(200, { accounts: [], table_provisioned: true })
      );
    }
    if (u.includes("/fleet/health")) {
      return Promise.resolve(respond(200, { devices: [], count: 0 }));
    }
    if (u.includes("/agents/spawn")) {
      spawnBodies.push(JSON.parse(String(init?.body)));
      const next = spawnResponses.shift() ?? { status: 200, body: {} };
      return Promise.resolve(respond(next.status, next.body));
    }
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openReady(user: ReturnType<typeof userEvent.setup>) {
  render(<SpawnModal open onClose={() => {}} />);
  await screen.findByTestId("coord-spawn-device-input");
  await user.click(screen.getByTestId("coord-spawn-repo-qontinui-web"));
  await user.type(screen.getByTestId("coord-spawn-initial-prompt"), "go");
}

async function pinDevice(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("coord-spawn-device-input"), DEVICE);
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByTestId("coord-spawn-submit"));
}

describe("SpawnModal placement — the request", () => {
  it("defaults to AUTOMATIC: submittable with no device, and omits target_device_id", async () => {
    const user = userEvent.setup();
    await openReady(user);

    const mode = screen.getByTestId("coord-spawn-placement-mode");
    expect(mode.getAttribute("data-placement")).toBe("automatic");
    expect(mode.textContent).toMatch(/coord picks/i);

    const btn = screen.getByTestId("coord-spawn-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    spawnResponses.push({
      status: 200,
      body: { agent_id: "a1", target_device_id: DEVICE, placed_by: "coord" },
    });
    await submit(user);

    await waitFor(() => expect(spawnBodies).toHaveLength(1));
    expect(spawnBodies[0]).not.toHaveProperty("target_device_id");
    expect(spawnBodies[0]).not.toHaveProperty("override_drain");
  });

  it("sends a named device as the pin, and says it is a checked pin", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await pinDevice(user);

    const mode = screen.getByTestId("coord-spawn-placement-mode");
    expect(mode.getAttribute("data-placement")).toBe("pin");
    expect(mode.textContent).toMatch(/never moves the session/);

    await submit(user);
    await waitFor(() => expect(spawnBodies).toHaveLength(1));
    expect(spawnBodies[0].target_device_id).toBe(DEVICE);
  });

  it("'Use automatic placement' drops the pin", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await pinDevice(user);
    await user.click(screen.getByTestId("coord-spawn-device-automatic"));
    expect(
      screen
        .getByTestId("coord-spawn-placement-mode")
        .getAttribute("data-placement")
    ).toBe("automatic");
    await submit(user);
    await waitFor(() => expect(spawnBodies).toHaveLength(1));
    expect(spawnBodies[0]).not.toHaveProperty("target_device_id");
  });

  it("sends required_capabilities when typed", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await user.type(
      screen.getByTestId("coord-spawn-capabilities"),
      "os:linux, docker"
    );
    await submit(user);
    await waitFor(() => expect(spawnBodies).toHaveLength(1));
    expect(spawnBodies[0].required_capabilities).toEqual([
      "os:linux",
      "docker",
    ]);
  });
});

describe("SpawnModal placement — the outcome", () => {
  it("shows where a coord-placed session went, and that coord chose it", async () => {
    const user = userEvent.setup();
    await openReady(user);
    spawnResponses.push({
      status: 200,
      body: { agent_id: "a1", target_device_id: DEVICE, placed_by: "coord" },
    });
    await submit(user);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0][0]);
    expect(msg).toContain(DEVICE);
    expect(msg).toMatch(/placed by coord/);
  });

  it("says a pinned session went to the device you named", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await pinDevice(user);
    spawnResponses.push({
      status: 200,
      body: { agent_id: "a1", target_device_id: DEVICE, placed_by: "pin" },
    });
    await submit(user);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls[0][0])).toMatch(
      /the device you named/
    );
  });
});

describe("SpawnModal placement — refusals", () => {
  async function refusedWith(
    body: Record<string, unknown>,
    opts: { pin: boolean }
  ) {
    const user = userEvent.setup();
    await openReady(user);
    if (opts.pin) await pinDevice(user);
    // The web envelope: coord's keys spliced into the top level.
    spawnResponses.push({
      status: 409,
      body: { message: "x", timestamp: 1, path: "p", ...body },
    });
    await submit(user);
    const panel = await screen.findByTestId("coord-spawn-refusal");
    return { user, panel };
  }

  it("pin_ineligible offline names the device and the way out", async () => {
    const { panel } = await refusedWith(
      { error: "pin_ineligible", reason: "offline", missing_capabilities: [] },
      { pin: true }
    );
    expect(panel.getAttribute("data-refusal")).toBe("pin_ineligible");
    // Not in the roster, so the headline names it plainly — the raw id is
    // on the detail line, never the headline (R8).
    expect(screen.getByTestId("coord-spawn-error").textContent).toBe(
      "The device you named is offline"
    );
    expect(
      screen.getByTestId("coord-spawn-refusal-detail").textContent
    ).toContain(DEVICE);
    expect(
      screen.getByTestId("coord-spawn-refusal-remedy").textContent
    ).toMatch(/automatic placement/);
    expect(screen.queryByTestId("coord-spawn-override-drain")).toBeNull();
  });

  it("pin_ineligible missing_capabilities lists them", async () => {
    await refusedWith(
      {
        error: "pin_ineligible",
        reason: "missing_capabilities",
        missing_capabilities: ["docker"],
      },
      { pin: true }
    );
    expect(screen.getByTestId("coord-spawn-error").textContent).toMatch(
      /lacks a required capability: docker/
    );
  });

  it("no_eligible_device renders its outcome", async () => {
    const { panel } = await refusedWith(
      { error: "no_eligible_device", outcome: "all_capable_at_capacity" },
      { pin: false }
    );
    expect(panel.getAttribute("data-refusal")).toBe("no_eligible_device");
    expect(screen.getByTestId("coord-spawn-error").textContent).toMatch(
      /session cap/
    );
  });

  it("drain_unreadable says spawns fail closed and offers no override", async () => {
    await refusedWith({ error: "drain_unreadable", hint: "h" }, { pin: true });
    expect(screen.getByTestId("coord-spawn-error").textContent).toMatch(
      /cannot read which devices are drained/
    );
    expect(screen.queryByTestId("coord-spawn-override-drain")).toBeNull();
  });

  it("a drained NAMED device offers the override, which re-sends with override_drain", async () => {
    const { user } = await refusedWith(
      { error: "device_drained", reason: "rebuild", device_id: DEVICE },
      { pin: true }
    );
    const override = screen.getByTestId("coord-spawn-override-drain");
    spawnResponses.push({
      status: 200,
      body: { agent_id: "a2", target_device_id: DEVICE, placed_by: "pin" },
    });
    await user.click(override);
    await waitFor(() => expect(spawnBodies).toHaveLength(2));
    expect(spawnBodies[0]).not.toHaveProperty("override_drain");
    expect(spawnBodies[1].override_drain).toBe(true);
    expect(spawnBodies[1].target_device_id).toBe(DEVICE);
  });

  it("a drained COORD-PLACED device offers no override", async () => {
    await refusedWith(
      { error: "device_drained", reason: "rebuild", device_id: DEVICE },
      { pin: false }
    );
    expect(
      screen.getByTestId("coord-spawn-refusal-remedy").textContent
    ).toMatch(/Spawn again/);
    expect(screen.queryByTestId("coord-spawn-override-drain")).toBeNull();
  });

  it("changing the device clears a refusal and its override offer", async () => {
    const { user } = await refusedWith(
      { error: "device_drained", device_id: DEVICE },
      { pin: true }
    );
    expect(screen.getByTestId("coord-spawn-override-drain")).toBeTruthy();
    await user.click(screen.getByTestId("coord-spawn-device-automatic"));
    expect(screen.queryByTestId("coord-spawn-refusal")).toBeNull();
    expect(screen.queryByTestId("coord-spawn-override-drain")).toBeNull();
  });
});

describe("SpawnModal placement — a refusal describes the form that was sent", () => {
  it("the device and capability inputs are disabled while a spawn is in flight", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await pinDevice(user);

    // Hold the spawn response open.
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => {
      release = r;
    });
    vi.stubGlobal("fetch", (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/agents/spawn")) {
        spawnBodies.push(JSON.parse(String(init?.body)));
        return held.then(() =>
          respond(409, { error: "device_drained", device_id: DEVICE })
        );
      }
      return Promise.resolve(respond(200, { devices: [], accounts: [] }));
    });

    await submit(user);
    // A late refusal can never describe a form the operator has since
    // changed, because the form cannot change until it lands.
    const input = screen.getByTestId(
      "coord-spawn-device-input"
    ) as HTMLInputElement;
    const caps = screen.getByTestId(
      "coord-spawn-capabilities"
    ) as HTMLInputElement;
    const back = screen.getByTestId(
      "coord-spawn-device-automatic"
    ) as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(caps.disabled).toBe(true);
    expect(back.disabled).toBe(true);

    release(undefined);
    await screen.findByTestId("coord-spawn-refusal");
    expect(input.disabled).toBe(false);
    expect(caps.disabled).toBe(false);
    // The refusal is for the device still on screen, so the override stands.
    expect(screen.getByTestId("coord-spawn-override-drain")).toBeTruthy();
  });

  it("editing the capabilities clears a refusal they caused", async () => {
    const user = userEvent.setup();
    await openReady(user);
    spawnResponses.push({
      status: 409,
      body: {
        error: "no_eligible_device",
        outcome: "no_capable_device",
        missing_capabilities: ["gpu"],
      },
    });
    await user.type(screen.getByTestId("coord-spawn-capabilities"), "gpu");
    await submit(user);
    await screen.findByTestId("coord-spawn-refusal");
    await user.clear(screen.getByTestId("coord-spawn-capabilities"));
    expect(screen.queryByTestId("coord-spawn-refusal")).toBeNull();
  });
});

describe("SpawnModal placement — no readable answer", () => {
  it("a 2xx whose body cannot be parsed says the spawn may have landed", async () => {
    const user = userEvent.setup();
    await openReady(user);
    spawnResponses.push({ status: 200, body: "not json" });
    await submit(user);
    const panel = await screen.findByTestId("coord-spawn-refusal");
    expect(panel.getAttribute("data-refusal")).toBe("outcome_unknown");
    expect(screen.getByTestId("coord-spawn-error").textContent).toMatch(
      /may or may not have landed/
    );
    expect(
      screen.getByTestId("coord-spawn-refusal-remedy").textContent
    ).toMatch(/Check the sessions list/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a transport failure on send says the spawn may have landed, never 'did not complete'", async () => {
    const user = userEvent.setup();
    await openReady(user);
    vi.stubGlobal("fetch", (url: unknown) =>
      String(url).includes("/agents/spawn")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(respond(200, { devices: [], accounts: [] }))
    );
    await submit(user);
    const panel = await screen.findByTestId("coord-spawn-refusal");
    expect(panel.getAttribute("data-refusal")).toBe("outcome_unknown");
    expect(panel.textContent).not.toMatch(/did not complete/);
    expect(panel.textContent).toMatch(/Failed to fetch/);
  });
});

describe("SpawnModal placement — capabilities an older coord ignored", () => {
  it("warns, not succeeds, when capabilities were sent and placed_by is absent", async () => {
    const user = userEvent.setup();
    await openReady(user);
    await pinDevice(user);
    await user.type(screen.getByTestId("coord-spawn-capabilities"), "docker");
    spawnResponses.push({
      status: 200,
      body: { agent_id: "a1", target_device_id: DEVICE },
    });
    await submit(user);
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(String(toastWarning.mock.calls[0][0])).toMatch(
      /required capabilities were NOT checked/
    );
  });
});
