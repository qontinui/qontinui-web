"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface LocalStorageItem {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

interface UseLocalStorageCrudReturn<T extends LocalStorageItem> {
  data: T[] | undefined;
  isLoading: boolean;
  error: null;
  create: (item: Omit<T, "id" | "created_at" | "updated_at">) => Promise<T>;
  update: (id: string, updates: Partial<T>) => Promise<T>;
  delete: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useLocalStorageCrud<T extends LocalStorageItem>(
  storageKey: string
): UseLocalStorageCrudReturn<T> {
  const [data, setData] = useState<T[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;

  const loadData = useCallback((): T[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(keyRef.current);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  const persistData = useCallback((items: T[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(items));
    } catch (e) {
      console.error(`Error saving to localStorage key "${keyRef.current}":`, e);
    }
  }, []);

  useEffect(() => {
    setData(loadData());
    setIsLoading(false);
  }, [loadData]);

  const create = useCallback(
    async (item: Omit<T, "id" | "created_at" | "updated_at">): Promise<T> => {
      const now = new Date().toISOString();
      const newItem = {
        ...item,
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      } as T;
      const current = loadData();
      const updated = [...current, newItem];
      persistData(updated);
      setData(updated);
      return newItem;
    },
    [loadData, persistData]
  );

  const update = useCallback(
    async (id: string, updates: Partial<T>): Promise<T> => {
      const current = loadData();
      const idx = current.findIndex((item) => item.id === id);
      if (idx === -1) throw new Error(`Item with id "${id}" not found`);
      const updatedItem = {
        ...current[idx],
        ...updates,
        id, // preserve id
        updated_at: new Date().toISOString(),
      } as T;
      const updated = [...current];
      updated[idx] = updatedItem;
      persistData(updated);
      setData(updated);
      return updatedItem;
    },
    [loadData, persistData]
  );

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      const current = loadData();
      const updated = current.filter((item) => item.id !== id);
      persistData(updated);
      setData(updated);
    },
    [loadData, persistData]
  );

  const refetch = useCallback(async () => {
    setData(loadData());
  }, [loadData]);

  return {
    data,
    isLoading,
    error: null,
    create,
    update,
    delete: deleteItem,
    refetch,
  };
}
