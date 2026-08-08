/**
 * `useDeliveryVerdict` — the delivery lookup's wire contract.
 *
 * The whole hook is one query string, and the query string is the thing that
 * breaks silently. Phase 3 of plan
 * `2026-07-30-coord-web-plan-slug-wire-key-retirement` moved the slug param
 * from `plan_slug` to `work_unit_slug`; the backend proxy validates the param
 * set locally and 400s on anything else, so a drift back to the old spelling
 * shows up as "Could not read the delivery verdict" on the card — with `tsc`
 * green, because a template literal is just a string. Nothing pinned the
 * spelling until this file.
 *
 * The mount gate matters for the same reason it was written: the Spec CI crawl
 * renders this page without a live coord, so an ungated fetch would dial coord
 * on every crawl.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => getMock(...args) },
}));

import { useDeliveryVerdict } from "./useDeliveryVerdict";

function wrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const VERDICT = {
  work_unit_slug: "2026-06-13-approach-d-conductor-engine",
  tool: "coord_query_delivery",
  verdict: { instance: "delivery", drift_class: "none" },
};

describe("useDeliveryVerdict", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue(VERDICT);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("sends the slug as work_unit_slug, never the retired plan_slug", async () => {
    const { result } = renderHook(
      () => useDeliveryVerdict("2026-06-13-approach-d-conductor-engine"),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.data).toEqual(VERDICT));

    const url = getMock.mock.calls[0][0] as string;
    expect(url).toContain(
      "work_unit_slug=2026-06-13-approach-d-conductor-engine",
    );
    // Not merely "prefers the new key" — the old one must be gone. Coord drops
    // `plan_slug` in Phase 4, and this proxy forwards only what it is given.
    expect(url).not.toContain("plan_slug");
  });

  it("percent-encodes a slug so a path-shaped one cannot escape the param", async () => {
    const { result } = renderHook(
      () => useDeliveryVerdict("plans/2026-06-13-approach-d.md"),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getMock.mock.calls[0][0]).toContain(
      `work_unit_slug=${encodeURIComponent("plans/2026-06-13-approach-d.md")}`,
    );
  });

  it("does not dial the backend until a slug is submitted", async () => {
    const { rerender } = renderHook(
      ({ slug }: { slug: string }) => useDeliveryVerdict(slug),
      { wrapper: wrapper(queryClient), initialProps: { slug: "" } },
    );

    // Whitespace is not a submission either — the hook trims before gating.
    rerender({ slug: "   " });
    expect(getMock).not.toHaveBeenCalled();

    rerender({ slug: "2026-06-13-approach-d-conductor-engine" });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
  });
});
