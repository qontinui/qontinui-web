/**
 * `CollapsiblePanel` — a close request while `forceOpen` is true is ignored
 * and never persisted.
 *
 * The render ORs `forceOpen` into `open`, so a close click during a forced
 * open changed nothing visible — but it used to write "0" to `storageKey`,
 * silently collapsing the panel on the operator's next visit.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsiblePanel } from "./CollapsiblePanel";

const KEY = "collapsible-panel-test";

function panel(forceOpen: boolean) {
  return (
    <CollapsiblePanel
      title="Retired"
      storageKey={KEY}
      defaultOpen={false}
      forceOpen={forceOpen}
      data-testid="panel"
    >
      <p data-testid="panel-body">body</p>
    </CollapsiblePanel>
  );
}

const trigger = () => screen.getByRole("button", { name: /Retired/ });

beforeEach(() => {
  window.localStorage.clear();
});

describe("CollapsiblePanel forceOpen", () => {
  it("ignores a close request while forced open, and persists nothing", () => {
    const { rerender } = render(panel(true));
    expect(screen.getByTestId("panel-body")).toBeInTheDocument();

    fireEvent.click(trigger());

    expect(screen.getByTestId("panel-body")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();

    // The caller lets go: the latched open survives, because the ignored
    // close never reached state either.
    rerender(panel(false));
    expect(screen.getByTestId("panel-body")).toBeInTheDocument();
  });

  it("closes and persists normally once no longer forced", () => {
    const { rerender } = render(panel(true));
    rerender(panel(false));

    fireEvent.click(trigger());

    expect(screen.queryByTestId("panel-body")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("0");
  });

  it('does not overwrite a stored "closed" merely by being forced open', () => {
    window.localStorage.setItem(KEY, "0");
    render(panel(true));
    expect(screen.getByTestId("panel-body")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("0");
  });
});
