/**
 * The app shell's width-aware sidebar state.
 *
 * Contracts under test:
 *  - each width band picks the layout the shell renders from;
 *  - below `lg` the inline sidebar is the rail, whatever is saved;
 *  - a preference set on desktop SURVIVES a visit to phone width — a narrow
 *    screen forcing the rail must never be written back as a choice;
 *  - crossing a breakpoint closes the drawer.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@qontinui/navigation";
import { installMatchMedia, type MatchMediaStub } from "@/test/match-media";
import { SidebarProvider, useSidebar } from "./sidebar-context";

let media: MatchMediaStub | null = null;

function wrapper({ children }: { children: React.ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

function renderSidebar(width: number) {
  media = installMatchMedia(width);
  return renderHook(() => useSidebar(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  media?.restore();
  media = null;
  localStorage.clear();
});

describe("SidebarProvider — layout bands", () => {
  it.each([
    [390, "phone"],
    [767, "phone"],
    [768, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1440, "desktop"],
  ])("reports %ipx as %s", (width, layout) => {
    const { result } = renderSidebar(width);
    expect(result.current.layout).toBe(layout);
  });

  it("forces the rail below lg even with an expanded preference saved", () => {
    localStorage.setItem(STORAGE_KEYS.collapsed, "false");

    const { result } = renderSidebar(820);
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.preferredCollapsed).toBe(false);
  });

  it("honours the saved preference on desktop", () => {
    localStorage.setItem(STORAGE_KEYS.collapsed, "true");

    const { result } = renderSidebar(1440);
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.preferredCollapsed).toBe(true);
  });

  it("switches band when the window is resized", () => {
    const { result } = renderSidebar(1440);
    expect(result.current.layout).toBe("desktop");

    act(() => media!.setWidth(820));
    expect(result.current.layout).toBe("tablet");

    act(() => media!.setWidth(390));
    expect(result.current.layout).toBe("phone");
  });
});

describe("SidebarProvider — the desktop preference is never clobbered", () => {
  it("survives a visit to phone width", () => {
    const { result } = renderSidebar(1440);

    act(() => result.current.setIsCollapsed(false));
    expect(result.current.preferredCollapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.collapsed)).toBe("false");

    // Narrow: the rail is forced, and something narrow-layout could easily
    // push that back through `setIsCollapsed`.
    act(() => media!.setWidth(390));
    expect(result.current.isCollapsed).toBe(true);
    act(() => result.current.setIsCollapsed(true));

    expect(result.current.preferredCollapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.collapsed)).toBe("false");

    // Back on desktop the original choice is still what renders.
    act(() => media!.setWidth(1440));
    expect(result.current.isCollapsed).toBe(false);
  });

  it("persists a desktop collapse", () => {
    const { result } = renderSidebar(1440);

    act(() => result.current.setIsCollapsed(true));
    expect(localStorage.getItem(STORAGE_KEYS.collapsed)).toBe("true");
    expect(result.current.isCollapsed).toBe(true);
  });
});

describe("SidebarProvider — drawer", () => {
  it("closes when the layout changes", () => {
    const { result } = renderSidebar(390);

    act(() => result.current.setDrawerOpen(true));
    expect(result.current.drawerOpen).toBe(true);

    act(() => media!.setWidth(1440));
    expect(result.current.layout).toBe("desktop");
    expect(result.current.drawerOpen).toBe(false);
  });

  it("stays open across a resize inside the same band", () => {
    const { result } = renderSidebar(390);

    act(() => result.current.setDrawerOpen(true));
    act(() => media!.setWidth(600));

    expect(result.current.layout).toBe("phone");
    expect(result.current.drawerOpen).toBe(true);
  });

  it("starts closed", () => {
    const { result } = renderSidebar(390);
    expect(result.current.drawerOpen).toBe(false);
  });
});
