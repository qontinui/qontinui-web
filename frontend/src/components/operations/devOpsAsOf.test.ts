/**
 * The as-of the Dev Ops presentation lens dates its figures by (plan
 * `2026-10-23-console-presentation-spaces` Phase 7).
 *
 * Coord's fleet-health, dispatch-role and drain bodies carry coord's own
 * `as_of` — when its read was true — and each hook dates its answer by it,
 * falling back to the moment the answer arrived only for a body that names no
 * valid time (`servedAsOf.ts`). The provenance chips state it. The rules each
 * test holds: nothing is dated before the first answer, coord's instant wins
 * over the browser's receipt, a failed poll never re-dates the last answer (it
 * would make stale data look current), and the next answer moves it on.
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
/** Coord's read, 7 s before the browser received the answer. */
const COORD_AS_OF = T0 - 7_000;
const iso = (ms: number) => new Date(ms).toISOString();

let clock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clock = vi.spyOn(Date, "now").mockReturnValue(T0);
  for (const fn of Object.values(api)) fn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFleetHealth.asOfMs", () => {
  it("dates an answer, keeps that date through a failed poll, and moves on with the next answer", async () => {
    api.fetchFleetHealth.mockResolvedValueOnce({ devices: [] });
    const { result } = renderHook(() => useFleetHealth());
    expect(result.current.asOfMs).toBeNull();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.asOfMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetHealth.mockRejectedValueOnce(new Error("coord timed out"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.asOfMs).toBe(T0);

    api.fetchFleetHealth.mockResolvedValueOnce({ devices: [] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.asOfMs).toBe(LATER);
  });

  it("dates the answer by coord's own as_of, not by when the browser received it", async () => {
    api.fetchFleetHealth.mockResolvedValueOnce({
      devices: [],
      as_of: iso(COORD_AS_OF),
    });
    const { result } = renderHook(() => useFleetHealth());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.asOfMs).toBe(COORD_AS_OF);
  });
});

describe("useFleetDispatchRoles.asOfMs", () => {
  it("dates only a KNOWN read", async () => {
    const known = { state: "known", machines: [], roster_truncated: false };
    api.fetchFleetDispatchRoles.mockResolvedValueOnce(known);
    const { result } = renderHook(() => useFleetDispatchRoles());
    expect(result.current.asOfMs).toBeNull();
    await waitFor(() => expect(result.current.read.state).toBe("known"));
    expect(result.current.asOfMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetDispatchRoles.mockRejectedValueOnce(new Error("refused"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.read.state).toBe("unknown");
    expect(result.current.asOfMs).toBe(T0);

    api.fetchFleetDispatchRoles.mockResolvedValueOnce(known);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.asOfMs).toBe(LATER);
  });

  it("dates a known read by coord's own as_of", async () => {
    api.fetchFleetDispatchRoles.mockResolvedValueOnce({
      state: "known",
      machines: [],
      roster_truncated: false,
      as_of: iso(COORD_AS_OF),
    });
    const { result } = renderHook(() => useFleetDispatchRoles());
    await waitFor(() => expect(result.current.read.state).toBe("known"));
    expect(result.current.asOfMs).toBe(COORD_AS_OF);
  });
});

describe("useFleetDrain.asOfMs", () => {
  it("dates only an OK read", async () => {
    api.fetchFleetDrain.mockResolvedValueOnce({ drained: {} });
    const { result } = renderHook(() => useFleetDrain());
    expect(result.current.asOfMs).toBeNull();
    await waitFor(() => expect(result.current.read.state).toBe("ok"));
    expect(result.current.asOfMs).toBe(T0);

    clock.mockReturnValue(LATER);
    api.fetchFleetDrain.mockRejectedValueOnce(new Error("refused"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.read.state).toBe("unknown");
    expect(result.current.asOfMs).toBe(T0);

    api.fetchFleetDrain.mockResolvedValueOnce({ drained: {} });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.asOfMs).toBe(LATER);
  });

  it("dates an ok read by coord's own as_of, and an unknown one not at all", async () => {
    api.fetchFleetDrain.mockResolvedValueOnce({
      state: "known",
      as_of: iso(COORD_AS_OF),
      drained: [],
      count: 0,
      detail: null,
    });
    const { result } = renderHook(() => useFleetDrain());
    await waitFor(() => expect(result.current.read.state).toBe("ok"));
    expect(result.current.asOfMs).toBe(COORD_AS_OF);

    // Coord answered, but could not read the drain state: its as_of dates a
    // read that knows nothing, so the last known answer keeps its date.
    clock.mockReturnValue(LATER);
    api.fetchFleetDrain.mockResolvedValueOnce({
      state: "unknown",
      as_of: iso(LATER),
      drained: null,
      count: null,
      detail: "coord could not read the drain map",
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.read.state).toBe("unknown");
    expect(result.current.asOfMs).toBe(COORD_AS_OF);
  });
});
