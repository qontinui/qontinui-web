/**
 * usePolicyUpstreamPolicy — the level vocabulary of the upstream-adoption dial.
 *
 * Read, write, read-back and the refresh-vs-write race guard are the shared
 * dial's, and `_shared/useTenantFleetPolicyDial.test.ts` pins them once. What
 * is pinned HERE is only what this domain adds on top. Since
 * qontinui-coord#4239, coord serves the typed default as `effective_level`
 * when no row matches (before it, that answer read `"off"`):
 *
 * | Row | `effective_level` | `resolved_scope` | In force |
 * |---|---|---|---|
 * | none | `"auto"` — coord's typed default | `"none"` | `auto`, flagged defaulted |
 * | present, level off | `"off"` | the band | `off` — an operator's choice |
 * | present, unparseable level | the raw string | the band | `off` — fail-closed |
 * | none, unparseable level | the raw string | `"none"` | UNKNOWN — vocabulary skew |
 *
 * Showing the first as `off` ships the feature dark on screen: every untouched
 * tenant would be shown as ignoring publications that coord is in fact
 * applying. Collapsing the third into a default reports a row coord cannot
 * read as authority to write bodies into this tenant; showing the fourth as
 * `off` claims a level coord is not enforcing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PINNED_PAGE, withPageGuard } from "../__fixtures__/pageWriteGuard";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The hooks call `httpClient.fetch` (the typed /operations client); route
    // each request onto the per-verb mock the assertions below read.
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      const body = JSON.parse(init.body ?? "null");
      let out: unknown;
      if (method === "GET") out = await getMock(url);
      else if (method === "PUT") out = await putMock(url, body);
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      // A mock that resolves a `Response` (an error path) is answered
      // as-is, so a non-2xx goes through `readJson` like the real one.
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { usePolicyUpstreamPolicy } from "./usePolicyUpstreamPolicy";

// The hook on its own, under the page's guard once its project is known: it
// requires one, and reads only under the page's pin (`__fixtures__`).
const SectionGuard = withPageGuard(PINNED_PAGE);

/** Nobody has ever written a row for this tenant. */
const NO_ROW = {
  domain: "policy_upstream",
  // coord's typed default, served with no row (qontinui-coord#4239).
  effective_level: "auto",
  master_enabled: false,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

/** An operator deliberately turned the dial off. */
const OFF_TENANT = {
  ...NO_ROW,
  effective_level: "off",
  master_enabled: true,
  resolved_scope: "tenant",
};

const NOTIFY_TENANT = { ...OFF_TENANT, effective_level: "notify" };

async function render(view: object) {
  getMock.mockResolvedValue(view);
  const hook = renderHook(() => usePolicyUpstreamPolicy(), {
    wrapper: SectionGuard,
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook.result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePolicyUpstreamPolicy — 'no row' is coord's served default", () => {
  it("shows the served auto for a missing row and flags it as defaulted", async () => {
    const result = await render(NO_ROW);

    expect(result.current.policy?.effective_level).toBe("auto");
    expect(result.current.displayLevel).toBe("auto");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=policy_upstream")
    );
  });

  it("honours an explicit off — the same string, the opposite meaning", async () => {
    const result = await render(OFF_TENANT);

    // A row exists, so `off` is an operator's decision and must survive intact.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("shows a no-row answer whose served level is unparseable as UNKNOWN", async () => {
    // Vocabulary skew: coord serving, with no row, a default this console does
    // not know. Coord enforces that default, so `off` would be false; the
    // console used to substitute its own copy of `auto` here, which masked
    // this.
    const result = await render({ ...NO_ROW, effective_level: "manual" });

    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.defaultUnreadable).toBe(true);
    expect(result.current.displayLevel).toBeNull();
    expect(result.current.unrecognizedLevel).toBe("manual");
  });

  it("reads the served default rather than a console copy of it", async () => {
    // Not the old console constant `auto`: a revert to it fails this.
    const result = await render({ ...NO_ROW, effective_level: "notify" });

    expect(result.current.displayLevel).toBe("notify");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("honours a master-disabled row as off", async () => {
    const result = await render({ ...OFF_TENANT, master_enabled: false });

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
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
    getMock.mockImplementation(
      async () => new Response("coord is not reachable", { status: 502 })
    );
    const { result } = renderHook(() => usePolicyUpstreamPolicy(), {
      wrapper: SectionGuard,
    });
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
