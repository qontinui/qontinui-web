/**
 * usePolicyWritePolicy — the honesty properties of the policy-write dial.
 *
 * A dial that reports what was WRITTEN rather than what RESOLVES is worse than
 * no dial: it tells the operator the fleet is in a state it is not in, and
 * nothing else on the page contradicts it. This domain adds a second way to get
 * that wrong, because coord answers `effective_level: "off"` for three
 * different facts and they do NOT all resolve the same way:
 *
 * | Row | `effective_level` | `resolved_scope` | In force |
 * |---|---|---|---|
 * | none | `"off"` | `"none"` | `tightening_only` — the code default |
 * | present, master off | `"off"` | the band | `off` — an operator's choice |
 * | present, unparseable level | the raw string | the band | `off` — fail-closed |
 *
 * Collapsing the first into `off` disables, on screen, a capability every
 * untouched tenant is using. Collapsing the third into the default reports a
 * broken row as working. Both are pinned below.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
// Arrow indirection: `vi.mock` factories hoist above these consts, so naming
// them eagerly is a TDZ error.
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { usePolicyWritePolicy } from "./usePolicyWritePolicy";

/** Nobody has ever written a row for this tenant. */
const NO_ROW = {
  domain: "policy_write",
  effective_level: "off",
  master_enabled: false,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: ["controls", "drain"],
  keys_not_shown_source: "fleet_resources_row",
};

