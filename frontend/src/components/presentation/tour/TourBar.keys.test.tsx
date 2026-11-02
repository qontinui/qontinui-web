/**
 * The tour bar's arrow keys (plan `2026-10-23-console-presentation-spaces`
 * D5): ArrowLeft and ArrowRight follow the previous and next links on
 * screen — and leave every press the page is using alone — through a window
 * listener that exists only while the bar renders.
 *
 * Following a link is observed at `HTMLAnchorElement.click`, stubbed: the
 * test sees exactly which anchor a key followed, and nothing navigates.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const readiness = vi.hoisted(() => ({
  routes: [] as PresentationReadyRoute[],
}));
vi.mock(
  "@/components/presentation/presentationReadiness",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/components/presentation/presentationReadiness")
      >();
    return {
      ...real,
      isPresentationReady: (pathname: string) =>
        real.isPresentationReady(pathname, readiness.routes),
    };
  }
);

import {
  FixedPresentationMode,
  TourBar,
} from "@/components/presentation";
import { TODAY, onTourStore, renderBar, visit } from "@/test/tourBar";

let click: MockInstance<HTMLAnchorElement["click"]>;

beforeEach(() => {
  readiness.routes = TODAY;
  window.sessionStorage.clear();
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  visit("/admin/coord/ui-bridge?present=1&tour=1");
});
afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

/** The hrefs of the anchors the keys followed, in order. */
const followed = () =>
  click.mock.contexts.map((a) => (a as HTMLAnchorElement).getAttribute("href"));

/** Dispatch a keydown from `target`, returning the event. */
function key(
  target: Element,
  init: KeyboardEventInit & { key: string }
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("the arrow keys follow the links on screen", () => {
  it("ArrowRight follows next and ArrowLeft previous, taking the key", () => {
    renderBar(true);
    const right = key(document.body, { key: "ArrowRight" });
    expect(followed()).toEqual(["/admin/coord/devops?present=1&tour=1"]);
    expect(right.defaultPrevented).toBe(true);
    expect(click.mock.contexts[0]).toBe(screen.getByTestId("tour-bar-next"));

    const left = key(document.body, { key: "ArrowLeft" });
    expect(followed()).toEqual([
      "/admin/coord/devops?present=1&tour=1",
      "/digital-twin?present=1&tour=1",
    ]);
    expect(left.defaultPrevented).toBe(true);
  });

  it("a key with nowhere to go does nothing, and keeps its default", () => {
    visit("/digital-twin?present=1&tour=1");
    renderBar(true);
    const left = key(document.body, { key: "ArrowLeft" });
    expect(followed()).toEqual([]);
    expect(left.defaultPrevented).toBe(false);
  });

  it("leaves a press something on the page already handled", () => {
    renderBar(true);
    const handled = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", handled);
    try {
      key(document.body, { key: "ArrowRight" });
    } finally {
      document.removeEventListener("keydown", handled);
    }
    expect(followed()).toEqual([]);
  });

  it.each([
    ["Alt", { altKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Shift", { shiftKey: true }],
  ])("leaves a press with %s held", (_name, modifier) => {
    renderBar(true);
    key(document.body, { key: "ArrowRight", ...modifier });
    expect(followed()).toEqual([]);
  });

  it("leaves a held key's repeats", () => {
    renderBar(true);
    key(document.body, { key: "ArrowRight", repeat: true });
    expect(followed()).toEqual([]);
  });

  it.each([
    ['<input type="text" />', "a text field"],
    ['<div role="tablist"><button role="tab" type="button">Twin map</button></div>', "a tab"],
    ['<div role="slider" tabindex="0"></div>', "a slider"],
    ['<div contenteditable="true"></div>', "editable content"],
  ])("leaves the keys to %s (%s) that has focus", (html) => {
    renderBar(true);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      const focused = host.querySelector("input, [role=tab], [role=slider], [contenteditable]")!;
      key(focused, { key: "ArrowRight" });
      key(focused, { key: "ArrowLeft" });
    } finally {
      host.remove();
    }
    expect(followed()).toEqual([]);
  });

  it("follows the new link after the page changes under the same bar", () => {
    const store = onTourStore();
    const { rerender } = render(
      <FixedPresentationMode presenting>
        <TourBar store={store} />
      </FixedPresentationMode>
    );
    visit("/admin/coord/devops?present=1&tour=1");
    rerender(
      <FixedPresentationMode presenting>
        <TourBar store={store} />
      </FixedPresentationMode>
    );
    key(document.body, { key: "ArrowRight" });
    expect(followed()).toEqual(["/admin/coord/tour?present=1&tour=1"]);
  });
});

describe("the key listener exists only while the bar renders", () => {
  const keydownListeners = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([type]) => type === "keydown").map(([, fn]) => fn);

  it("is never added in operator mode", () => {
    const add = vi.spyOn(window, "addEventListener");
    renderBar(false, onTourStore());
    expect(keydownListeners(add)).toEqual([]);
  });

  it("is never added for a tab that is not on the tour", () => {
    visit("/admin/coord/ui-bridge?present=1");
    const add = vi.spyOn(window, "addEventListener");
    renderBar(true);
    expect(keydownListeners(add)).toEqual([]);
  });

  it("is added once, and removed when the bar unmounts", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderBar(true);
    const added = keydownListeners(add);
    expect(added).toHaveLength(1);
    unmount();
    expect(keydownListeners(remove)).toEqual(added);
    key(document.body, { key: "ArrowRight" });
    expect(followed()).toEqual([]);
  });

  it("is removed when End tour hides the bar", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    renderBar(true);
    const added = keydownListeners(add);
    fireEvent.click(screen.getByRole("button", { name: "End tour" }));
    expect(screen.queryByTestId("tour-bar")).toBeNull();
    expect(keydownListeners(remove)).toEqual(added);
    key(document.body, { key: "ArrowRight" });
    expect(followed()).toEqual([]);
  });
});
