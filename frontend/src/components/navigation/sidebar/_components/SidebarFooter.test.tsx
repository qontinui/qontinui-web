/**
 * The sidebar footer's layout contract: row 1 is identity (the user menu),
 * row 2 is shell state (runner status beside the collapse toggle) — in the
 * rail too, where the same row stacks into a column of icons. It holds no
 * feature entry points: the Strategy mentions bell is gone.
 *
 * Three render modes reach this component, and all three are covered here:
 * the desktop expanded footer, the collapsed rail, and the below-`lg` overlay
 * drawer. The drawer is the one where `CollapseToggle` renders a visible text
 * button rather than an icon, and it is the only composition where that button
 * competes with the runner name for the row's width.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarFooter } from "./SidebarFooter";

const STATUS_ROW = '[data-ui-bridge-id="shell.sidebar-footer-status"]';
const TOGGLE = '[data-ui-bridge-id="shell.sidebar-collapse-toggle"]';

/**
 * Hoisted so the `vi.mock` factory below can close over it — the multi-runner
 * case needs to flip `isMultiRunner` per test, and the factory is evaluated
 * before an ordinary module-scope const exists.
 */
const runner = vi.hoisted(() => ({
  isMultiRunner: false,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({
    activeRunner: { id: "r1", name: "Desk runner", port: 9876 },
    runners: runner.isMultiRunner
      ? [
          { id: "r1", name: "Desk runner", port: 9876 },
          { id: "r2", name: "Laptop runner", port: 9877 },
        ]
      : [{ id: "r1", name: "Desk runner", port: 9876 }],
    selectRunner: vi.fn(),
    pin: null,
    isMultiRunner: runner.isMultiRunner,
    listState: "loaded",
    localityById: new Map([["r1", "local"]]),
    selection: "auto",
    resolution: {
      status: "resolved",
      deviceId: "r1",
      via: "pool",
      pinReleased: null,
    },
  }),
}));

type FooterOverrides = {
  toggleLabel?: string;
  toggleControlsDrawer?: { open: boolean; id: string };
};

function renderFooter(isCollapsed: boolean, overrides: FooterOverrides = {}) {
  return render(
    <TooltipProvider>
      <SidebarFooter
        isCollapsed={isCollapsed}
        user={{ username: "ada", email: "ada@example.com" }}
        onLogout={vi.fn()}
        onDocs={vi.fn()}
        onToggleCollapse={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>
  );
}

describe("SidebarFooter", () => {
  it.each([false, true])(
    "renders the user menu, then one status row (collapsed=%s)",
    (isCollapsed) => {
      const { container } = renderFooter(isCollapsed);

      const toggle = container.querySelector(TOGGLE);
      const row = container.querySelector(STATUS_ROW);
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
    const row = container.querySelector(STATUS_ROW);
    expect(row).toHaveTextContent("Desk runner");
  });

  it("keeps the focus-restore anchor on the toggle in every mode", () => {
    // `UnifiedSidebar.getRestoreFocusTarget` resolves the tablet rail's focus
    // target through this attribute, so it is not interchangeable with the
    // UI-Bridge id even though both sit on the same button.
    for (const collapsed of [false, true]) {
      const { container, unmount } = renderFooter(collapsed);
      expect(container.querySelector("[data-sidebar-collapse-toggle]")).toBe(
        container.querySelector(TOGGLE)
      );
      unmount();
    }
  });

  describe("as the overlay drawer's footer", () => {
    // Below `lg` the sidebar body is rendered expanded inside the drawer, and
    // the collapse toggle becomes that drawer's disclosure button — the only
    // visible way to close the menu, which is why it keeps its wording.
    const asDrawer = {
      toggleLabel: "Close menu",
      toggleControlsDrawer: { open: true, id: "shell-sidebar-drawer" },
    };

    it("puts a labelled close control in the status row", () => {
      const { container } = renderFooter(false, asDrawer);

      const row = container.querySelector(STATUS_ROW);
      const toggle = container.querySelector(TOGGLE);
      expect(row).toContainElement(toggle as HTMLElement);
      // Visible text, not just an accessible name: a touch user never sees the
      // hover tooltip the desktop icon button relies on.
      expect(toggle).toHaveTextContent("Close menu");
      // The runner status still shares the row rather than being displaced.
      expect(row).toHaveTextContent("Desk runner");
    });

    it("announces the drawer it controls", () => {
      const { container } = renderFooter(false, asDrawer);

      const toggle = container.querySelector(TOGGLE);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", "shell-sidebar-drawer");
    });
  });

  it("with several runners the row stays a status line — no runner control beside the toggle", () => {
    runner.isMultiRunner = true;
    try {
      const { container } = renderFooter(false);

      const row = container.querySelector(STATUS_ROW);
      const toggle = container.querySelector(TOGGLE);
      expect(row).toHaveTextContent("Runner: Desk runner");
      // The toggle is the row's only button: the runner picker moved to the
      // execution surfaces ("Run on:").
      expect(row?.querySelectorAll("button")).toHaveLength(1);
      expect(row?.querySelector("button")).toBe(toggle);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    } finally {
      runner.isMultiRunner = false;
    }
  });
});
