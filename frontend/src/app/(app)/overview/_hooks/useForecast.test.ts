import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchForecast: vi.fn() }));
vi.mock("../_lib/timeline-api", () => ({
  fetchForecast: mocks.fetchForecast,
}));

import { useForecast } from "./useForecast";

describe("useForecast", () => {
  beforeEach(() => {
    mocks.fetchForecast.mockReset();
  });

  it("never shows one estimate's error for another", async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    mocks.fetchForecast.mockImplementation((id: string) =>
      id === "e1"
        ? Promise.reject(new Error("e1 could not be read"))
        : new Promise((resolve) => {
            resolveSecond = resolve;
          })
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useForecast(id, false),
      { initialProps: { id: "e1" } }
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        state: "error",
        message: "e1 could not be read",
      })
    );

    // The project switched: e2 is being read, e1's error must not stand in.
    rerender({ id: "e2" });
    expect(result.current).toEqual({ state: "loading" });

    await act(async () => {
      resolveSecond({ estimate_id: "e2" });
    });
    expect(result.current).toMatchObject({
      state: "ready",
      forecast: { estimate_id: "e2" },
    });
  });
});
