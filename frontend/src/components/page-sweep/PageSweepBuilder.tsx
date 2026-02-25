import { useEffect, useMemo, useRef } from "react";
import { Globe } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { useLocalStorageCrud } from "@/hooks/useLocalStorageCrud";
import {
  type PageSweepItem,
  type PageSweepForm,
  toForm,
  defaultForm,
  toPayload,
} from "@/lib/page-sweep-generator";
import { SweepListItem } from "./SweepListItem";
import { SweepEditor } from "./SweepEditor";

export function PageSweepBuilder() {
  const storage = useLocalStorageCrud<PageSweepItem>(
    "qontinui-page-sweep-configs"
  );

  const items = useMemo<PageSweepItem[]>(
    () => storage.data || [],
    [storage.data]
  );

  const builder = useBuilderPage<PageSweepItem, PageSweepForm>({
    items,
    isLoading: storage.isLoading,
    error: storage.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: async (data) => {
      return await storage.create(
        data as Omit<PageSweepItem, "id" | "created_at" | "updated_at">
      );
    },
    onUpdate: async (id, data) => {
      return await storage.update(id, data as Partial<PageSweepItem>);
    },
    onDelete: (id) => storage.delete(id),
    refetch: storage.refetch,
  });

  // Auto-show the editor panel so Connect, Discover, Generate controls
  // are always visible. Create new item if list is empty, or select the
  // first existing item if nothing is selected.
  const { selectedItem, onNew, onSelect } = builder;
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (storage.isLoading || selectedItem || autoTriggered.current) return;
    autoTriggered.current = true;
    const first = items[0];
    if (first) {
      onSelect(first);
    } else {
      onNew();
    }
  }, [storage.isLoading, items, selectedItem, onNew, onSelect]);

  return (
    <BuilderLayout<PageSweepItem>
      title="Page Sweep"
      icon={Globe}
      iconColor="text-cyan-400"
      accentColor="teal"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      pageDescription="Generate spec-driven verification workflows for every page in your application. Connect to an SDK app, Discover page specs, then Generate and run workflows for each page."
      emptyIcon={Globe}
      emptyTitle="No sweep configs yet"
      emptyDescription="Create a Page Sweep config to generate per-page workflows"
      itemLabel="sweep config"
      searchPlaceholder="Search sweep configs..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <SweepListItem item={item} isSelected={isSelected} />
      )}
      renderEditor={(item) => (
        <SweepEditor
          item={item}
          form={builder.form}
          setForm={builder.setForm}
          isDirty={builder.isDirty}
          isNew={builder.isNew}
          isSaving={builder.isSaving}
          onSave={builder.save}
          onDelete={builder.deleteSelected}
        />
      )}
    />
  );
}
