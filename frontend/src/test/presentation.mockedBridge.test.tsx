/**
 * The presentation helper in a test file that MOCKS the UI Bridge SDK — as a
 * dozen page tests here do. Check (b) cannot read a real registry there, so
 * the helper refuses to default it: it throws unless the caller says how
 * registrations are observed. A mocked bridge must never make (b) pass by
 * seeing nothing.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
  useUIComponent: () => ({}),
}));

import {
  findPresentationViolations,
  renderInPresentationMode,
  type UiBridgeRegistryView,
} from "./presentation";

describe("renderInPresentationMode with a mocked UI Bridge", () => {
  it("throws rather than letting check (b) see nothing", () => {
    expect(() => renderInPresentationMode(<p>page</p>)).toThrow(
      /@qontinui\/ui-bridge\/react is mocked/
    );
  });

  it("accepts an explicit statement that registrations are unobservable", () => {
    const view = renderInPresentationMode(<p>page</p>, {
      uiBridge: { unobservable: "this suite mocks the SDK" },
    });
    expect(view.uiBridge).toEqual({ unobservable: "this suite mocks the SDK" });
    expect(findPresentationViolations(view)).toEqual([]);
  });

  it("audits the registry view the caller's mock recorded", () => {
    const registry: UiBridgeRegistryView = {
      getAllComponents: () => [
        {
          id: "drain",
          mounted: true,
          actions: [{ id: "drain", effect: "write" }],
        },
        { id: "gone", mounted: false, actions: [{ id: "x", effect: "write" }] },
      ],
      getAllElements: () => [],
    };
    const view = renderInPresentationMode(<p>page</p>, {
      uiBridge: { registry },
    });
    expect(findPresentationViolations(view).map((v) => v.detail)).toEqual([
      'UI Bridge component "drain" action "drain" declares effect "write"',
    ]);
  });
});
