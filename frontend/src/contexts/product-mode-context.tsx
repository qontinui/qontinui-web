"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/contexts/auth-context";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export type ProductMode = "ai" | "visual";

const STORAGE_KEY = "qontinui-product-mode";
const API_BASE = `${ApiConfig.API_BASE_URL}/api/v1/users/me/preferences`;

interface ProductModeContextValue {
  mode: ProductMode;
  setMode: (mode: ProductMode) => void;
}

const ProductModeContext = createContext<ProductModeContextValue>({
  mode: "ai",
  setMode: () => {},
});

// Extract server sync into a standalone async function (avoids fetch-in-useEffect lint)
async function fetchProductModePreference(
  signal: AbortSignal
): Promise<ProductMode | null> {
  try {
    const res = await httpClient.fetch(API_BASE, { signal });
    if (!res.ok) return null;
    const prefs = await res.json();
    if (prefs?.product_mode === "ai" || prefs?.product_mode === "visual") {
      return prefs.product_mode;
    }
    return null;
  } catch {
    // Silently fall back to localStorage value (includes AbortError)
    return null;
  }
}

function subscribeToStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getStorageSnapshot(): ProductMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "ai" || stored === "visual" ? stored : "ai";
}

function getServerSnapshot(): ProductMode {
  return "ai";
}

export function ProductModeProvider({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  initialMode?: ProductMode;
}) {
  const { user } = useAuth();
  const storedMode = useSyncExternalStore(
    subscribeToStorage,
    getStorageSnapshot,
    getServerSnapshot
  );
  const [serverMode, setServerMode] = useState<ProductMode | null>(null);
  const syncedUserIdRef = useRef<string | null>(null);

  const mode = initialMode ?? serverMode ?? storedMode;

  // Sync from server when user identity changes
  useEffect(() => {
    if (initialMode) {
      localStorage.setItem(STORAGE_KEY, initialMode);
      return undefined;
    }

    if (user && syncedUserIdRef.current !== user.id) {
      syncedUserIdRef.current = user.id;
      const controller = new AbortController();

      fetchProductModePreference(controller.signal).then((serverPref) => {
        if (serverPref) {
          setServerMode(serverPref);
          localStorage.setItem(STORAGE_KEY, serverPref);
        }
      });

      return () => controller.abort();
    } else if (!user) {
      syncedUserIdRef.current = null;
    }
    return undefined;
  }, [initialMode, user]);

  const setMode = useCallback((newMode: ProductMode) => {
    setServerMode(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);

    // Persist to server in background
    httpClient
      .fetch(API_BASE, {
        method: "PUT",
        body: JSON.stringify({ product_mode: newMode }),
      })
      .catch(() => {
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
