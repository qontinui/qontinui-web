/**
 * Extraction screenshots are fetched from the ACTIVE runner through the
 * transport resolver, every object URL created is revoked, and a path the
 * relay does not carry renders the runner's "needs the runner on this
 * machine" message instead of a broken image.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

import type { RunnerTarget } from "@/lib/runner/target";
import { httpClient } from "@/services/service-factory";

const runnerTargetMock = vi.hoisted(() => ({
  current: null as unknown,
}));
vi.mock("@/contexts/active-runner-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contexts/active-runner-context")>();
  return {
    ...actual,
    useRunnerTarget: () => runnerTargetMock.current,
  };
});
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));

import { RUNNER_NEEDS_LOCAL } from "@/lib/runner";
import { PageThumbnailList } from "../PageThumbnailList";
import { useExtractionScreenshotCache } from "./useExtractionScreenshot";

/** A runner proven to be on this machine: requests go over loopback. */
const LOCAL: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-local", port: 9877, name: "Local" },
  locality: "local",
};

/** A runner on another machine: requests go over the backend relay. */
const REMOTE: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-remote", port: 9877, name: "Remote Box" },
  locality: "not_local",
};

const ANNOTATION = {
  screenshot_id: "shot-1",
  source_url: "https://example.com/page",
  states: [],
} as unknown as Parameters<typeof PageThumbnailList>[0]["annotations"][number];

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
  vi.mocked(httpClient.fetch).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLoopbackImages() {
  const fetchSpy = vi.fn(
    async () => new Response(new Blob(["png"]), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function relayRefusesPath() {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(httpClient.fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        error:
          "this path is not carried by the HTTP relay — GET /extraction/x/screenshot/y",
      }),
      { status: 403 }
    )
  );
}

describe("PageThumbnailList", () => {
  it("fetches the screenshot from the active runner and revokes it on unmount", async () => {
    runnerTargetMock.current = LOCAL;
    const fetchSpy = stubLoopbackImages();
    const { unmount } = render(
      <PageThumbnailList
        annotations={[ANNOTATION]}
        extractionId="ext-1"
        selectedAnnotationId={null}
        onSelectAnnotation={() => {}}
      />
    );
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe(created[0]);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:9877/extraction/ext-1/screenshot/shot-1"
    );
    unmount();
    expect(revoked).toEqual(created);
  });

  it("renders the needs-local message when the relay refuses the path", async () => {
    runnerTargetMock.current = REMOTE;
    relayRefusesPath();
    render(
      <PageThumbnailList
        annotations={[ANNOTATION]}
        extractionId="ext-1"
        selectedAnnotationId={null}
        onSelectAnnotation={() => {}}
      />
    );
    expect(
      await screen.findByText(/needs the runner on this machine/)
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("useExtractionScreenshotCache", () => {
  it("revokes every URL it created on unmount", async () => {
    runnerTargetMock.current = LOCAL;
    stubLoopbackImages();
    const { result, unmount } = renderHook(() =>
      useExtractionScreenshotCache("ext-1")
    );
    await act(async () => {
      await result.current.load("a");
      await result.current.load("b");
    });
    expect(result.current.urls.size).toBe(2);
    // A second load of a cached screenshot fetches nothing new.
    await act(async () => {
      await result.current.load("a");
    });
    expect(created).toHaveLength(2);
    unmount();
    expect([...revoked].sort()).toEqual([...created].sort());
  });

  it("revokes and clears when the runner changes", async () => {
    runnerTargetMock.current = LOCAL;
    stubLoopbackImages();
    const { result, rerender } = renderHook(() =>
      useExtractionScreenshotCache("ext-1")
    );
    await act(async () => {
      await result.current.load("a");
    });
    runnerTargetMock.current = {
      ...LOCAL,
      runner: { id: "runner-other", port: 9878, name: "Other" },
    };
    rerender();
    await waitFor(() => expect(result.current.urls.size).toBe(0));
    expect(revoked).toEqual(created);
  });

  it("records a relay-refused path with its RUNNER_NEEDS_LOCAL code", async () => {
    runnerTargetMock.current = REMOTE;
    relayRefusesPath();
    const { result } = renderHook(() => useExtractionScreenshotCache("ext-1"));
    await act(async () => {
      expect(await result.current.load("a")).toBeNull();
    });
    const error = result.current.errors.get("a");
    expect(error?.code).toBe(RUNNER_NEEDS_LOCAL);
    expect(error?.message).toMatch(/needs the runner on this machine/);
    expect(created).toHaveLength(0);
  });
});
