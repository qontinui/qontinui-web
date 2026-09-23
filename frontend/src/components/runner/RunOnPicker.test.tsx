/**
 * The shared "Run on:" control (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 4), under
 * the REAL ActiveRunnerProvider: only the runner list, the locality probe and
 * coord's resolver are stubbed, so the pin, the dispatch targets and the
 * announcements asserted here are the ones the app computes.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Runner } from "@qontinui/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DESK_ID = "11111111-1111-4111-8111-111111111111";
const LAPTOP_ID = "22222222-2222-4222-8222-222222222222";
const GONE_ID = "33333333-3333-4333-8333-333333333333";
const STORAGE_KEY = "qontinui:activeRunnerId";
const STORAGE_NAME_KEY = "qontinui:activeRunnerName";

type ResolveInput = {
  capabilities: readonly string[];
  workClass: string;
  preferred?: string | null;
};

const resolver = vi.hoisted(() => ({
  answer: (() => ({ status: "loading" })) as (input: ResolveInput) => unknown,
  calls: [] as ResolveInput[],
}));
vi.mock("@/lib/runner/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runner/resolve")>()),
  requestDeviceResolve: async (input: ResolveInput) => {
    resolver.calls.push(input);
    return resolver.answer(input);
  },
}));

const realtime = vi.hoisted(() => ({ runners: [] as unknown[] }));
vi.mock("@/contexts/realtime-connections-context", () => ({
  useRealtimeConnectionsContext: () => ({
    runners: realtime.runners,
    isLoading: false,
    loaded: true,
    loadError: null,
    isConnected: true,
    refetch: async () => realtime.runners,
  }),
}));

// Measured locality: DESK is proven on this machine, LAPTOP proven not.
vi.mock("@/lib/runner/locality", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runner/locality")>()),
  useRunnerLocality: () =>
    new Map([
      [DESK_ID, "local"],
      [LAPTOP_ID, "not_local"],
    ]),
}));

import {
  ActiveRunnerProvider,
  useDispatchRunnerTarget,
  useRunnerTarget,
} from "@/contexts/active-runner-context";
import type { RunnerTarget } from "@/lib/runner/target";
import { RunOnPicker } from "./RunOnPicker";

function runner(
  id: string,
  name: string,
  port: number,
  extra: Record<string, unknown> = {}
): Runner {
  return {
    id,
    name,
    port,
    capabilities: [],
    createdAt: "2026-09-20T00:00:00Z",
    derivedStatus: "healthy",
    userId: "u1",
    wsConnected: true,
    ...extra,
  } as unknown as Runner;
}

const DESK = runner(DESK_ID, "Desk runner", 9876);
const LAPTOP = runner(LAPTOP_ID, "Laptop runner", 9876, {
  derivedStatus: "degraded",
  instances: [
    { instanceKey: "primary", instanceRole: "primary", port: 9876 },
    { instanceKey: "runner:abc", instanceRole: "secondary", port: 9877 },
  ],
});

/** Coord honours every pin; with none it picks DESK. */
function coordHonoursPins() {
  resolver.answer = (input) => ({
    status: "resolved",
    deviceId: input.preferred ?? DESK_ID,
    via: input.preferred ? "pin" : "pool",
    pinReleased: null,
  });
}

/**
 * LAPTOP is ineligible (offline): placeable work is re-targeted to DESK with
 * the reason; machine-bound work is REFUSED. Any other pin is honoured.
 */
function laptopIneligible() {
  resolver.answer = (input) => {
    if (input.preferred === LAPTOP_ID || input.preferred === GONE_ID) {
      return input.workClass === "machine_bound"
        ? {
            status: "pin_ineligible",
            deviceId: input.preferred,
            reason: "offline",
            detail: "no heartbeat for 12 minutes",
            missingCapabilities: [],
          }
        : {
            status: "resolved",
            deviceId: DESK_ID,
            via: "pool",
            pinReleased: {
              reason: "offline",
              detail: "no heartbeat for 12 minutes",
            },
          };
    }
    return {
      status: "resolved",
      deviceId: input.preferred ?? DESK_ID,
      via: input.preferred ? "pin" : "pool",
      pinReleased: null,
    };
  };
}

const probe = vi.hoisted(() => ({
  read: null as unknown,
  placeable: null as unknown,
  bound: null as unknown,
}));

function Probe() {
  probe.read = useRunnerTarget();
  probe.placeable = useDispatchRunnerTarget();
  probe.bound = useDispatchRunnerTarget({ workClass: "machine_bound" });
  return null;
}

