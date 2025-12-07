import { useState, useEffect, useCallback } from "react";

/**
 * Custom hook for syncing state with localStorage
 * Handles serialization, deserialization, and SSR safety
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
  }
): [T, (value: T | ((val: T) => T)) => void] {
  // Default serialization functions
  const serialize = options?.serialize || JSON.stringify;
  const deserialize = options?.deserialize || JSON.parse;

  // Always use initial value first to avoid hydration mismatch
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(deserialize(item));
      }
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error);
    }
    setIsHydrated(true);
  }, [key, deserialize]);

  // Save to localStorage whenever value changes (but only after hydration)
  useEffect(() => {
    if (typeof window === "undefined" || !isHydrated) return;

    try {
      window.localStorage.setItem(key, serialize(storedValue));
    } catch (error) {
      console.error(`Error saving ${key} to localStorage:`, error);
      // Handle quota exceeded error
      if (error instanceof DOMException && error.code === 22) {
        console.warn(
          "localStorage quota exceeded. Consider cleaning up old data."
        );
      }
    }
  }, [key, storedValue, serialize, isHydrated]);

  // Wrapped setter function
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    setStoredValue(value);
  }, []);

  return [storedValue, setValue];
}

/**
 * Hook to sync with localStorage and handle cross-tab updates
 */
export function useLocalStorageSync<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  const [value, setValue] = useLocalStorage(key, initialValue);

  // Listen for changes in other tabs
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setValue(JSON.parse(e.newValue));
        } catch (error) {
          console.error("Error parsing storage event:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [key, setValue]);

  return [value, setValue];
}
