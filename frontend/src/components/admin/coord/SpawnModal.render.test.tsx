import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpawnModal } from "./SpawnModal";

/**
 * SpawnModal — device-roster legibility tests.
 *
 * Why these exist: the device dropdown rendered a single DISABLED
 * "No devices reporting" item for THREE different causes — a failed
 * `fleet/health` fetch, a non-200, and a genuine 200-with-empty-roster —
 * because the fetch's `.catch` only reached `console.warn`. All three
 * looked identical, and none of them offered any way forward, so an
 * operator whose roster was momentarily empty simply could not spawn.
 *
 * That last case is not hypothetical — it is the live production symptom
 * this change was written for. `list_live_devices_for_tenant` requires a
 * device to be BOTH bound to the reading principal's tenant (an INNER JOIN
 * on `coord.tenant_devices`) and inside the liveness window, and an operator
 * hitting `/admin/coord/spawn` got `{"devices": [], "count": 0}` with
 * healthy machines running.
 *
 * These tests deliberately do NOT encode WHY the roster was empty. An
 * earlier revision asserted a specific cause — a 120s reader vs a 600s
 * writer — which was subsequently falsified (a dedicated 30s device
 * heartbeat exists and was running). The surface's job is to survive an
 * empty roster whatever the reason, so that is all that is pinned here.
 *
 * So the assertions below pin two properties per state:
 *   1. the cause is NAMED (an operator can tell auth from liveness), and
 *   2. a manual device-id entry path EXISTS (the roster is a convenience,
 *      never the only way to name a `target_device_id`).
 *
 * The third describe below covers the UNANCHORED spawn added by plan
 * `2026-08-25-general-purpose-session-spawn-machine-account-prompt` Phase 1:
 * the modal now opens with no plan at all, and `canSubmit` requires only the
 * three fields coord actually rejects a body without. That relaxation is
 * exactly the kind of change that can silently take the device guard down
 * with it, so the guard's own case fills the OTHER requirements first —
 * otherwise "submit is disabled" is true for unrelated reasons and asserts
 * nothing.
 *
 * NOTE ON PROPS: `SpawnModalProps` requires `onClose`. `tsconfig.json`
 * EXCLUDES every `.test.tsx` file from the program, so nothing typechecks
 * this one — a wrong prop name is silently destructured away and every test
 * still passes while rendering a component shape that cannot exist in
 * production. Keep these props in sync with the real call site
 * (`app/(app)/admin/coord/spawn/page.tsx`) by hand.
 */

const DEVICE = "eb2155ed-4152-4a91-be82-5d4346f717fc";

function renderModal() {
  return render(
    <SpawnModal
      open
      onClose={() => {}}
      planSlug="2026-08-25-example-plan"
      initialPhase="1"
    />
  );
}

/** Satisfy everything `canSubmit` needs EXCEPT the device.
 *
 *  Without this, a "submit is disabled" assertion passes because the repos
 *  list is empty and the prompt is blank — it would stay green with the
 *  device guard deleted, which is the one thing it is meant to pin. */
async function fillNonDeviceRequirements(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByTestId("coord-spawn-repo-qontinui-web"));
  await user.type(screen.getByTestId("coord-spawn-initial-prompt"), "go");
}

function rosterOf(devices: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ devices, count: devices.length }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpawnModal device roster", () => {
  it("renders the roster as a select when coord returns devices", async () => {
    fetchMock.mockResolvedValue(
      rosterOf([{ device_id: DEVICE, hostname: "merytshost", state: "healthy" }])
    );
    const user = userEvent.setup();

    renderModal();

    const trigger = await screen.findByTestId("coord-spawn-device-select");
    // A populated roster must NOT force the manual path on the operator.
    expect(screen.queryByTestId("coord-spawn-device-input")).toBeNull();
    expect(screen.queryByTestId("coord-spawn-device-notice")).toBeNull();

    // Radix mounts SelectItems only once the popover opens, so asserting on
    // the trigger alone would stay green even if `devices.map(...)` were
    // deleted. Open it and pin an actual option.
    await user.click(trigger);
    const option = await screen.findByRole("option", { name: /merytshost/ });
    expect(option.textContent).toContain("healthy");
  });

  it("names the liveness cause and offers manual entry on an empty roster", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();

    // The empty case must be a STATEMENT, not a blank control: a 200 with
    // no devices is a real answer about liveness, not a failure.
    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/0 live devices/i);
    expect(notice.textContent).toMatch(/heartbeat/i);
    // ...and it must leave a way to proceed.
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("does not offer a roster the operator cannot use", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();

    await screen.findByTestId("coord-spawn-device-input");
    // Switching back to a zero-item Select is the dead end this change
    // exists to remove — so the return trip must not be offered at all.
    expect(screen.queryByTestId("coord-spawn-device-toggle")).toBeNull();
  });

  it("surfaces the HTTP status on a non-200 rather than showing an empty roster", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    // 403 is an auth/proxy fault with a completely different fix from the
    // empty-roster case — the operator must be able to tell them apart.
    expect(notice.textContent).toMatch(/403/);
    expect(notice.textContent).not.toMatch(/0 live devices/i);
    // A fault is an error, not information, and is styled as one.
    expect(notice.className).toContain("text-destructive");
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("surfaces a transport failure and still offers manual entry", async () => {
    fetchMock.mockRejectedValue(new Error("NetworkError: failed to fetch"));

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/NetworkError/);
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });
});

