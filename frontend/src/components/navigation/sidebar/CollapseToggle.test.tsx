/**
 * The one control that both collapses the sidebar and opens the drawer.
 *
 * Contracts under test:
 *  - it says what it does HERE — below `lg` it opens a menu, and calling that
 *    "Expand sidebar" names an action that width has no equivalent of;
 *  - acting as a disclosure button it carries `aria-expanded`, and
 *    `aria-controls` only while the panel it names is actually in the
 *    document (a dangling reference is an invalid relationship, not a
 *    helpful one);
 *  - as a plain collapse toggle it carries neither.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CollapseToggle, type CollapseToggleProps } from "./CollapseToggle";

function renderToggle(props: Partial<CollapseToggleProps> = {}) {
  const onToggle = vi.fn();
  render(
    <TooltipProvider>
      <CollapseToggle isCollapsed={false} onToggle={onToggle} {...props} />
    </TooltipProvider>
  );
  return { onToggle };
}

describe("CollapseToggle", () => {
  it("is a plain collapse toggle by default", () => {
    renderToggle();
    const button = screen.getByRole("button", { name: "Collapse sidebar" });
    // Icon-only in the footer row: the name is carried by aria-label alone.
    expect(button).not.toHaveTextContent(/\S/);
    expect(button).not.toHaveAttribute("aria-expanded");
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("carries the caller's wording instead", () => {
    renderToggle({ label: "Close menu" });
    expect(
      screen.getByRole("button", { name: "Close menu" })
    ).toHaveAccessibleName("Close menu");
  });

  it("announces the drawer it controls while that drawer is open", () => {
    renderToggle({
      label: "Close menu",
      controlsDrawer: { open: true, id: "shell-sidebar-drawer" },
    });
    const button = screen.getByRole("button", { name: "Close menu" });
    // The drawer's only visible close control keeps its wording on screen —
    // a touch user never sees the hover tooltip.
    expect(button).toHaveTextContent("Close menu");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "shell-sidebar-drawer");
  });

  it("drops aria-controls when the drawer is not in the document", () => {
    renderToggle({
      isCollapsed: true,
      label: "Open menu",
      controlsDrawer: { open: false, id: "shell-sidebar-drawer" },
    });
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAccessibleName("Open menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    // The drawer is unmounted when closed, so naming its id here would point
    // at nothing.
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("fires the caller's handler", async () => {
    const { onToggle } = renderToggle();
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse sidebar" })
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
