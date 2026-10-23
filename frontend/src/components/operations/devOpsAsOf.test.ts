/**
 * The as-of the Dev Ops presentation lens dates its figures by (plan
 * `2026-10-23-console-presentation-spaces` Phase 7).
 *
 * Coord's fleet-health, dispatch-role and drain bodies carry no timestamp of
 * their own, so each hook stamps the moment an ANSWER arrived, and the
 * provenance chips state it. The rule each test holds: nothing is dated before
 * the first answer, a failed poll never re-dates the last answer (it would
 * make stale data look current), and the next answer moves it on.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchFleetHealth: vi.fn(),
  fetchFleetDispatchRoles: vi.fn(),
  fetchFleetDrain: vi.fn(),
}));
vi.mock("@/lib/api/operations/coordFleet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/operations/coordFleet")>()),
  ...api,
}));

import { useFleetDispatchRoles } from "./useFleetDispatchRoles";
import { useFleetDrain } from "./useFleetDrain";
import { useFleetHealth } from "./useFleetHealth";

const T0 = 1_760_000_000_000;
const LATER = T0 + 60_000;

let clock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clock = vi.spyOn(Date, "now").mockReturnValue(T0);
  for (const fn of Object.values(api)) fn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFleetHealth.fetchedAtMs", () => {
  it("dates an answer, keeps that date through a failed poll, and moves on with the next answer", async () => {
    api.fetchFleetHealth.mockResolvedValueOnce({ devices: [] });
    const { result } = renderHook(() => useFleetHealth());
    expect(result.current.fetchedAtMs).toBeNull();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.fetchedAtMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetHealth.mockRejectedValueOnce(new Error("coord timed out"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.fetchedAtMs).toBe(T0);

    api.fetchFleetHealth.mockResolvedValueOnce({ devices: [] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.fetchedAtMs).toBe(LATER);
  });
});

describe("useFleetDispatchRoles.fetchedAtMs", () => {
  it("dates only a KNOWN read", async () => {
    const known = { state: "known", machines: [], roster_truncated: false };
    api.fetchFleetDispatchRoles.mockResolvedValueOnce(known);
    const { result } = renderHook(() => useFleetDispatchRoles());
    expect(result.current.fetchedAtMs).toBeNull();
    await waitFor(() => expect(result.current.read.state).toBe("known"));
    expect(result.current.fetchedAtMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetDispatchRoles.mockRejectedValueOnce(new Error("refused"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.read.state).toBe("unknown");
    expect(result.current.fetchedAtMs).toBe(T0);

    api.fetchFleetDispatchRoles.mockResolvedValueOnce(known);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.fetchedAtMs).toBe(LATER);
  });
});

describe("useFleetDrain.fetchedAtMs", () => {
  it("dates only an OK read", async () => {
    api.fetchFleetDrain.mockResolvedValueOnce({ drained: {} });
    const { result } = renderHook(() => useFleetDrain());
    expect(result.current.fetchedAtMs).toBeNull();
    await waitFor(() => expect(result.current.read.state).toBe("ok"));
    expect(result.current.fetchedAtMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetDrain.mockRejectedValueOnce(new Error("refused"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.read.state).toBe("unknown");
    expect(result.current.fetchedAtMs).toBe(T0);

    api.fetchFleetDrain.mockResolvedValueOnce({ drained: {} });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.fetchedAtMs).toBe(LATER);
  });
});