describe("SpawnModal manual device entry", () => {
  it("clears a half-typed device id when switching back to the roster", async () => {
    fetchMock.mockResolvedValue(
      rosterOf([{ device_id: DEVICE, hostname: "merytshost", state: "healthy" }])
    );
    const user = userEvent.setup();

    renderModal();
    await screen.findByTestId("coord-spawn-device-select");

    await user.click(screen.getByTestId("coord-spawn-device-toggle"));
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;
    await user.type(input, "half-typed");

    // Back to the roster, then out again: the id must not survive as state
    // the visible control can no longer reach.
    await user.click(screen.getByTestId("coord-spawn-device-toggle"));
    await screen.findByTestId("coord-spawn-device-select");
    await user.click(screen.getByTestId("coord-spawn-device-toggle"));

    expect(
      ((await screen.findByTestId(
        "coord-spawn-device-input"
      )) as HTMLInputElement).value
    ).toBe("");
  });

  it("flags a non-uuid before it costs a round trip to a 422", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;
    // Everything else canSubmit wants, so the button below is about the
    // device id and nothing else.
    await fillNonDeviceRequirements(user);
    const submit = screen.getByTestId(
      "coord-spawn-submit"
    ) as HTMLButtonElement;

    await user.type(input, "not-a-uuid");
    expect(screen.getByTestId("coord-spawn-device-invalid")).toBeTruthy();
    expect(submit.disabled).toBe(true);

    // ...and the guard is the ONLY thing holding it: a valid id releases it.
    await user.clear(input);
    await user.type(input, DEVICE);
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
    expect(submit.disabled).toBe(false);
  });

  it("accepts both uuid spellings coord's deserializer takes", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;

    // Hyphenated.
    await user.type(input, DEVICE);
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();

    // Simple 32-hex — coord's Uuid deserializer accepts it, so a
    // hyphens-only guard would reject input coord would happily take.
    await user.clear(input);
    await user.type(input, DEVICE.replace(/-/g, ""));
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
  });

  it("does not preserve surrounding whitespace while typing", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;

    // The input is deliberately RAW — trimming on every keystroke moved the
    // caret and ate spaces mid-value while still letting a pasted internal
    // space through. Normalization happens at the wire boundary instead
    // (`buildSpawnRequestBody`), so the typed value round-trips untouched...
    await user.type(input, "  " + DEVICE);
    expect(input.value).toBe("  " + DEVICE);
    // ...and leading/trailing whitespace still validates, because the guard
    // tests the trimmed value.
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
  });
});

describe("SpawnModal unanchored spawn", () => {
  it("submits with only a device, a repo and a prompt when no plan is seeded", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    // No `planSlug` at all — the "New session" entry point.
    render(<SpawnModal open onClose={() => {}} />);

    const input = await screen.findByTestId("coord-spawn-device-input");
    // A disabled, empty "Plan" field would be a lie about what this spawn
    // is; the modal names the state instead.
    expect(screen.queryByTestId("coord-spawn-plan-slug")).toBeNull();
    expect(screen.getByTestId("coord-spawn-unanchored-notice")).toBeTruthy();

    const submit = screen.getByTestId(
      "coord-spawn-submit"
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.type(input, DEVICE);
    await fillNonDeviceRequirements(user);

    // The whole point of Phase 1: no plan slug, no phase and no intent were
    // typed, and the spawn is still submittable — those three are
    // `Option<..>` on coord's SpawnRequest, so requiring them was a
    // frontend invention.
    expect(submit.disabled).toBe(false);
  });

  it("still shows the plan field when a plan IS seeded", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();
    await screen.findByTestId("coord-spawn-device-input");

    // The relaxation must not have deleted the anchored shape.
    expect(
      (screen.getByTestId("coord-spawn-plan-slug") as HTMLInputElement).value
    ).toBe("2026-08-25-example-plan");
    expect(screen.queryByTestId("coord-spawn-unanchored-notice")).toBeNull();
  });
});
