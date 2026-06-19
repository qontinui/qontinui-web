/**
 * Regression tests for the UI Bridge `navigateHandler` registration race
 * (co-pilot remediation 2026-06-12, item 7).
 *
 * The SDK's soft-nav path prefers a host-provided `navigateHandler` over raw
 * `history.pushState` — pushState updates the URL bar but the Next.js App
 * Router never re-renders, so `useSearchParams()` goes stale (observed live:
 * soft nav to `/prompt-home?bridgeDebug=1` never activated bridgeDebug). The
 * provider used to register the handler only `if (window.__UI_BRIDGE__)`
 * already existed — a silent no-op with no retry when the provider mounted
 * before SDK init. Since the SDK merges into an existing global rather than
 * clobbering it (0.13.0: `w.__UI_BRIDGE__ ?? (w.__UI_BRIDGE__ = {})`), the
 * provider must create the global itself so the handler is ALWAYS installed
 * regardless of mount order.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/prompt-home",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useRouter: () => ({ push: pushMock }),
}));

// The real hook needs the SDK's navigation tracker; it's irrelevant to the
// handler-registration contract under test.
vi.mock("@qontinui/ui-bridge/react", () => ({
  useRouteAwareness: () => {},
}));

import { RouteAwarenessProvider } from "./RouteAwarenessProvider";

type BridgeGlobal = Record<string, unknown> & {
  navigateHandler?: (url: string) => void;
};

const w = window as unknown as { __UI_BRIDGE__?: BridgeGlobal };

beforeEach(() => {
  pushMock.mockReset();
  delete w.__UI_BRIDGE__;
});

afterEach(() => {
  cleanup();
  delete w.__UI_BRIDGE__;
});

describe("RouteAwarenessProvider navigateHandler registration", () => {
  it("installs navigateHandler even when mounted BEFORE the bridge global exists", () => {
    expect(w.__UI_BRIDGE__).toBeUndefined();

    render(
      <RouteAwarenessProvider>
        <div />
      </RouteAwarenessProvider>
    );

    expect(w.__UI_BRIDGE__).toBeDefined();
    expect(typeof w.__UI_BRIDGE__?.navigateHandler).toBe("function");

    // Soft nav with a changed query param goes through router.push, which
    // re-renders the App Router (raw pushState would not).
    w.__UI_BRIDGE__?.navigateHandler?.("/prompt-home?bridgeDebug=1");
    expect(pushMock).toHaveBeenCalledWith("/prompt-home?bridgeDebug=1");
  });

  it("merges into an existing bridge global without clobbering its fields", () => {
    w.__UI_BRIDGE__ = { someSdkField: "keep-me" };

    render(
      <RouteAwarenessProvider>
        <div />
      </RouteAwarenessProvider>
    );

    expect(w.__UI_BRIDGE__?.someSdkField).toBe("keep-me");
    expect(typeof w.__UI_BRIDGE__?.navigateHandler).toBe("function");
  });

  it("removes only the handler on unmount, leaving the global for the SDK", () => {
    const { unmount } = render(
      <RouteAwarenessProvider>
        <div />
      </RouteAwarenessProvider>
    );
    expect(typeof w.__UI_BRIDGE__?.navigateHandler).toBe("function");

    unmount();

    expect(w.__UI_BRIDGE__).toBeDefined();
    expect(w.__UI_BRIDGE__?.navigateHandler).toBeUndefined();
  });
});
