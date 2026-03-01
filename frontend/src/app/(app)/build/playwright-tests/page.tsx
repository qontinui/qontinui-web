"use client";

import { useState, useCallback } from "react";
import { FileCode, Workflow } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import {
  usePlaywrightTestsList,
  useCreatePlaywrightTest,
  useUpdatePlaywrightTest,
  useDeletePlaywrightTest,
  useDuplicatePlaywrightTest,
} from "@/components/builders/hooks/useRunnerEntity";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import { PromptSnippetManager } from "@/components/builders/PromptSnippetManager";
import type { UnifiedStep } from "@/types/unified-workflow";
import type { PlaywrightScript } from "@/lib/runner/types/library";
import { toForm, defaultForm, toPayload, clearDraft } from "./script-utils";
import type { ScriptForm } from "./script-utils";
import { ScriptListItem } from "./_components/ScriptListItem";
import { ScriptEditor } from "./_components/ScriptEditor";

export default function PlaywrightTestsPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false);
  const listQuery = usePlaywrightTestsList();
  const createMutation = useCreatePlaywrightTest();
  const updateMutation = useUpdatePlaywrightTest();
  const deleteMutation = useDeletePlaywrightTest();
  const duplicateMutation = useDuplicatePlaywrightTest();

  const isOffline =
    !listQuery.isLoading && listQuery.data === undefined && listQuery.error != null;

  const builderState = useBuilderPage<PlaywrightScript, ScriptForm>({
    items: listQuery.data,
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    isOffline,
    toForm,
    defaultForm,
    toPayload,
    onCreate: (data) => createMutation.mutateAsync(data as Partial<PlaywrightScript>),
    onUpdate: (id, data) =>
      updateMutation.mutateAsync({ id, data: data as Partial<PlaywrightScript> }),
    onDelete: (id) => deleteMutation.mutateAsync(id),
    refetch: () => listQuery.refetch(),
  });

  const handleDuplicate = async () => {
    if (!builderState.selectedItem || builderState.isNew) return;
    const newName = `${builderState.selectedItem.name} (Copy)`;
    await duplicateMutation.mutateAsync({
      id: builderState.selectedItem.id,
      newName,
    });
    await builderState.refetch();
  };

  const renderListActions = useCallback(
    (item: PlaywrightScript) => (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
        title="Insert into Workflow"
        onClick={() => {
          setAddToWorkflowStep({
            type: "command",
            name: item.name,
            test_type: "playwright",
            script_id: item.id,
            target_url: item.target_url,
          });
        }}
      >
        <Workflow className="size-3.5" />
      </Button>
    ),
    []
  );

  return (
    <>
    <BuilderLayout
      title="Playwright Tests"
      icon={FileCode}
      iconColor="text-blue-400"
      accentColor="blue"
      items={builderState.items}
      isLoading={builderState.isLoading}
      error={builderState.error}
      isOffline={builderState.isOffline}
      selectedItem={builderState.selectedItem}
      onSelect={builderState.onSelect}
      onNew={builderState.onNew}
      onDelete={builderState.onDelete}
      refetch={builderState.refetch}
      renderListItem={(item, isSelected) => (
        <ScriptListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={renderListActions}
      renderEditor={(item) => (
        <ScriptEditor
          item={item}
          form={builderState.form}
          setForm={builderState.setForm}
          isDirty={builderState.isDirty}
          isNew={builderState.isNew}
          isSaving={builderState.isSaving}
          onSave={() => {
            builderState.save();
            clearDraft(item.id);
          }}
          onDelete={builderState.deleteSelected}
          onDuplicate={handleDuplicate}
          onOpenSnippetManager={() => setSnippetManagerOpen(true)}
        />
      )}
      emptyIcon={FileCode}
      emptyTitle="No playwright tests yet"
      emptyDescription="Create a Playwright test to get started"
      itemLabel="playwright test"
      searchPlaceholder="Search playwright tests..."
      initialSelectedId={builderState.initialSelectedId}
    />

    <AddToWorkflowDialog
      open={addToWorkflowStep !== null}
      onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
      stepData={addToWorkflowStep ?? {}}
    />

    <PromptSnippetManager
      open={snippetManagerOpen}
      onOpenChange={setSnippetManagerOpen}
    />
    </>
  );
}
