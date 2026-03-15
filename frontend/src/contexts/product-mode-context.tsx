"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";

export type ProductMode = "ai" | "visual";

const STORAGE_KEY = "qontinui-product-mode";
const API_BASE = "/api/v1/users/me/preferences";

interface ProductModeContextValue {
  mode: ProductMode;
  setMode: (mode: ProductMode) => void;
}

const ProductModeContext = createContext<ProductModeContextValue>({
  mode: "ai",
  setMode: () => {},
});

export function ProductModeProvider({ children, initialMode }: { children: React.ReactNode; initialMode?: ProductMode }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState<ProductMode>(initialMode ?? "ai");
  const syncedUserIdRef = useRef<string | null>(null);

  // Initialize from localStorage, then sync from server if logged in
  useEffect(() => {
    if (initialMode) {
      setModeState(initialMode);
      localStorage.setItem(STORAGE_KEY, initialMode);
      return;
    }

    // Read localStorage first for instant UI
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ai" || stored === "visual") {
      setModeState(stored);
    }

    // If logged in, sync from server (server is authoritative)
    // Re-sync when user identity changes (login/logout/switch)
    if (user && syncedUserIdRef.current !== user.id) {
      syncedUserIdRef.current = user.id;
      fetch(API_BASE, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((prefs) => {
          if (prefs?.product_mode === "ai" || prefs?.product_mode === "visual") {
            setModeState(prefs.product_mode);
            localStorage.setItem(STORAGE_KEY, prefs.product_mode);
          }
        })
        .catch(() => {
          // Silently fall back to localStorage value
        });
    } else if (!user) {
      syncedUserIdRef.current = null;
    }
  }, [initialMode, user]);

  const setMode = useCallback((newMode: ProductMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);

    // Persist to server in background
    fetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ product_mode: newMode }),
    }).catch(() => {
      // Silently ignore — localStorage is the fallback
    });
  }, []);

  return (
    <ProductModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ProductModeContext.Provider>
  );
}

export function useProductMode() {
  return useContext(ProductModeContext);
}

export function getStoredProductMode(): ProductMode {
  if (typeof window === "undefined") return "ai";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "visual" ? "visual" : "ai";
}
