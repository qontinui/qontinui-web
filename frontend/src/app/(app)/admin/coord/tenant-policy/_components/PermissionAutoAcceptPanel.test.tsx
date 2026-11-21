/**
 * PermissionAutoAcceptPanel — the copy that says what is and is never
 * accepted, the states that must not collapse into on/off, and the UI Bridge
 * registration that makes the switch addressable.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/usePermissionAutoAcceptPolicy.test.ts` and the shared
 * `useTenantFleetPolicyDial.test.ts`. The UI Bridge is the REAL SDK, with
 * every `useUIComponent` config also captured, so one test can prove the
 * registered state getter stays live inside a real provider.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react";
import { UNKNOWN_AMBER } from "@/components/console";
import type {
  FleetPolicyView,
  FleetPolicyWriteResult,
} from "@/lib/api/operations/tenantPolicy";
import type { usePermissionAutoAcceptPolicy } from "../_hooks/usePermissionAutoAcceptPolicy";

type HookState = ReturnType<typeof usePermissionAutoAcceptPolicy>;

const usePolicyMock = vi.fn<() => HookState>();
vi.mock("../_hooks/usePermissionAutoAcceptPolicy", () => ({
  usePermissionAutoAcceptPolicy: () => usePolicyMock(),
}));

type Registered = {
  id: string;
  state?: () => Record<string, unknown>;
  actions?: {
    id: string;
    effect?: string;
    handler: (params?: unknown) => Promise<unknown>;
  }[];
};
const registered: { current: Registered | null } = { current: null };
vi.mock("@qontinui/ui-bridge/react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@qontinui/ui-bridge/react")>();
  return {
    ...actual,
    useUIComponent: (c: Parameters<typeof actual.useUIComponent>[0]) => {
      registered.current = c as unknown as Registered;
      return actual.useUIComponent(c);
    },
  };
});

import {
  UIBridgeProvider,
  useUIBridgeOptional,
} from "@qontinui/ui-bridge/react";
import { PermissionAutoAcceptPanel } from "./PermissionAutoAcceptPanel";

const ON_TENANT: FleetPolicyView = {
  domain: "permission_auto_accept",
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

function writeResult(
  writtenLevel: string,
  readbackError: string | null
): FleetPolicyWriteResult {
  return {
    ok: true,
    domain: "permission_auto_accept",
    written_level: writtenLevel,
    written_master_enabled: true,
    versioned: true,
    version: 2,
    updated_by: "operator@example.com",
    effective: null,
    readback_error: readbackError,
  };
}

function hookState(
  policy: FleetPolicyView | null,
  overrides: Partial<HookState> = {}
): HookState {
  return {
    policy,
    loading: false,
    saving: false,
    error: null,
    readbackError: null,
    lastWrite: null,
    reload: vi.fn<HookState["reload"]>().mockResolvedValue(true),
    setLevel: vi.fn<HookState["setLevel"]>().mockResolvedValue(true),
    noteWriteLanded: vi.fn<HookState["noteWriteLanded"]>(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registered.current = null;
});

describe("PermissionAutoAcceptPanel", () => {
  it("says what is accepted, what never is, and when a change applies", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    render(<PermissionAutoAcceptPanel />);

    const scope =
      screen.getByTestId("permission-auto-accept-scope-copy").textContent ?? "";
    expect(scope).toMatch(
      /tool permission prompts Claude Code asks in runner\s+sessions/
    );
    // The measured safety-check class is named, so nobody reads "accepted"
    // as "only harmless prompts".
    expect(scope).toMatch(/built-in safety checks/);
    expect(scope).toMatch(
      /Dangerous rmdir operation on possibly-empty variable\s+path/
    );
    // Plan D4: deny rules and blocking guards still refuse first.
    expect(scope).toMatch(/Deny rules and blocking hooks still run first/);
    // Plan D3: what is never accepted.
    expect(scope).toMatch(/Never accepted/);
    expect(scope).toMatch(/AskUserQuestion/);
    expect(scope).toMatch(/plan approval/);
    expect(scope).toMatch(/plan mode/);
    expect(scope).toMatch(/allow-list \(don.t-ask\)/);
    expect(scope).toMatch(/not tool permissions, such as the usage-limit/);

    const timing =
      screen.getByTestId("permission-auto-accept-timing").textContent ?? "";
    // Plan D2: decided live, so running sessions pick it up within one poll.
    expect(timing).toMatch(/already running within\s+about a minute/);
    expect(timing).toMatch(/no restart is needed/);
    // Plan D5: headless sessions are denied once the tenant turns it off —
    // by runners that support the switch, and only those.
    expect(timing).toMatch(
      /When this tenant\s+turns it off, runners that support it deny the permission\s+requests of headless \(stream-json\) sessions/
    );
    expect(timing).toMatch(
      /rather than leave them waiting; the session\s+keeps running/
    );
    // Level-independent: no deployed runner may have the change yet.
    expect(timing).toMatch(
      /Runner builds older than this switch neither\s+accept prompts nor deny the permission requests of headless\s+sessions; the setting takes effect as runners update/
    );

    // One wording for what happens to a prompt left on screen.
    const text =
      screen.getByTestId("permission-auto-accept-policy").textContent ?? "";
    expect(text).not.toMatch(/never comes/);
    expect(
      screen.getByTestId("permission-auto-accept-auto-deny").textContent
    ).toMatch(
      /until\s+someone answers it, or, on recent Claude Code versions, until\s+Claude Code denies it after about two minutes/
    );
  });

  it("shows the resolved level and writes off when Off is clicked", () => {
    const state = hookState(ON_TENANT);
    usePolicyMock.mockReturnValue(state);
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("on");
    expect(screen.getByTestId("permission-auto-accept-scope").textContent).toBe(
      "tenant"
    );
    expect(
      screen
        .getByTestId("permission-auto-accept-on")
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen
        .getByTestId("permission-auto-accept-off")
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen
        .getByTestId("permission-auto-accept-refresh")
        .getAttribute("aria-label")
    ).toBe("Refresh permission auto-accept");
    fireEvent.click(screen.getByTestId("permission-auto-accept-off"));
    expect(state.setLevel).toHaveBeenCalledWith("off");
  });

  it("a fresh tenant (no row) shows coord's default on, not as a choice", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "none" })
    );
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("on");
    expect(screen.getByTestId("permission-auto-accept-scope").textContent).toBe(
      "none"
    );
    const on = screen.getByTestId("permission-auto-accept-on");
    expect(on.textContent).toBe("On (default)");
    expect(on.getAttribute("aria-pressed")).toBe("false");
    const copy = screen.getByTestId("permission-auto-accept-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("on");
    expect(copy.textContent).toMatch(/nobody chose this level/);
    expect(copy.textContent).not.toMatch(/does not know this setting yet/);
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(/Runners accept these prompts/);
  });

  it("a no-row `off` is coord's fallback: not a choice, and headless sessions are still allowed", () => {
    usePolicyMock.mockReturnValue(
      hookState({
        ...ON_TENANT,
        effective_level: "off",
        resolved_scope: "none",
        default_source: "product",
      })
    );
    render(<PermissionAutoAcceptPanel />);

    const off = screen.getByTestId("permission-auto-accept-off");
    expect(off.textContent).toBe("Off (default)");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen
        .getByTestId("permission-auto-accept-on")
        .getAttribute("aria-pressed")
    ).toBe("false");

    const copy = screen.getByTestId("permission-auto-accept-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("off");
    expect(copy.textContent).toMatch(
      /A coord that does not know this setting yet reports off.*once coord is updated, a tenant with no row gets on/
    );
    expect(copy.textContent).not.toMatch(/Phase 1/);

    // The runner denies headless requests only on an `off` from a real row.
    const blurb =
      screen.getByTestId("permission-auto-accept-blurb").textContent ?? "";
    expect(blurb).not.toMatch(/headless.*denied/);
    expect(blurb).toMatch(/accept no prompts in interactive sessions/);
    expect(blurb).toMatch(
      /the permission requests of headless \(stream-json\) sessions are still allowed/
    );
  });

  it("an explicit `off` row says runners that support it deny headless sessions", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "off" })
    );
    render(<PermissionAutoAcceptPanel />);
    const off = screen.getByTestId("permission-auto-accept-off");
    expect(off.textContent).toBe("Off");
    expect(off.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(
      /accept no prompts.*runners that support this switch deny the permission requests of headless \(stream-json\) sessions/
    );
  });

  it("writes on when On is clicked from an explicit off", () => {
    const state = hookState({ ...ON_TENANT, effective_level: "off" });
    usePolicyMock.mockReturnValue(state);
    render(<PermissionAutoAcceptPanel />);
    fireEvent.click(screen.getByTestId("permission-auto-accept-on"));
    expect(state.setLevel).toHaveBeenCalledWith("on");
    expect(state.setLevel).toHaveBeenCalledTimes(1);
  });

  it("classifies a level as the runner does (trimmed, lowercased) but shows it raw", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "ON" })
    );
    const upper = render(<PermissionAutoAcceptPanel />);
    let badge = screen.getByTestId("permission-auto-accept-effective");
    expect(badge.textContent).toBe("ON");
    expect(badge.getAttribute("data-unknown")).toBeNull();
    expect(
      screen
        .getByTestId("permission-auto-accept-on")
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(/Runners accept these prompts/);
    upper.unmount();

    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: " off " })
    );
    render(<PermissionAutoAcceptPanel />);
    badge = screen.getByTestId("permission-auto-accept-effective");
    expect(badge.textContent).toBe(" off ");
    expect(badge.getAttribute("data-unknown")).toBeNull();
    expect(
      screen
        .getByTestId("permission-auto-accept-off")
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(/accept no prompts/);
  });

  it("explains that a system-band answer means a tenant write takes effect", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "system" })
    );
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-system-fallback").textContent
    ).toMatch(/takes effect immediately/);
    expect(
      screen.queryByTestId("permission-auto-accept-overridden-by-repo")
    ).toBeNull();
  });

  it("warns when a repo-band row overrides the tenant row", () => {
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, resolved_scope: "repo" })
    );
    render(<PermissionAutoAcceptPanel />);
    expect(
      screen.getByTestId("permission-auto-accept-overridden-by-repo")
    ).toBeTruthy();
  });

  it("names the fleet_resources keys it does not show", () => {
    usePolicyMock.mockReturnValue(
      hookState({
        ...ON_TENANT,
        keys_not_shown: ["controls", "drain"],
        keys_not_shown_source: "fleet_resources_row",
      })
    );
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-keys-not-shown").textContent
    ).toMatch(/controls, drain.*fleet_resources row/);
  });

  it("reports an unrecognised level as unknown, never as on or off", () => {
    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    const first = render(<PermissionAutoAcceptPanel />);
    const selectedClass = screen
      .getByTestId("permission-auto-accept-on")
      .getAttribute("class");
    first.unmount();

    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "maybe" })
    );
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("maybe");
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(
      /neither on nor off: runners accept no prompts at this level and do not deny the permission requests of headless sessions/
    );
    for (const level of ["on", "off"]) {
      const button = screen.getByTestId(`permission-auto-accept-${level}`);
      expect(button.getAttribute("class")).not.toBe(selectedClass);
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    const badge = screen.getByTestId("permission-auto-accept-effective");
    expect(badge.getAttribute("data-unknown")).toBe("true");
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(badge.className).toContain(cls);
    }
  });

  it("spins only the button whose write is in flight", async () => {
    let finish: (v: boolean) => void = () => {};
    const setLevel = vi.fn<HookState["setLevel"]>(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );
    usePolicyMock.mockReturnValue(hookState(ON_TENANT, { setLevel }));
    const view = render(<PermissionAutoAcceptPanel />);

    fireEvent.click(screen.getByTestId("permission-auto-accept-off"));
    expect(setLevel).toHaveBeenCalledWith("off");
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, { setLevel, saving: true })
    );
    view.rerender(<PermissionAutoAcceptPanel />);

    const spinnerIn = (level: string) =>
      screen
        .getByTestId(`permission-auto-accept-${level}`)
        .querySelector(".animate-spin");
    expect(spinnerIn("off")).not.toBeNull();
    expect(spinnerIn("on")).toBeNull();

    await act(async () => {
      finish(true);
    });
    expect(spinnerIn("off")).toBeNull();
  });

  it("disables the write for a non-admin and says why", () => {
    usePolicyMock.mockReturnValue(hookState({ ...ON_TENANT, can_edit: false }));
    render(<PermissionAutoAcceptPanel />);

    expect(
      (screen.getByTestId("permission-auto-accept-off") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId("permission-auto-accept-readonly").textContent
    ).toMatch(/not an admin/);
  });

  it("renders a failed read as unknown, never as off", () => {
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    render(<PermissionAutoAcceptPanel />);

    const badge = screen.getByTestId("permission-auto-accept-effective");
    expect(badge.textContent).toBe("unknown");
    expect(badge.getAttribute("data-unknown")).toBe("true");
    expect(
      screen.getByTestId("permission-auto-accept-readonly").textContent
    ).toMatch(/could not be read/);
    expect(
      screen.getByTestId("permission-auto-accept-error").textContent
    ).toMatch(/unknown/);
    expect(
      screen.getByTestId("permission-auto-accept-blurb").textContent
    ).toMatch(/could not be read/);
  });

  it("shows the read-back after a write, not the written level", () => {
    // The write to `off` landed but its read-back failed: the confirmed `on`
    // stays, and the banner says the value may be stale.
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, {
        readbackError: "read-back failed: coord returned 502",
        lastWrite: writeResult("off", "read-back failed: coord returned 502"),
      })
    );
    render(<PermissionAutoAcceptPanel />);

    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("on");
    const banner = screen.getByTestId("permission-auto-accept-readback-error");
    expect(banner.querySelector("code")?.textContent).toBe("off");
    expect(banner.textContent).toMatch(/502/);
  });

  it("shows a confirmed read-back of off once the write lands", () => {
    usePolicyMock.mockReturnValue(
      hookState(
        { ...ON_TENANT, effective_level: "off" },
        { lastWrite: writeResult("off", null) }
      )
    );
    render(<PermissionAutoAcceptPanel />);
    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("off");
    expect(
      screen.queryByTestId("permission-auto-accept-readback-error")
    ).toBeNull();
  });

  it("the UI Bridge action writes the level like a click, and refuses while a write is in flight", async () => {
    let finish: (v: boolean) => void = () => {};
    const setLevel = vi.fn<HookState["setLevel"]>(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    );
    usePolicyMock.mockReturnValue(hookState(ON_TENANT, { setLevel }));
    const view = render(<PermissionAutoAcceptPanel />);

    const component = registered.current;
    expect(component?.id).toBe("coord-tenant-permission-auto-accept");
    const action = () =>
      registered.current?.actions?.find(
        (a) => a.id === "set-permission-auto-accept"
      );
    expect(action()?.effect).toBe("write");
    await expect(action()?.handler({ level: "maybe" })).rejects.toThrow(
      /level must be "on" or "off"/
    );

    let first: Promise<unknown> | undefined;
    act(() => {
      first = action()?.handler({ level: "off" });
    });
    expect(setLevel).toHaveBeenCalledWith("off");
    // A second write while the first is in flight is refused.
    await expect(action()?.handler({ level: "on" })).rejects.toThrow(
      /already in flight/
    );
    expect(setLevel).toHaveBeenCalledTimes(1);

    // The bridge write spins its button exactly as a click does.
    usePolicyMock.mockReturnValue(
      hookState(ON_TENANT, { setLevel, saving: true })
    );
    view.rerender(<PermissionAutoAcceptPanel />);
    const spinnerIn = (level: string) =>
      screen
        .getByTestId(`permission-auto-accept-${level}`)
        .querySelector(".animate-spin");
    expect(spinnerIn("off")).not.toBeNull();

    await act(async () => {
      finish(true);
      await first;
    });
    await expect(first).resolves.toBe(true);
    expect(spinnerIn("off")).toBeNull();

    // Stable, explicit ids — never the positional auto-derived ones.
    expect(
      screen
        .getByTestId("permission-auto-accept-off")
        .getAttribute("data-ui-bridge-id")
    ).toBe("permission-auto-accept-off");
    expect(
      screen
        .getByTestId("permission-auto-accept-effective")
        .getAttribute("data-ui-bridge-id")
    ).toBe("permission-auto-accept-effective");
  });

  it("the UI Bridge action refuses what the buttons would not offer, and a failed write is not a success", async () => {
    const action = () =>
      registered.current?.actions?.find(
        (a) => a.id === "set-permission-auto-accept"
      );

    // A non-admin: the buttons are disabled, so the action refuses too.
    const readOnly = hookState({ ...ON_TENANT, can_edit: false });
    usePolicyMock.mockReturnValue(readOnly);
    const first = render(<PermissionAutoAcceptPanel />);
    await expect(action()?.handler({ level: "off" })).rejects.toThrow(
      "read-only: coord would refuse this write (admin_required)"
    );
    expect(readOnly.setLevel).not.toHaveBeenCalled();
    first.unmount();

    // A role that could not be read is not offered a write either.
    const unread = hookState(null, { error: "HTTP 502" });
    usePolicyMock.mockReturnValue(unread);
    const second = render(<PermissionAutoAcceptPanel />);
    await expect(action()?.handler({ level: "off" })).rejects.toThrow(
      /read-only: your role could not be read/
    );
    expect(unread.setLevel).not.toHaveBeenCalled();
    second.unmount();

    // The hook reports a write coord refused as `false`: the action rejects.
    const refused = hookState(ON_TENANT, {
      setLevel: vi.fn<HookState["setLevel"]>().mockResolvedValue(false),
    });
    usePolicyMock.mockReturnValue(refused);
    render(<PermissionAutoAcceptPanel />);
    let outcome: Promise<unknown> | undefined;
    await act(async () => {
      outcome = action()?.handler({ level: "off" });
      await outcome?.catch(() => undefined);
    });
    await expect(outcome).rejects.toThrow(/coord did not accept it/);
    expect(refused.setLevel).toHaveBeenCalledWith("off");
  });

  it("inside a real UIBridgeProvider, the registered state getter reads the level now shown", () => {
    type Registry = NonNullable<
      ReturnType<typeof useUIBridgeOptional>
    >["registry"];
    let registry: Registry | null = null;
    function GrabRegistry() {
      const bridge = useUIBridgeOptional();
      useLayoutEffect(() => {
        registry = bridge?.registry ?? null;
      }, [bridge]);
      return null;
    }
    const tree = () => (
      <UIBridgeProvider>
        <GrabRegistry />
        <PermissionAutoAcceptPanel />
      </UIBridgeProvider>
    );

    usePolicyMock.mockReturnValue(hookState(ON_TENANT));
    const view = render(tree());
    const readState = () =>
      (registry as Registry | null)
        ?.getComponent("coord-tenant-permission-auto-accept")
        ?.getState?.();
    expect(readState()).toMatchObject({
      domain: "permission_auto_accept",
      resolvedLevel: "on",
      resolvedScope: "tenant",
      canEdit: true,
    });

    // A write's read-back now resolves `off`: the bridge must report it too.
    usePolicyMock.mockReturnValue(
      hookState({ ...ON_TENANT, effective_level: "off" })
    );
    view.rerender(tree());
    expect(
      screen.getByTestId("permission-auto-accept-effective").textContent
    ).toBe("off");
    expect(readState()).toMatchObject({ resolvedLevel: "off" });

    // A failed read is null, never `off`.
    usePolicyMock.mockReturnValue(hookState(null, { error: "HTTP 502" }));
    view.rerender(tree());
    expect(readState()).toMatchObject({
      resolvedLevel: null,
      resolvedScope: null,
      error: "HTTP 502",
    });
  });

  it("outside act, a bridge read sampled right after a non-discrete commit reports the level the badge shows", async () => {
    // RTL's render/rerender wrap in act(), which flushes every effect before
    // returning, so the test above cannot see a state ref refreshed in a
    // passive effect. Here the update lands from a resolved promise (not a
    // discrete input event) with act disabled, and the registry is sampled
    // from a MutationObserver callback on the panel's own DOM: a microtask
    // after the commit and before React's passive-effect flush.
    type Registry = NonNullable<
      ReturnType<typeof useUIBridgeOptional>
    >["registry"];
    let registry: Registry | null = null;
    function GrabRegistry() {
      const bridge = useUIBridgeOptional();
      useLayoutEffect(() => {
        registry = bridge?.registry ?? null;
      }, [bridge]);
      return null;
    }
    // A passive-effect canary in the same commit: if passive effects have
    // already run when the sample is taken, the sample is not inside the gap
    // and the test would pass vacuously against a passive-effect state ref.
    let passiveRanForOff = false;
    function PassiveCanary({ level }: { level: string | null }) {
      useEffect(() => {
        if (level === "off") passiveRanForOff = true;
      }, [level]);
      return null;
    }
    // Every consumer of the mocked hook (the panel and the canary) holds its
    // own state; the update sets them all in one task, so they commit together.
    const setters = new Set<(p: FleetPolicyView) => void>();
    usePolicyMock.mockImplementation(() => {
      const [policy, set] = useState<FleetPolicyView>(ON_TENANT);
      setters.add(set);
      return hookState(policy);
    });
    function CanaryFromPolicy() {
      return (
        <PassiveCanary
          level={usePolicyMock().policy?.effective_level ?? null}
        />
      );
    }

    let view: RenderResult | undefined;
    const readState = () =>
      (registry as Registry | null)
        ?.getComponent("coord-tenant-permission-auto-accept")
        ?.getState?.() as Record<string, unknown> | undefined;
    const badge = () =>
      screen.queryByTestId("permission-auto-accept-effective")?.textContent ??
      null;

    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    try {
      view = render(
        <UIBridgeProvider>
          <GrabRegistry />
          <PermissionAutoAcceptPanel />
          <CanaryFromPolicy />
        </UIBridgeProvider>
      );
      expect(readState()).toMatchObject({ resolvedLevel: "on" });
      const panel = screen.getByTestId("permission-auto-accept-policy");
      expect(badge()).toBe("on");
      g.IS_REACT_ACT_ENVIRONMENT = false;
      let observer: MutationObserver | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sampled = new Promise<{
        shown: string | null;
        state: unknown;
        passiveRan: boolean;
      }>((resolve, reject) => {
        observer = new MutationObserver(() => {
          try {
            if (badge() !== "off") return;
            observer?.disconnect();
            clearTimeout(timer);
            resolve({
              shown: badge(),
              state: readState()?.resolvedLevel,
              passiveRan: passiveRanForOff,
            });
          } catch (e) {
            observer?.disconnect();
            clearTimeout(timer);
            reject(e);
          }
        });
        observer.observe(panel, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        timer = setTimeout(() => {
          observer?.disconnect();
          reject(new Error("the badge never showed off"));
        }, 3000);
      });
      // A write's read-back resolving: a non-discrete (default-lane) update.
      void Promise.resolve().then(() =>
        setters.forEach((set) => set({ ...ON_TENANT, effective_level: "off" }))
      );
      expect(await sampled).toEqual({
        shown: "off",
        state: "off",
        passiveRan: false,
      });
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
      usePolicyMock.mockReset();
      view?.unmount();
    }
  });
  it("outside act, a bridge action invoked right after a non-discrete commit sees the role the panel shows", async () => {
    // The action-handler half of the same gap: a handler closing over
    // canEdit must see the committed render's value, not the previous one.
    type Registry = NonNullable<
      ReturnType<typeof useUIBridgeOptional>
    >["registry"];
    let registry: Registry | null = null;
    function GrabRegistry() {
      const bridge = useUIBridgeOptional();
      useLayoutEffect(() => {
        registry = bridge?.registry ?? null;
      }, [bridge]);
      return null;
    }
    let passiveRanForReadOnly = false;
    function PassiveCanary({ canEdit }: { canEdit: boolean | null }) {
      useEffect(() => {
        if (canEdit === false) passiveRanForReadOnly = true;
      }, [canEdit]);
      return null;
    }
    const setLevel = vi.fn<HookState["setLevel"]>().mockResolvedValue(true);
    const setters = new Set<(p: FleetPolicyView) => void>();
    usePolicyMock.mockImplementation(() => {
      const [policy, set] = useState<FleetPolicyView>(ON_TENANT);
      setters.add(set);
      return hookState(policy, { setLevel });
    });
    function CanaryFromPolicy() {
      return (
        <PassiveCanary canEdit={usePolicyMock().policy?.can_edit ?? null} />
      );
    }
    const invoke = () =>
      (registry as Registry | null)
        ?.getComponent("coord-tenant-permission-auto-accept")
        ?.actions?.find((a) => a.id === "set-permission-auto-accept")
        ?.handler({ level: "off" });
    const readOnlyShown = () =>
      screen.queryByTestId("permission-auto-accept-readonly") !== null;

    let view: RenderResult | undefined;
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    try {
      view = render(
        <UIBridgeProvider>
          <GrabRegistry />
          <PermissionAutoAcceptPanel />
          <CanaryFromPolicy />
        </UIBridgeProvider>
      );
      expect(readOnlyShown()).toBe(false);
      const panel = screen.getByTestId("permission-auto-accept-policy");
      g.IS_REACT_ACT_ENVIRONMENT = false;
      let observer: MutationObserver | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sampled = new Promise<{
        outcome: Promise<unknown> | undefined;
        passiveRan: boolean;
      }>((resolve, reject) => {
        observer = new MutationObserver(() => {
          try {
            if (!readOnlyShown()) return;
            observer?.disconnect();
            clearTimeout(timer);
            const outcome = invoke();
            outcome?.catch(() => undefined);
            resolve({ outcome, passiveRan: passiveRanForReadOnly });
          } catch (e) {
            observer?.disconnect();
            clearTimeout(timer);
            reject(e);
          }
        });
        observer.observe(panel, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        timer = setTimeout(() => {
          observer?.disconnect();
          reject(new Error("the read-only notice never showed"));
        }, 3000);
      });
      // A role read-back resolving: a non-discrete (default-lane) update.
      void Promise.resolve().then(() =>
        setters.forEach((set) => set({ ...ON_TENANT, can_edit: false }))
      );
      const { outcome, passiveRan } = await sampled;
      expect(passiveRan).toBe(false);
      await expect(outcome).rejects.toThrow(/read-only/);
      expect(setLevel).not.toHaveBeenCalled();
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
      usePolicyMock.mockReset();
      view?.unmount();
    }
  });
});
