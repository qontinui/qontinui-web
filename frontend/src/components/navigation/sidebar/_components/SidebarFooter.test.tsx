/**
 * The sidebar footer's layout contract: row 1 is identity (the user menu),
 * row 2 is shell state (runner status beside the collapse toggle) — in the
 * rail too, where the same row stacks into a column of icons. It holds no
 * feature entry points: the Strategy mentions bell is gone.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarFooter } from "./SidebarFooter";

vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({
    activeRunner: { id: "r1", name: "Desk runner", port: 9876 },
    runners: [{ id: "r1", name: "Desk runner", port: 9876 }],
    selectRunner: vi.fn(),
    isMultiRunner: false,
  }),
}));

function renderFooter(isCollapsed: boolean) {
  return render(
    <TooltipProvider>
      <SidebarFooter
        isCollapsed={isCollapsed}
        user={{ username: "ada", email: "ada@example.com" }}
        onLogout={vi.fn()}
        onDocs={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    </TooltipProvider>
  );
}

describe("SidebarFooter", () => {
  it.each([false, true])(
    "renders the user menu, then one status row (collapsed=%s)",
    (isCollapsed) => {
      const { container } = renderFooter(isCollapsed);

      const toggle = container.querySelector("[data-sidebar-collapse-toggle]");
      const row = container.querySelector("[data-sidebar-footer-status-row]");
      expect(toggle).not.toBeNull();
      expect(row).not.toBeNull();
      // Runner status and the toggle share the one row container.
      expect(row).toContainElement(toggle as HTMLElement);
      expect(
        row?.querySelector("svg.lucide-monitor, .rounded-full")
      ).not.toBeNull();

      // The user menu sits above that row, outside it.
      const userMenu = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-haspopup") === "menu");
      expect(userMenu).toBeDefined();
      expect(row).not.toContainElement(userMenu as HTMLElement);
      expect(
        userMenu!.compareDocumentPosition(row as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      // No feature entry points: the mentions bell is not mounted.
      expect(
        container.querySelector('[data-testid="mention-notifications-trigger"]')
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /mention/i })).toBeNull();
    }
  );

  it("shows the runner's name in the expanded status row", () => {
    const { container } = renderFooter(false);
    const row = container.querySelector("[data-sidebar-footer-status-row]");
    expect(row).toHaveTextContent("Desk runner");
  });
});