/** An operator deliberately turned the dial off. */
const OFF_TENANT = {
  domain: "policy_write",
  effective_level: "off",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

const PROPOSE_ONLY_TENANT = {
  ...OFF_TENANT,
  effective_level: "propose_only",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePolicyWritePolicy — 'no row' is the code default, not off", () => {
  it("resolves a missing row to tightening_only and flags it as defaulted", async () => {
    getMock.mockResolvedValue(NO_ROW);

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The raw wire value. Rendering THIS is the bug the hook exists to avoid.
    expect(result.current.policy?.effective_level).toBe("off");
    // What coord actually enforces when no row matched.
    expect(result.current.displayLevel).toBe("tightening_only");
    expect(result.current.isDefaulted).toBe(true);
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("domain=policy_write")
    );
  });

  it("honours an explicit off — the same string, the opposite meaning", async () => {
    getMock.mockResolvedValue(OFF_TENANT);

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A row exists, so `off` is an operator's decision and must survive intact.
    // Keying the default on `effective_level === "off"` instead of on the scope
    // band would convert this back to `tightening_only` and make the dial
    // unturnoffable.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });
});

describe("usePolicyWritePolicy — an unparseable level is off, not the default", () => {
  it("resolves a level coord cannot parse the way coord enforces it", async () => {
    getMock.mockResolvedValue({
      ...OFF_TENANT,
      // Hand-written or typo'd. `level` is free text on every layer, and the
      // generic fleet-policy GET does not parse it.
      effective_level: "tightening-only",
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Coord's `parse_fail_closed` refuses everything for this row. Showing the
    // stored string as "in force" would report a fleet that is fully blocked as
    // one running the ordinary default.
    expect(result.current.displayLevel).toBe("off");
    // Deliberately NOT the no-row default: nobody-ruled and ruled-unreadably
    // are different facts and resolve in opposite directions.
    expect(result.current.displayLevel).not.toBe("tightening_only");
    expect(result.current.isDefaulted).toBe(false);
    // The raw value is kept so the UI can name the row that needs fixing.
    expect(result.current.unrecognizedLevel).toBe("tightening-only");
  });

  it("does not flag a recognised level as unrecognised", async () => {
    getMock.mockResolvedValue(PROPOSE_ONLY_TENANT);

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLevel).toBe("propose_only");
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("does not flag the no-row case as unrecognised", async () => {
    // `NO_ROW` carries `effective_level: "off"`, which IS in the vocabulary —
    // but the branch order matters: `isDefaulted` must win, or an untouched
    // tenant would be reported as a broken row.
    getMock.mockResolvedValue(NO_ROW);

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unrecognizedLevel).toBeNull();
  });
});

describe("usePolicyWritePolicy — writes", () => {
  it("sends the closed body coord accepts and no more", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_write",
      written_level: "propose_only",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: "operator@example.com",
      effective: PROPOSE_ONLY_TENANT,
      readback_error: null,
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("propose_only");
    });

    const [, body] = putMock.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual([
      "change_note",
      "domain",
      "level",
      "master_enabled",
      "scope_band",
      "scope_key",
    ]);
    expect(body.scope_band).toBe("tenant");
    expect(body.scope_key).toBeNull();
    // `off` is expressed as a LEVEL, never by flipping the master, so the dial
    // has exactly one spelling of "off".
    expect(body.master_enabled).toBe(true);
    expect(result.current.displayLevel).toBe("propose_only");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("writes full — coord retired the clamp, so the console must not impose one", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_write",
      written_level: "full",
      written_master_enabled: true,
      versioned: true,
      version: 3,
      updated_by: "operator@example.com",
      effective: { ...OFF_TENANT, effective_level: "full" },
      readback_error: null,
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("full");
    });

    expect(putMock.mock.calls[0][1].level).toBe("full");
    expect(result.current.displayLevel).toBe("full");
  });

  it("reports the RESOLVED value when it disagrees with what was written", async () => {
    getMock.mockResolvedValue(NO_ROW);
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_write",
      written_level: "full",
      written_master_enabled: true,
      versioned: true,
      version: 4,
      updated_by: "operator@example.com",
      // A narrower repo-band row wins over the tenant row just written — and
      // this is also the shape a RE-ARMED server-side `full` clamp takes, which
      // is why the console can offer `full` without reading coord's flag.
      effective: {
        ...OFF_TENANT,
        effective_level: "tightening_only",
        resolved_scope: "repo",
      },
      readback_error: null,
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("full");
    });

    // The load-bearing assertion: the displayed level is the RESOLVED one.
    expect(result.current.displayLevel).toBe("tightening_only");
    expect(result.current.policy?.resolved_scope).toBe("repo");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining("devices resolve")
    );
  });

  it("treats a failed read-back as UNKNOWN, not as the written value", async () => {
    getMock.mockResolvedValue(OFF_TENANT);
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_write",
      written_level: "tightening_only",
      written_master_enabled: true,
      versioned: null,
      version: null,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setLevel("tightening_only");
    });

    // The write landed. What devices resolve is NOT known, so the displayed
    // value must stay the last one we could confirm.
    expect(result.current.displayLevel).toBe("off");
    expect(result.current.readbackError).toContain("502");
    // The write's own echo is kept separately so the banner can name what was
    // written beside a value that was never confirmed.
    expect(result.current.lastWrite?.written_level).toBe("tightening_only");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("retires the read-back warning once a read confirms the value", async () => {
    getMock.mockResolvedValue(OFF_TENANT);
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_write",
      written_level: "propose_only",
      written_master_enabled: true,
      versioned: null,
      version: null,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setLevel("propose_only");
    });
    expect(result.current.readbackError).toBeTruthy();

    getMock.mockResolvedValue(PROPOSE_ONLY_TENANT);
    await act(async () => {
      await result.current.reload();
    });

    // The banner says "the value above may be stale". Leaving it beside a value
    // we just confirmed would be the opposite of honest.
    expect(result.current.readbackError).toBeNull();
    expect(result.current.displayLevel).toBe("propose_only");
  });

  it("keeps the last known value on a failed read rather than showing off", async () => {
    getMock.mockResolvedValueOnce(PROPOSE_ONLY_TENANT);
    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("coord is not reachable"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toContain("coord is not reachable");
    // Blanking this would render as "off", which is a claim we cannot make.
    expect(result.current.displayLevel).toBe("propose_only");
  });

  it("surfaces a rejected write without touching the displayed value", async () => {
    getMock.mockResolvedValue(PROPOSE_ONLY_TENANT);
    putMock.mockRejectedValue(new Error("admin_required"));

    const { result } = renderHook(() => usePolicyWritePolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.setLevel("off");
    });

    expect(outcome).toBe(false);
    expect(result.current.displayLevel).toBe("propose_only");
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("admin_required")
    );
  });
});
