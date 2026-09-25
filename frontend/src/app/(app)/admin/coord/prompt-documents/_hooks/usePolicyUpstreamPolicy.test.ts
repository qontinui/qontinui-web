/**
 * usePolicyUpstreamPolicy — the level vocabulary of the upstream-adoption dial.
 *
 * Read, write, read-back and the refresh-vs-write race guard are the shared
 * dial's, and `_shared/useTenantFleetPolicyDial.test.ts` pins them once. What
 * is pinned HERE is only what this domain adds on top, because three different
 * facts all come back looking like, or resolving to, `off`:
 *
 * | Row | `effective_level` | `resolved_scope` | In force |
 * |---|---|---|---|
 * | none | `"off"` | `"none"` | `auto` — coord's typed default |
 * | present, level off | `"off"` | the band | `off` — an operator's choice |
 * | present, unparseable level | the raw string | the band | `off` — fail-closed |
 *
 * Collapsing the first into `off` ships the feature dark on screen: every
 * untouched tenant would be shown as ignoring publications that coord is in
 * fact applying. Collapsing the third into the default reports a row coord
 * cannot read as authority to write bodies into this tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

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

import { usePolicyUpstreamPolicy } from "./usePolicyUpstreamPolicy";

/** Nobody has ever written a row for this tenant. */
const NO_ROW = {
  domain: "policy_upstream",
  effective_level: "off",
  master_enabled: false,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

/** An operator deliberately turned the dial off. */
const OFF_TENANT = {
  ...NO_ROW,
  master_enabled: true,
  resolved_scope: "tenant",
};

const NOTIFY_TENANT = { ...OFF_TENANT, effective_level: "notify" };

async function render(view: object) {
  getMock.mockResolvedValue(view);
  const hook = renderHook(() => usePolicyUpstreamPolicy());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePolicyUpstreamPolicy — 'no row' is auto, not off", () => {
  it("resolves a missing row to auto and flags it as defaulted", async () => {
    const result = await render(NO_ROW);

    // The raw wire value. Rendering THIS is the bug the hook exists to avoid.
    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.displayLevel).toBe("auto");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=policy_upstream")
    );
  });

  it("honours an explicit off — the same string, the opposite meaning", async () => {
    const result = await render(OFF_TENANT);

    // Keying the default on `effective_level === "off"` instead of on the
    // scope band would turn this back into `auto` and make the dial
    // unturnoffable.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("decides 'no row' before parsing the level", async () => {
    // Only the scope band says no row matched. If the level were parsed first,
    // an untouched tenant would be reported as a broken row resolved off.
    const result = await render({ ...NO_ROW, effective_level: "unknown" });

    expect(result.current.displayLevel).toBe("auto");
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("does not treat a winning system-band off as the default", async () => {
    // A system row is a row: coord's default applies only on `"none"`.
    // Reading "no tenant row" as "defaulted" would show a fleet-wide off as
    // auto.
    const result = await render({ ...OFF_TENANT, resolved_scope: "system" });

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("shows no level at all until a read succeeds", async () => {
    getMock.mockRejectedValue(new Error("coord is not reachable"));
    const { result } = renderHook(() => usePolicyUpstreamPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Neither the default nor fail-closed off: nothing has been read.
    expect(result.current.displayLevel).toBeNull();
    expect(result.current.error).toContain("coord is not reachable");
  });

  it("passes a recognised level through unflagged", async () => {
    const result = await render(NOTIFY_TENANT);

    expect(result.current.displayLevel).toBe("notify");
    expect(result.current.unrecognizedLevel).toBeNull();
  });
});

describe("usePolicyUpstreamPolicy — an unparseable level is off, not auto", () => {
  it("resolves a level coord cannot parse fail-closed and keeps the raw string", async () => {
    const result = await render({ ...OFF_TENANT, effective_level: "Auto" });

    // Deliberately NOT the no-row default: an authority setting coord cannot
    // read is not permission to write another tenant's body into this one.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
    expect(result.current.unrecognizedLevel).toBe("Auto");
  });
});

describe("usePolicyUpstreamPolicy — writes", () => {
  it("writes the policy_upstream domain at the tenant band", async () => {
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_upstream",
      written_level: "notify",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: "operator@example.com",
      effective: NOTIFY_TENANT,
      readback_error: null,
    });
    const result = await render(NO_ROW);

    await act(async () => {
      await result.current.setLevel("notify");
    });

    const [, body] = putMock.mock.calls[0];
    expect(body.domain).toBe("policy_upstream");
    expect(body.scope_band).toBe("tenant");
    expect(body.level).toBe("notify");
    // The write moved the tenant off the no-row default; the defaulted flag
    // must follow the read-back rather than stick.
    expect(result.current.displayLevel).toBe("notify");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("turns a defaulted tenant off with an explicit off row", async () => {
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_upstream",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: "operator@example.com",
      effective: OFF_TENANT,
      readback_error: null,
    });
    const result = await render(NO_ROW);
    expect(result.current.displayLevel).toBe("auto");

    await act(async () => {
      await result.current.setLevel("off");
    });

    // `off` is a level on a live master, never a master flip.
    expect(putMock.mock.calls[0][1]).toMatchObject({
      level: "off",
      master_enabled: true,
    });
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });
});
