"use client";

import { useState } from "react";
import { Compass, Workflow } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { useLocalStorageCrud } from "@/hooks/useLocalStorageCrud";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";
import {
  toForm,
  defaultForm,
  toPayload,
  type SavedExplorationItem,
  type ExplorationForm,
} from "./types";
import { ExplorationListItem } from "./_components/ExplorationListItem";
import { ExplorationEditor } from "./_components/ExplorationEditor";

export default function StateExplorerPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  const storage = useLocalStorageCrud<SavedExplorationItem>(
    "qontinui-state-explorer-configs"
  );

  const items: SavedExplorationItem[] = storage.data || [];

  const builder = useBuilderPage<SavedExplorationItem, ExplorationForm>({
    items,
    isLoading: storage.isLoading,
    error: storage.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: async (data) => {
      const result = await storage.create(
        data as Omit<SavedExplorationItem, "id" | "created_at" | "updated_at">
      );
      return result;
    },
    onUpdate: async (id, data) => {
      const result = await storage.update(id, data as Partial<SavedExplorationItem>);
      return result;
    },
    onDelete: (id) => storage.delete(id),
    refetch: storage.refetch,
  });

  return (
    <>
    <BuilderLayout<SavedExplorationItem>
      title="State Explorer"
      icon={Compass}
      iconColor="text-emerald-400"
      accentColor="emerald"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      pageDescription="Test a state machine config against the live application. Traverses states and transitions using different strategies, verifying that expected UI elements are present at each state via image recognition."
      emptyIcon={Compass}
      emptyTitle="No exploration configs yet"
      emptyDescription="Create state exploration configurations"
      itemLabel="exploration config"
      searchPlaceholder="Search explorations..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <ExplorationListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={(item) => {
        const exploration = item as SavedExplorationItem;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-emerald-400"
            title="Insert into Workflow"
            onClick={(e) => {
              e.stopPropagation();
              setAddToWorkflowStep({
                type: "command",
                name: `Explore: ${exploration.name}`,
                command: `# State exploration: ${exploration.name}\n# Strategy: ${exploration.config.strategy}`,
                test_type: "custom_command" as const,
              });
            }}
          >
            <Workflow className="size-3.5" />
          </Button>
        );
      }}
      renderEditor={(item) => (
        <ExplorationEditor
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
    <AddToWorkflowDialog
      open={addToWorkflowStep !== null}
      onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
      stepData={addToWorkflowStep ?? {}}
    />
    </>
  );
}
