import { create } from "zustand";
import { persist } from "zustand/middleware";
import { runnerApi } from "@/lib/runner-api";

export type MenuMode = "simple" | "advanced";

interface MenuModeState {
  menuMode: MenuMode;
  _lastSyncAt: number | null;
  setMenuMode: (mode: MenuMode) => void;
  toggleMenuMode: () => void;
  syncFromRunner: () => Promise<void>;
}

export const useMenuModeStore = create<MenuModeState>()(
  persist(
    (set, get) => ({
      menuMode: "simple",
      _lastSyncAt: null,
      setMenuMode: (mode: MenuMode) => {
        set({ menuMode: mode });
        // Push to runner so it stays in sync
        runnerApi.setAppMode(mode).catch(() => {});
      },
      toggleMenuMode: () => {
        const newMode: MenuMode =
          get().menuMode === "simple" ? "advanced" : "simple";
        set({ menuMode: newMode });
        runnerApi.setAppMode(newMode).catch(() => {});
      },
      syncFromRunner: async () => {
        const state = get();
        if (state._lastSyncAt && Date.now() - state._lastSyncAt < 5000) return;
        set({ _lastSyncAt: Date.now() });
        try {
          const result = await runnerApi.getAppMode();
          const mode = result.mode as MenuMode;
          if (mode === "simple" || mode === "advanced") {
            set({ menuMode: mode });
          }
        } catch {
          // Runner offline — keep localStorage value
        }
      },
    }),
    {
      name: "qontinui-menu-mode",
      partialize: (state) => ({ menuMode: state.menuMode }),
    },
  ),
);