type Dispatch = ReturnType<typeof useDispatchRunnerTarget>;
const readTarget = () => probe.read as RunnerTarget;
const placeable = () => probe.placeable as Dispatch;
const bound = () => probe.bound as Dispatch;

function renderPicker(workClass: "placeable" | "machine_bound") {
  return render(
    <ActiveRunnerProvider>
      <RunOnPicker workClass={workClass} />
      <Probe />
    </ActiveRunnerProvider>
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Run on:/ })).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: /Run on:/ }));
  return { user, items: await screen.findAllByRole("menuitemradio") };
}

beforeEach(() => {
  localStorage.clear();
  resolver.calls = [];
  coordHonoursPins();
  realtime.runners = [DESK, LAPTOP];
});

afterEach(() => {
  localStorage.clear();
});

describe("RunOnPicker lists candidates with their MEASURED state", () => {
  it("Automatic first, then each runner's locality, heartbeat and instances", async () => {
    renderPicker("placeable");
    const { items } = await openMenu();
    expect(items.map((i) => i.textContent)).toEqual([
      "Automatic (coord picks)Coord chooses an online, eligible runner",
      "Desk runner:9876on this machine · online",
      "Laptop runner:9876on another machine · online, degraded2 instances: primary :9876, runner:abc :9877",
    ]);
    expect(
      within(items[1]!).getByRole("img", { name: "On this machine" })
    ).toBeInTheDocument();
    expect(
      within(items[2]!).getByRole("img", {
        name: "On another machine — not reachable from this browser",
      })
    ).toBeInTheDocument();
    // No pick stored: Automatic is the checked choice.
    expect(items[0]).toHaveAttribute("aria-checked", "true");
  });

  it("a pick that is not currently listed stays in the menu — labelled so — and checked", async () => {
    localStorage.setItem(STORAGE_KEY, GONE_ID);
    localStorage.setItem(STORAGE_NAME_KEY, "Old laptop");
    renderPicker("placeable");
    const { items } = await openMenu();
    const gone = items.find((i) => i.textContent?.includes("Old laptop"))!;
    expect(gone).toHaveTextContent("not currently listed");
    expect(gone).toHaveAttribute("aria-checked", "true");
  });

  it("a runner row without `instances` (older backend) shows no instance line", async () => {
    realtime.runners = [DESK, runner(LAPTOP_ID, "Laptop runner", 9876)];
    renderPicker("placeable");
    const { items } = await openMenu();
    expect(items[2]!.textContent).not.toMatch(/instance/);
  });
});

describe("RunOnPicker choosing", () => {
  it("selecting a runner stores the PICK and changes no transport", async () => {
    laptopIneligible(); // coord will release the pick
    renderPicker("placeable");
    await waitFor(() =>
      expect(readTarget()).toMatchObject({ runner: { id: DESK_ID } })
    );
    const before = readTarget();

    const { user, items } = await openMenu();
    await user.click(items[2]!);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(LAPTOP_ID);
    expect(localStorage.getItem(STORAGE_NAME_KEY)).toBe("Laptop runner");
    await waitFor(() =>
      expect(resolver.calls.some((c) => c.preferred === LAPTOP_ID)).toBe(true)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Coord released the pick: nothing was pointed at LAPTOP.
    expect(readTarget()).toBe(before);
    expect(placeable().runnerId).toBe(DESK_ID);
  });

  it("'Automatic (coord picks)' clears the pick; coord is asked with none", async () => {
    localStorage.setItem(STORAGE_KEY, LAPTOP_ID);
    renderPicker("placeable");
    await waitFor(() =>
      expect(placeable()).toMatchObject({ runnerId: LAPTOP_ID })
    );

    const { user, items } = await openMenu();
    expect(items[2]).toHaveAttribute("aria-checked", "true");
    const asked = resolver.calls.length;
    await user.click(items[0]!);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(asked));
    expect(resolver.calls[asked]).toMatchObject({
      workClass: "placeable",
      preferred: null,
    });
    await waitFor(() =>
      expect(placeable()).toMatchObject({ runnerId: DESK_ID })
    );
    expect(screen.getByRole("button", { name: /Run on:/ })).toHaveTextContent(
      "Automatic → Desk runner"
    );
  });

  it("is operable from the keyboard", async () => {
    renderPicker("placeable");
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /Run on:/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findAllByRole("menuitemradio");
    // Automatic → Desk → Laptop
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY)).toBe(LAPTOP_ID)
    );
  });
});

