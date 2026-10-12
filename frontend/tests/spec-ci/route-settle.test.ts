import { describe, expect, it } from "vitest";
import { currentPath, settleRoute } from "./route-settle";

/**
 * settleRoute decides whether a post-deploy smoke rolls prod back, so it is
 * tested in BOTH directions: a slow render must pass (the false-rollback class
 * it exists for), and a bounce or a landmark that never renders must still
 * fail.
 */

const FAST = { timeoutMs: 200, pollMs: 10 };

function fakePage(urls: () => string) {
  return { url: urls };
}

describe("settleRoute", () => {
  it("passes a landmark that appears only after several polls", async () => {
    let probes = 0;
    const page = fakePage(() => "https://qontinui.io/runs/active");
    const outcome = await settleRoute(page, async () => ++probes >= 4, FAST);
    expect(outcome).toEqual({ kind: "ok" });
    expect(probes).toBe(4);
  });

  it("reports a late client-side bounce as a bounce, not a missing landmark", async () => {
    let calls = 0;
    const page = fakePage(() =>
      ++calls >= 3
        ? "https://qontinui.io/login?next=%2Fsessions"
        : "https://qontinui.io/sessions"
    );
    const outcome = await settleRoute(page, async () => false, FAST);
    expect(outcome).toEqual({ kind: "bounce", landedPath: "/login" });
  });

  it("checks the bounce before the landmark", async () => {
    const page = fakePage(() => "https://qontinui.io/login");
    const outcome = await settleRoute(page, async () => true, FAST);
    expect(outcome.kind).toBe("bounce");
  });

  it("fails a landmark that never renders, once the deadline passes", async () => {
    const page = fakePage(() => "https://qontinui.io/sessions");
    const started = Date.now();
    const outcome = await settleRoute(page, async () => false, FAST);
    expect(outcome).toEqual({ kind: "missing" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(FAST.timeoutMs);
  });

  it("treats a throwing landmark probe as not-yet-visible", async () => {
    const page = fakePage(() => "https://qontinui.io/sessions");
    const outcome = await settleRoute(
      page,
      async () => {
        throw new Error("detached frame");
      },
      FAST
    );
    expect(outcome).toEqual({ kind: "missing" });
  });
});

describe("currentPath", () => {
  it("returns the pathname of an absolute URL", () => {
    expect(currentPath(fakePage(() => "https://x.io/a/b?c=1"))).toBe("/a/b");
  });

  it("falls back to the raw value for an unparseable URL", () => {
    expect(currentPath(fakePage(() => "not a url"))).toBe("not a url");
  });
});
