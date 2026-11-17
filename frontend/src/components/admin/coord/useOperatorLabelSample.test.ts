/**
 * `useOperatorLabelSample` — an unloadable project list is "unavailable", and
 * a manual reload keeps it so rather than fetching over the top of it.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/services/service-factory", () => ({ httpClient: http }));

import { useOperatorLabelSample } from "./useOperatorLabelSample";

describe("useOperatorLabelSample", () => {
  afterEach(() => http.fetch.mockReset());

  it("reads the sample once the project is known", async () => {
    http.fetch.mockResolvedValue(
      new Response(JSON.stringify({ iso_week: "2026-W44", verdicts: [] }))
    );
    const { result } = renderHook(() =>
      useOperatorLabelSample("t-1", false, null)
    );
    await waitFor(() => expect(result.current.answer?.kind).toBe("answered"));
    expect(http.fetch).toHaveBeenCalledTimes(1);
  });

  it("a project-list failure is unavailable, and reload does not fetch over it", async () => {
    const { result } = renderHook(() =>
      useOperatorLabelSample(null, false, "HTTP 500")
    );
    await waitFor(() =>
      expect(result.current.answer).toEqual({
        kind: "unavailable",
        status: null,
        code: null,
        message: "the list of projects couldn’t be loaded (HTTP 500)",
      })
    );
    await act(() => result.current.reload());
    expect(result.current.answer?.kind).toBe("unavailable");
    expect(http.fetch).not.toHaveBeenCalled();
  });
});
