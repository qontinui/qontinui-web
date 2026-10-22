import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdleState } from "./EmptyStates";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  push.mockReset();
});

// The page's one placed image slot (frontend/image-slots/runs.active.idle.yaml).
// No asset is bound in the committed manifest, so it ships its placeholder,
// which keeps the page's idle motif inside the slot's reserved box.
describe("<IdleState> image slot", () => {
  it("places runs.active.idle as a marked placeholder the UI Bridge registers", () => {
    const { container } = render(<IdleState />);
    const slot = container.querySelector(
      '[data-ui-bridge-image-slot="runs.active.idle"]'
    ) as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.getAttribute("data-ui-bridge-id")).toBe(
      "image-slot.runs.active.idle"
    );
    expect(slot.getAttribute("data-ui-bridge-placeholder")).toBe("true");
    expect(slot.getAttribute("data-ui-bridge-placeholder-reason")).toBe(
      "no_asset"
    );
    expect(slot.className).toContain("w-20");
  });

  it("keeps the idle motif inside the slot's reserved 1/1 box", () => {
    const markup = renderToStaticMarkup(<IdleState />);
    expect(markup).toMatch(
      /<div [^>]*data-ui-bridge-image-slot="runs.active.idle"[^>]*style="aspect-ratio:1\/1"/
    );
    const { container } = render(<IdleState />);
    const slot = container.querySelector(
      '[data-ui-bridge-image-slot="runs.active.idle"]'
    ) as HTMLElement;
    // The caller's motif replaces the default dashed box and glyph.
    expect(slot.className).not.toContain("border-dashed");
    expect(slot.querySelector(".animate-pulse")).not.toBeNull();
  });
});

describe("<IdleState> ways on", () => {
  it("routes to run history and to the workflow builder", () => {
    render(<IdleState />);
    fireEvent.click(screen.getByRole("button", { name: /Run History/ }));
    fireEvent.click(screen.getByRole("button", { name: /Run Workflow/ }));
    expect(push.mock.calls).toEqual([["/runs"], ["/build/workflows"]]);
  });

  it("says the runner is not connected only when offline", () => {
    const { rerender } = render(<IdleState />);
    expect(screen.queryByText("Runner not connected")).toBeNull();
    rerender(<IdleState isOffline />);
    expect(screen.getByText("Runner not connected")).toBeInTheDocument();
  });
});