describe("RunOnPicker — placeable work re-targeted by coord (D2)", () => {
  it("announces the move at the moment it happens: 'Your pick X is offline — running on Y'", async () => {
    laptopIneligible();
    renderPicker("placeable");
    await waitFor(() =>
      expect(placeable()).toMatchObject({ runnerId: DESK_ID })
    );
    // Nothing to announce before the pick.
    expect(screen.queryByTestId("run-on-notice")).not.toBeInTheDocument();

    const { user, items } = await openMenu();
    await user.click(items[2]!);

    const notice = await screen.findByTestId("run-on-notice");
    // Inside the one always-mounted live region, with no nested one.
    expect(notice.closest('[aria-live="polite"]')).toBe(
      screen.getByTestId("run-on-notice-region")
    );
    expect(notice).not.toHaveAttribute("role");
    expect(notice).toHaveTextContent(
      "Your pick Laptop runner is offline — running on Desk runner."
    );
    // Announced through the live region that was mounted beforehand.
    expect(screen.getByTestId("run-on-notice-region")).toHaveAttribute(
      "aria-live",
      "polite"
    );
    expect(screen.getByRole("button", { name: /Run on:/ })).toHaveTextContent(
      "Laptop runner → Desk runner"
    );
    expect(placeable().runnerId).toBe(DESK_ID);
    expect(screen.queryByTestId("run-on-refusal")).not.toBeInTheDocument();
  });
});

describe("RunOnPicker — machine-bound work refused, never moved (D2)", () => {
  it("names the reason, OFFERS the alternatives, and picks none itself", async () => {
    laptopIneligible();
    localStorage.setItem(STORAGE_KEY, LAPTOP_ID);
    renderPicker("machine_bound");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your pick Laptop runner can't run this: it is offline."
    );
    expect(
      within(alert).getByRole("button", {
        name: "Desk runner (on this machine)",
      })
    ).toBeInTheDocument();
    // Placeable work WAS moved to DESK — machine-bound work was not.
    expect(placeable().runnerId).toBe(DESK_ID);
    expect(bound()).toMatchObject({
      runnerId: null,
      refusal: { reason: "pin_ineligible" },
    });
    expect(bound().target).toMatchObject({ kind: "unavailable" });
    // Coord was asked about the pick as machine-bound work, and only that.
    expect(
      resolver.calls
        .filter((c) => c.workClass === "machine_bound")
        .every((c) => c.preferred === LAPTOP_ID)
    ).toBe(true);
    // The pick is untouched until the user chooses.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(LAPTOP_ID);
    expect(bound().runnerId).toBeNull();
    expect(screen.queryByTestId("run-on-notice")).not.toBeInTheDocument();
  });

  it("choosing an offered alternative sets the pick; coord then confirms it", async () => {
    laptopIneligible();
    localStorage.setItem(STORAGE_KEY, LAPTOP_ID);
    renderPicker("machine_bound");
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Online runners — coord will check:");
    // Hold coord's machine-bound answer about the alternative.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const base = resolver.answer;
    resolver.answer = async (input) => {
      if (input.workClass === "machine_bound" && input.preferred === DESK_ID)
        await held;
      return base(input);
    };
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /Desk runner/ }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe(DESK_ID);
    // Focus stays on the control that now shows the new pick...
    expect(screen.getByRole("button", { name: /Run on:/ })).toHaveFocus();
    // ...and coord being asked is announced in the live region.
    await waitFor(() =>
      expect(screen.getByTestId("run-on-notice-region")).toHaveTextContent(
        "Checking Desk runner…"
      )
    );
    expect(bound().runnerId).toBeNull();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(bound().runnerId).toBe(DESK_ID));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      resolver.calls.some(
        (c) => c.workClass === "machine_bound" && c.preferred === DESK_ID
      )
    ).toBe(true);
  });

  it("with no pick, 'Automatic' names coord's device before anything runs", async () => {
    renderPicker("machine_bound");
    await waitFor(() => expect(bound().runnerId).toBe(DESK_ID));
    expect(screen.getByRole("button", { name: /Run on:/ })).toHaveTextContent(
      "Automatic → Desk runner"
    );
  });

  it("asks coord the machine-bound question only while such a surface is mounted", async () => {
    render(
      <ActiveRunnerProvider>
        <RunOnPicker workClass="placeable" />
      </ActiveRunnerProvider>
    );
    await waitFor(() => expect(resolver.calls.length).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(resolver.calls.every((c) => c.workClass === "placeable")).toBe(true);
  });
});
