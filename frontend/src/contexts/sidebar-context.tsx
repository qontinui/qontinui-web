"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { STORAGE_KEYS } from "@qontinui/navigation";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Which of the three app-shell layouts the viewport is in.
 *
 * - `desktop` (>= 1024px, Tailwind `lg`): today's behaviour — the sidebar is
 *   full or rail according to the saved preference, and it pushes the content.
 * - `tablet` (768-1023px, Tailwind `md`): always the 64px icon rail. The full
 *   menu is an overlay drawer, so it never takes content width.
 * - `phone` (< 768px): no inline sidebar at all. A 44px top bar carries the
 *   menu button, and the full menu is the same overlay drawer.
 *
 * Width is read HERE and nowhere else: no component does its own
 * `matchMedia`, so all three layouts agree by construction.
 */
export type SidebarLayout = "phone" | "tablet" | "desktop";

/** Tailwind v4 defaults (`globals.css` overrides none). */
const MD = "(min-width: 768px)";
const LG = "(min-width: 1024px)";

interface SidebarContextType {
  /**
   * The collapse state the inline sidebar should render with. Forced `true`
   * below `lg`, because the only inline sidebar narrower screens get is the
   * rail. Read this to render; write `setIsCollapsed` to express a choice.
   */
  isCollapsed: boolean;
  /**
   * Record the operator's collapse choice. A no-op below `lg`: a narrow
   * screen forces the rail, and that must never be mistaken for a preference
   * and written over the desktop one.
   */
  setIsCollapsed: (collapsed: boolean) => void;
  /**
   * The persisted desktop preference itself, regardless of the current
   * width. The shell needs this (rather than `isCollapsed`) to pick its
   * `lg:` content offset, so the offset is a pure CSS breakpoint switch and
   * does not depend on JS having measured the window yet.
   */
  preferredCollapsed: boolean;
  layout: SidebarLayout;
  /** Whether the overlay drawer holding the full menu is open. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /**
   * The phone top bar's menu button, so the drawer can put focus back on it
   * when it closes.
   *
   * It lives here because the button and the drawer are rendered by different
   * components — the shell layout and `UnifiedSidebar` — and a ref through the
   * context is the only channel they share. Radix's own focus restore is not
   * enough: it returns focus to whatever was focused when the dialog opened,
   * and iOS Safari does not focus a `<button>` on tap, so on the very device
   * this drawer exists for that is the document body.
   */
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [preferredCollapsed, setPreferredCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const isDesktop = useMediaQuery(LG);
  const isTabletUp = useMediaQuery(MD);
  const layout: SidebarLayout = isDesktop
    ? "desktop"
    : isTabletUp
      ? "tablet"
      : "phone";

  // Load the saved preference from localStorage.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.collapsed);
      if (saved !== null) {
        setPreferredCollapsed(JSON.parse(saved));
      }
    } catch {
      // A quota-exceeded or disabled-storage browser keeps the default.
    }
  }, []);

  const setIsCollapsed = useCallback(
    (collapsed: boolean) => {
      // Below `lg` the rail is forced, so there is no choice to record.
      // Persisting one here is what would silently overwrite someone's
      // desktop preference when they turned a tablet or narrowed a window.
      if (!isDesktop) return;
      setPreferredCollapsed(collapsed);
      try {
        localStorage.setItem(STORAGE_KEYS.collapsed, JSON.stringify(collapsed));
      } catch {
        // Preference stays for this session only.
      }
    },
    [isDesktop]
  );

  // Crossing a breakpoint closes the drawer: the layout it was opened over no
  // longer exists, and on desktop there is no drawer at all. Compared against
  // the previous layout rather than run unconditionally so a re-render for any
  // other reason cannot close a drawer the operator just opened.
  const previousLayout = useRef(layout);
  useEffect(() => {
    if (previousLayout.current === layout) return;
    previousLayout.current = layout;
    setDrawerOpen(false);
  }, [layout]);

  const value = useMemo<SidebarContextType>(
    () => ({
      isCollapsed: isDesktop ? preferredCollapsed : true,
      setIsCollapsed,
      preferredCollapsed,
      layout,
      drawerOpen,
      setDrawerOpen,
      menuButtonRef,
    }),
    [isDesktop, preferredCollapsed, setIsCollapsed, layout, drawerOpen]
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
