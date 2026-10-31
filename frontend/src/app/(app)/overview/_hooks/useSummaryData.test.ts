/**
 * `useSummaryData` — the progress read's request.
 *
 * The project-state door can take up to coord's whole 25 s budget (the proxy's
 * `_COORD_PROJECT_STATE_TIMEOUT`), and `httpClient`'s default retries turned
 * one slow coord into up to five reads per page load. The read must carry the
 * one-shot options: a `504` (the proxy's timeout on coord ran out) is never
 * retried.
 *
 * `httpClient.fetch` — the client's one transport (`lib/api/operations/base.ts`,
 * D6) — is stubbed BELOW `projectState.ts`, and the options are spelled as a
 * literal here, so the test cannot pass by reading back the constant the hook
 * sends. That `noRetryStatuses` does stop the retry is pinned by
 * `services/http-client.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

// The "recently finished" read and the intent documents are other sources;
// they are stubbed so the only `httpClient.fetch` is the progress read.
vi.mock("@/lib/api/operations/coordPlans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/operations/coordPlans")>()),
  fetchPlans: async () => ({ work_units: [] }),
}));
vi.mock("@/components/overview/editing/useResource", () => ({
  useResourceList: () => ({
    list: { state: "loading" },
    update: vi.fn(),
    create: vi.fn(),
  }),
}));

import { useSummaryData } from "./useSummaryData";

describe("useSummaryData — the progress read", () => {
  beforeEach(() => {
    httpFetch.mockReset();
  });

  it("reads the project-state door once, never retrying a 504", async () => {
    httpFetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ schema: 1, on_track: { state: "unknown" } })
        )
    );
    const { result } = renderHook(() => useSummaryData("t-1", false));
    await waitFor(() => expect(result.current.progress.state).toBe("ready"));
    expect(httpFetch.mock.calls).toEqual([
      [
        "/api/v1/operations/project-state",
        { noRetryStatuses: [504], method: "GET", idempotent: true },
      ],
    ]);
  });

  it("reads nothing while the project list is held", () => {
    renderHook(() => useSummaryData("t-1", true));
    expect(httpFetch).not.toHaveBeenCalled();
  });
});
