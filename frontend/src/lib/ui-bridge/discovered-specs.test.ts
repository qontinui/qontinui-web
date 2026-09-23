/**
 * The runtime spec cache is keyed by runner target: one runner's specs are
 * never served as another's, and the `spec.changed` EventSource is opened
 * only on a loopback route (the relay carries no SSE).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerTarget } from "@/lib/runner/target";
import { httpClient } from "@/services/service-factory";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));

const LOCAL: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-local", port: 9877, name: "Local" },
  locality: "local",
};

const REMOTE: RunnerTarget = {
  kind: "runner",
  runner: { id: "runner-remote", port: 9877, name: "Remote Box" },
  locality: "not_local",
};

function specList(ids: string[]): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      specs: ids.map((specId) => ({ specId })),
    }),
    { status: 200 }
  );
}

class FakeEventSource {
  static urls: string[] = [];
  onerror: (() => void) | null = null;
  constructor(url: string) {
    FakeEventSource.urls.push(url);
  }
  addEventListener() {}
  close() {}
}

async function freshModule() {
  vi.resetModules();
  return import("./discovered-specs");
}

describe("discovered-specs cache keyed by target", () => {
  beforeEach(() => {
    FakeEventSource.urls = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(httpClient.fetch).mockReset();
  });

  it("loads each target's specs over its own route and caches them apart", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(specList(["local-spec"]));
    vi.stubGlobal("fetch", fetchSpy);
    vi.mocked(httpClient.fetch).mockResolvedValue(specList(["remote-spec"]));

    const mod = await freshModule();
    const local = await mod.loadDiscoveredSpecs(LOCAL);
    const remote = await mod.loadDiscoveredSpecs(REMOTE);

    expect(local.map((s) => s.specId)).toEqual(["local-spec"]);
    expect(remote.map((s) => s.specId)).toEqual(["remote-spec"]);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://127.0.0.1:9877/apps/qontinui-web/spec/list"
    );
    expect(String(vi.mocked(httpClient.fetch).mock.calls[0][0])).toContain(
      "runner-proxy/apps/qontinui-web/spec/list"
    );
    expect(
      mod.__getSpecCacheSnapshot(LOCAL).specs?.map((s) => s.specId)
    ).toEqual(["local-spec"]);
    expect(
      mod.__getSpecCacheSnapshot(REMOTE).specs?.map((s) => s.specId)
    ).toEqual(["remote-spec"]);
  });

  it("opens the spec.changed stream only on a loopback route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(specList([])));
    vi.mocked(httpClient.fetch).mockResolvedValue(specList([]));

    const mod = await freshModule();
    await mod.loadDiscoveredSpecs(REMOTE);
    expect(FakeEventSource.urls).toEqual([]);
    expect(mod.__getSpecCacheSnapshot(REMOTE).stream).toBe("unavailable");

    await mod.loadDiscoveredSpecs(LOCAL);
    expect(FakeEventSource.urls).toEqual([
      "http://127.0.0.1:9877/apps/qontinui-web/spec/subscribe",
    ]);
    expect(mod.__getSpecCacheSnapshot(LOCAL).stream).toBe("live");
  });

  it("surfaces a relay refusal as the error, not an empty list", async () => {
    vi.mocked(httpClient.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "this path is not carried by the HTTP relay — GET /apps",
        }),
        { status: 403 }
      )
    );

    const mod = await freshModule();
    await expect(mod.loadDiscoveredSpecs(REMOTE)).rejects.toThrow(
      /needs the runner on this machine/
    );
    const snapshot = mod.__getSpecCacheSnapshot(REMOTE);
    expect(snapshot.specs).toBeNull();
    expect(snapshot.error?.message).toMatch(/needs the runner on this machine/);
  });

  it("does not load or cache for a target that is still resolving", async () => {
    const mod = await freshModule();
    const pending: RunnerTarget = { kind: "pending" };
    expect(mod.__shouldTriggerInitialLoad(pending)).toBe(false);
    expect(mod.__getSpecCacheSnapshot(pending)).toMatchObject({
      specs: null,
      loading: true,
    });
  });
});
