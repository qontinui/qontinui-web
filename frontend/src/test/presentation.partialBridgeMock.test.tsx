/**
 * The presentation helper in a test file that PARTIALLY mocks the UI Bridge
 * SDK — the real provider kept, the registration hooks stubbed — the pattern
 * `lib/ui-bridge/RouteAwarenessProvider.test.tsx` uses. The provider's
 * registry is then real but empty, so check (b) would pass having seen
 * nothing; the helper's sentinel registrations, which never arrive, make it
 * throw instead.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@qontinui/ui-bridge/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@qontinui/ui-bridge/react")>()),
  useUIComponent: () => ({}),
  useUIElement: () => ({ ref: () => undefined }),
}));

import { renderInPresentationMode } from "./presentation";

describe("renderInPresentationMode with a partially mocked UI Bridge", () => {
  it("throws rather than letting check (b) read an empty registry", () => {
    expect(() => renderInPresentationMode(<p>page</p>)).toThrow(
      /sentinel registrations/
    );
  });

  it("still accepts an explicit statement of what was observed", () => {
    expect(() =>
      renderInPresentationMode(<p>page</p>, {
        uiBridge: { unobservable: "this suite stubs the registration hooks" },
      })
    ).not.toThrow();
  });
});
