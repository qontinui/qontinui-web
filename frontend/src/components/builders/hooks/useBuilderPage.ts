"use client";

/**
 * Composable hook that wires up list/create/update/delete mutations
 * with local form state, producing props compatible with BuilderLayout.
 *
 * Includes debounced auto-save: after editing, changes are saved
 * automatically after 2 seconds of inactivity (only for existing items).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { BuilderItem } from "../BuilderLayout";

const AUTO_SAVE_DELAY = 2000;

interface UseBuilderPageOptions<T extends BuilderItem, TForm, TPayload = Record<string, unknown>> {
  items: T[] | undefined | null;
  isLoading: boolean;
  error: unknown;
  isOffline?: boolean;
  /** Convert an entity to its editable form state */
  toForm: (item: T) => TForm;
  /** Provide default form values for a new entity */
  defaultForm: () => TForm;
  /** Convert form state back to create/update payload */
  toPayload: (form: TForm) => TPayload;
  /** Mutation hooks */
  onCreate: (data: TPayload) => Promise<T>;
  onUpdate: (id: string, data: TPayload) => Promise<T>;
  onDelete: (id: string) => Promise<unknown>;
  refetch: () => Promise<unknown>;
  /** Disable auto-save (default: false) */
  disableAutoSave?: boolean;
}

export function useBuilderPage<T extends BuilderItem, TForm, TPayload = Record<string, unknown>>({
  items,
  isLoading,
  error,
  isOffline = false,
  toForm,
  defaultForm,
  toPayload,
  onCreate,
  onUpdate,
  onDelete,
  refetch,
  disableAutoSave = false,
}: UseBuilderPageOptions<T, TForm, TPayload>) {
  const searchParams = useSearchParams();
  const initialSelectedId = searchParams.get("id");

  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [form, setForm] = useState<TForm>(defaultForm());
  const [isDirty, setIsDirty] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const initialFormRef = useRef<string>("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNewRef = useRef(false);
  const selectedItemRef = useRef<T | null>(null);
  const formRef = useRef<TForm>(form);

  // Keep refs in sync
  isNewRef.current = isNew;
  selectedItemRef.current = selectedItem;
  formRef.current = form;

  // Track dirty state by comparing serialized form
  useEffect(() => {
    const currentStr = JSON.stringify(form);
    if (initialFormRef.current && currentStr !== initialFormRef.current) {
      setIsDirty(true);
    } else {
      setIsDirty(false);
    }
  }, [form]);

  // =========================================================================
  // Auto-save: debounce saves for existing (non-new) items
  // =========================================================================
  useEffect(() => {
    if (disableAutoSave || isNewRef.current || !isDirty || isSaving) return;
    const item = selectedItemRef.current;
    if (!item || item.id === "__new__") return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      // Re-check conditions at execution time
      if (isNewRef.current || !selectedItemRef.current) return;
      const currentStr = JSON.stringify(formRef.current);
      if (currentStr === initialFormRef.current) return;

      setIsSaving(true);
      try {
        const payload = toPayload(formRef.current);
        const updated = await onUpdate(selectedItemRef.current!.id, payload);
        setSelectedItem(updated);
        setIsDirty(false);
        initialFormRef.current = JSON.stringify(formRef.current);
        await refetch();
      } catch {
        // Auto-save failed silently — user can still manually save
      } finally {
        setIsSaving(false);
      }
    }, AUTO_SAVE_DELAY);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [isDirty, isSaving, disableAutoSave, toPayload, onUpdate, refetch]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const selectItem = useCallback(
    (item: T | null) => {
      // Cancel pending auto-save when switching items
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      if (item) {
        setSelectedItem(item);
        const f = toForm(item);
        setForm(f);
        initialFormRef.current = JSON.stringify(f);
        setIsNew(false);
        setIsDirty(false);
      } else {
        setSelectedItem(null);
        setIsNew(false);
        setIsDirty(false);
      }
    },
    [toForm]
  );

  const startNew = useCallback(() => {
    // Cancel pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const f = defaultForm();
    setForm(f);
    initialFormRef.current = JSON.stringify(f);
    setSelectedItem({ id: "__new__", name: "" } as T);
    setIsNew(true);
    setIsDirty(false);
  }, [defaultForm]);

  const save = useCallback(async () => {
    // Cancel pending auto-save since we're saving manually
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    setIsSaving(true);
    try {
      const payload = toPayload(form);
      if (isNew) {
        const created = await onCreate(payload);
        setSelectedItem(created);
        setIsNew(false);
      } else if (selectedItem) {
        const updated = await onUpdate(selectedItem.id, payload);
        setSelectedItem(updated);
      }
      setIsDirty(false);
      initialFormRef.current = JSON.stringify(form);
      await refetch();
    } finally {
      setIsSaving(false);
    }
  }, [form, isNew, selectedItem, toPayload, onCreate, onUpdate, refetch]);

  const deleteSelected = useCallback(async () => {
    if (!selectedItem || isNew) return;
    // Cancel pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await onDelete(selectedItem.id);
    setSelectedItem(null);
    setIsNew(false);
    await refetch();
  }, [selectedItem, isNew, onDelete, refetch]);

  const batchDelete = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map((id) => onDelete(id)));
      if (selectedItem && ids.includes(selectedItem.id)) {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSelectedItem(null);
      }
      await refetch();
    },
    [onDelete, selectedItem, refetch]
  );

  return {
    // BuilderLayout props
    items: (items as T[]) ?? null,
    isLoading,
    error: error ? String(error) : null,
    isOffline,
    selectedItem,
    onSelect: selectItem,
    onNew: startNew,
    onDelete: batchDelete,
    refetch: async () => { await refetch(); },
    initialSelectedId,

    // Editor state
    form,
    setForm,
    isDirty,
    isNew,
    isSaving,
    save,
    deleteSelected,
  };
}
