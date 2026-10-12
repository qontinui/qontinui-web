/**
 * The open-PR listing read's failure reporting.
 *
 * The hot poll's `/pr-merge/prs` read KEEPS the last good rows when it fails,
 * so the pipeline does not blink empty mid-triage. Until this was reported,
 * that also meant a slow coord rendered as a current pipeline, and a first
 * read that failed rendered as an EMPTY one. (The listing measured 2.3-12.3s
 * after qontinui-coord#2414, coord findings 685356b1 and addc9526, against a
 * 5s proxy timeout.) `prsError` and `prsLoaded` let the page tell those apart.
 *
 * Harness mirrors `useMergePipelineData.merged.test.ts`: `httpClient` is
 * stubbed with a controllable listing response; everything else gets an inert
 * 200 so only the listing read is under test.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    // No token: the hook stays on its poll and never builds a WebSocket.
    getWebSocketToken: async () => null,
  },
}));

import { useMergePipelineData } from "./useMergePipelineData";

const POLL_MS = 15_000;
// Set per test: what the listing read answers with.
let listingResponse: () => Promise<unknown>;

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });
const status = (code: number) =>
  Promise.resolve({ ok: false, status: code, json: async () => ({}) });

const row = { repo: "qontinui/qontinui-coord", pr_number: 1, branch: "b-1" };

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  listingResponse = () => okJson({ prs: [row], total: 1 });
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/pr-merge/prs?merged_count_hours=")) {
      return listingResponse();
    }
    return okJson({});
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMergePipelineData — open-PR listing read", () => {
  it("reports a successful read as loaded with no error", async () => {
    const { result } = renderHook(() => useMergePipelineData());
    await flush();

    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prsLoaded).toBe(true);
    expect(result.current.prsError).toBeNull();
  });

  it("reports a first read that fails as never loaded, not as an empty pipeline", async () => {
    listingResponse = () => status(504);

    const { result } = renderHook(() => useMergePipelineData());
    await flush();

    // `[]` keeps the page renderable; `prsLoaded` false says it is unknown.
    expect(result.current.prs).toEqual([]);
    expect(result.current.prsLoaded).toBe(false);
    expect(result.current.prsError).toBe("HTTP 504");
  });

  it("keeps the last rows, flags them stale, and clears the flag on the next success", async () => {
    const { result } = renderHook(() => useMergePipelineData());
    await flush();
    expect(result.current.prsLoaded).toBe(true);

    listingResponse = () => Promise.reject(new Error("network down"));
    await advance(POLL_MS);

    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prsLoaded).toBe(true);
    expect(result.current.prsError).toBe("network down");

    listingResponse = () => okJson({ prs: [row], total: 1 });
    await advance(POLL_MS);

    expect(result.current.prsError).toBeNull();
  });

  it("clears a reported failure when a later read answers 404", async () => {
    listingResponse = () => status(504);
    const { result } = renderHook(() => useMergePipelineData());
    await flush();
    expect(result.current.prsError).toBe("HTTP 504");

    listingResponse = () => status(404);
    await advance(POLL_MS);

    expect(result.current.prsError).toBeNull();
    expect(result.current.prsLoaded).toBe(true);
    expect(result.current.prs).toEqual([]);
  });

  it("treats a 404 as an authoritative empty list, not a failure", async () => {
    listingResponse = () => status(404);

    const { result } = renderHook(() => useMergePipelineData());
    await flush();

    expect(result.current.prs).toEqual([]);
    expect(result.current.prsLoaded).toBe(true);
    expect(result.current.prsError).toBeNull();
  });
});
